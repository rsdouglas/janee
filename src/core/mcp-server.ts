/**
 * MCP Server for Janee
 * Exposes capabilities to AI agents via Model Context Protocol
 */

import express from "express";
import { readFileSync } from "fs";
import http from "http";
import https from "https";
import { join } from "path";
import { URL } from "url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
  canAgentAccess,
  CredentialOwnership,
  resolveAgentIdentity,
} from "./agent-scope.js";
import { AuditLogger } from "./audit.js";
import { ExecResult, validateCommand } from "./exec.js";
import { ServiceTestResult, testServiceConnection } from "./health.js";
import { checkRules, Rules } from "./rules.js";
import { SessionManager } from "./sessions.js";

// Read version from package.json
const packageJsonPath = join(__dirname, "../../package.json");
const pkgVersion =
  JSON.parse(readFileSync(packageJsonPath, "utf8")).version || "0.0.0";

export type DenialReasonCode =
  | 'CAPABILITY_NOT_FOUND'
  | 'AGENT_NOT_ALLOWED'
  | 'DEFAULT_ACCESS_RESTRICTED'
  | 'OWNERSHIP_DENIED'
  | 'RULE_DENY'
  | 'MODE_MISMATCH'
  | 'REASON_REQUIRED'
  | 'COMMAND_NOT_ALLOWED';

export interface DenialDetails {
  reasonCode: DenialReasonCode;
  capability?: string;
  agentId?: string | null;
  evaluatedPolicy?: string;
  nextStep: string;
}

export class DenialError extends Error {
  denial: DenialDetails;
  constructor(message: string, denial: DenialDetails) {
    super(message);
    this.name = 'DenialError';
    this.denial = denial;
  }
}

/**
 * Check whether an agent can access a capability.
 * Checks capability-level allowedAgents first, then falls back to
 * service-level ownership and the global defaultAccess policy.
 *
 * No agentId (e.g. CLI/admin) always gets access.
 */
function canAccessCapability(
  agentId: string | undefined,
  cap: Capability,
  service: ServiceConfig | undefined,
  defaultAccessPolicy: "open" | "restricted" | undefined,
): boolean {
  if (!agentId) return true;

  if (cap.allowedAgents && cap.allowedAgents.length > 0) {
    return cap.allowedAgents.includes(agentId);
  }

  if (defaultAccessPolicy === "restricted") {
    return false;
  }

  return canAgentAccess(agentId, service?.ownership);
}

export type AccessDenialReason = 'AGENT_NOT_ALLOWED' | 'DEFAULT_ACCESS_RESTRICTED' | 'OWNERSHIP_DENIED';

/**
 * Returns the specific reason access was denied, or null if access is allowed.
 */
export function explainAccessDenial(
  agentId: string | undefined,
  cap: Capability,
  service: ServiceConfig | undefined,
  defaultAccessPolicy: 'open' | 'restricted' | undefined
): { reason: AccessDenialReason; detail: string } | null {
  if (!agentId) return null;

  if (cap.allowedAgents && cap.allowedAgents.length > 0) {
    if (!cap.allowedAgents.includes(agentId)) {
      return {
        reason: 'AGENT_NOT_ALLOWED',
        detail: `Agent "${agentId}" is not in allowedAgents [${cap.allowedAgents.join(', ')}]`
      };
    }
    return null;
  }

  if (defaultAccessPolicy === 'restricted') {
    return {
      reason: 'DEFAULT_ACCESS_RESTRICTED',
      detail: `defaultAccess is "restricted" and capability has no allowedAgents list`
    };
  }

  if (!canAgentAccess(agentId, service?.ownership)) {
    return {
      reason: 'OWNERSHIP_DENIED',
      detail: `Agent "${agentId}" is not listed in service ownership for "${service?.baseUrl || 'unknown'}"`
    };
  }

  return null;
}

export interface Capability {
  name: string;
  service: string;
  ttl: string; // e.g., "1h", "30m"
  autoApprove?: boolean;
  requiresReason?: boolean;
  rules?: Rules; // Optional allow/deny patterns
  allowedAgents?: string[]; // Restrict this capability to specific agent IDs
  // Exec mode fields (RFC 0001)
  mode?: "proxy" | "exec";
  allowCommands?: string[];
  env?: Record<string, string>;
  workDir?: string;
  timeout?: number;
}

export interface ServiceConfig {
  baseUrl: string;
  auth: {
    type:
      | "bearer"
      | "hmac-mexc"
      | "hmac-bybit"
      | "hmac-okx"
      | "headers"
      | "service-account"
      | "github-app";
    key?: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string; // For OKX
    headers?: Record<string, string>;
    credentials?: string; // For service-account: encrypted JSON blob
    scopes?: string[]; // For service-account: OAuth scopes
    appId?: string; // For github-app
    privateKey?: string; // For github-app: encrypted PEM
    installationId?: string; // For github-app
  };
  /** Auth-required GET path used by `janee test` to verify credentials (e.g. "/v1/balance") */
  testPath?: string;
  /** Ownership metadata for agent-scoped credential access control */
  ownership?: CredentialOwnership;
}

export interface APIRequest {
  service: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface APIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export interface ReloadResult {
  capabilities: Capability[];
  services: Map<string, ServiceConfig>;
}

export interface MCPServerOptions {
  capabilities: Capability[];
  services: Map<string, ServiceConfig>;
  /** Map of service name -> ownership metadata for agent-scoped access control */
  sessionManager: SessionManager;
  auditLogger: AuditLogger;
  /** Default access policy for capabilities without allowedAgents: "open" (any agent) or "restricted" (no agent unless listed) */
  defaultAccess?: "open" | "restricted";
  onExecute: (session: any, request: APIRequest) => Promise<APIResponse>;
  onExecCommand?: (
    session: any,
    capability: Capability,
    command: string[],
    stdin?: string,
  ) => Promise<ExecResult>;
  onReloadConfig?: () => ReloadResult;
  /** Persist ownership changes to config storage (called after grant/revoke) */
  onPersistOwnership?: (
    serviceName: string,
    ownership: CredentialOwnership,
  ) => void;
  /**
   * Runner proxy: when set, tool calls (except janee_exec) are forwarded
   * to the Authority via this callback instead of handled locally.
   * janee_exec is always handled locally by onExecCommand.
   */
  onForwardToolCall?: (
    toolName: string,
    args: Record<string, unknown>,
    agentId?: string,
  ) => Promise<unknown>;
  /** When true, janee_exec is hidden from the tool list. Used in authority/HTTP mode
   * where exec would run in the wrong context. */
  hideExecTool?: boolean;
}

/**
 * Parse TTL string to seconds
 */
function parseTTL(ttl: string): number {
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);

  const value = parseInt(match[1]);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return value * multipliers[unit];
}

export interface MCPServerResult {
  /** Swap capabilities and services in the closure. Used for SIGHUP reload. */
  reloadConfig: (result: ReloadResult) => void;
  server: Server;
  /** Per-session clientInfo.name storage. Populated by captureClientInfo(). */
  clientSessions: Map<string, string>;
}

/**
 * Create and start MCP server
 */
export function createMCPServer(options: MCPServerOptions): MCPServerResult {
  const {
    sessionManager,
    auditLogger,
    defaultAccess,
    onExecute,
    onExecCommand,
    onReloadConfig,
    onPersistOwnership,
    onForwardToolCall,
  } = options;

  // Store as mutable to support hot-reloading
  let capabilities = options.capabilities;
  let services = options.services;

  // Maps MCP session IDs to clientInfo.name from the initialize handshake.
  // Populated by captureClientInfo() after connecting a transport.
  const clientSessions = new Map<string, string>();

  const server = new Server(
    {
      name: "janee",
      version: pkgVersion,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  /**
   * Resolve agent identity from the MCP session.
   * Identity comes from clientInfo.name captured during initialize.
   * For HTTP: stored by session UUID (captured in startMCPServerHTTP).
   * For stdio/tests: stored under '__default__' (captured by captureClientInfo).
   * Falls back to args.agentId for legacy scenarios.
   */
  function resolveAgentFromRequest(extra: any, args: any): string | undefined {
    const sessionKey = extra?.sessionId || "__default__";
    const clientName =
      clientSessions.get(sessionKey) || clientSessions.get("__default__");

    return resolveAgentIdentity(
      {
        agentId: extra?.sessionId,
        metadata: { transportAgentHint: clientName },
      },
      args?.agentId,
    );
  }

  // Tool: list_services
  const listServicesTool: Tool = {
    name: "list_services",
    description: "List available API capabilities managed by Janee",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  };

  // Tool: execute
  const executeTool: Tool = {
    name: "execute",
    description: "Execute an API request through Janee proxy",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Capability name to use (from list_services)",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          description: "HTTP method",
        },
        path: {
          type: "string",
          description: "API path (e.g., /v1/customers)",
        },
        body: {
          type: "string",
          description: "Request body (JSON string, optional)",
        },
        headers: {
          type: "object",
          description: "Additional headers (optional)",
          additionalProperties: { type: "string" },
        },
        reason: {
          type: "string",
          description:
            "Reason for this request (required for some capabilities)",
        },
      },
      required: ["capability", "method", "path"],
    },
  };

  // Tool: reload_config
  const reloadConfigTool: Tool = {
    name: "reload_config",
    description:
      "Reload Janee configuration from disk without restarting the server. Use after adding new services or capabilities.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  };

  // Tool: janee_exec (RFC 0001 - Secure CLI Execution)
  const execTool: Tool = {
    name: "janee_exec",
    description:
      "Execute a CLI command with credentials injected via environment variables. The agent never sees the actual credential — Janee injects it and scrubs output.",
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description:
            "Capability name (must be exec mode, from list_services)",
        },
        command: {
          type: "array",
          items: { type: "string" },
          description:
            'Command and arguments as array, e.g. ["gh", "issue", "list"]',
        },
        cwd: {
          type: "string",
          description:
            "Working directory for the command (defaults to process cwd)",
        },
        stdin: {
          type: "string",
          description: "Optional stdin input to pipe to the command",
        },
        reason: {
          type: "string",
          description:
            "Reason for this execution (required for some capabilities)",
        },
      },
      required: ["capability", "command"],
    },
  };

  // Tool: manage_credential (agent-scoped credential access control)
  const manageCredentialTool: Tool = {
    name: "manage_credential",
    description:
      "View or manage access policies for agent-scoped credentials. Agents can check who has access, grant access to other agents, or revoke access.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["view", "grant", "revoke"],
          description:
            "Action to perform: view ownership info, grant access to another agent, or revoke access",
        },
        service: {
          type: "string",
          description: "Service name to manage",
        },
        targetAgentId: {
          type: "string",
          description:
            "Agent ID to grant/revoke access for (required for grant/revoke actions)",
        },
      },
      required: ["action", "service"],
    },
  };

  // Tool: test_service
  const testServiceTool: Tool = {
    name: "test_service",
    description:
      "Test connectivity and authentication for a configured service. Verifies that Janee can reach the service and that credentials are valid.",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description:
            "Service name to test (from list_services). Omit to test all services.",
        },
        timeout: {
          type: "number",
          description:
            "Timeout in milliseconds for the health check (default: 10000).",
        },
      },
      required: [],
    },
  };

  // Tool: whoami — lets agents discover their resolved identity
  const whoamiTool: Tool = {
    name: 'whoami',
    description: 'Show your resolved agent identity as Janee sees it, which capabilities you can access, and the server access policy. Useful for understanding allowedAgents restrictions.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  };

  // Tool: explain_access — full policy evaluation trace
  const explainAccessTool: Tool = {
    name: 'explain_access',
    description: 'Trace exactly why a given agent can or cannot access a capability. Returns step-by-step policy evaluation (capability exists, mode, allowedAgents, defaultAccess, ownership, rules). Use for debugging access issues.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Agent ID to evaluate access for. Defaults to the calling agent.'
        },
        capability: {
          type: 'string',
          description: 'Capability name to check access for.'
        },
        method: {
          type: 'string',
          description: 'HTTP method for rules evaluation (optional, only applies to proxy capabilities).'
        },
        path: {
          type: 'string',
          description: 'Request path for rules evaluation (optional, only applies to proxy capabilities).'
        }
      },
      required: ['capability']
    }
  };

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [
      listServicesTool,
      executeTool,
      manageCredentialTool,
      testServiceTool,
      whoamiTool,
      explainAccessTool,
    ];
    if (onExecCommand && !options.hideExecTool) {
      tools.push(execTool);
    }
    if (onReloadConfig) {
      tools.push(reloadConfigTool);
    }
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      // Runner proxy: forward all non-exec tools to the Authority
      if (onForwardToolCall && name !== "janee_exec") {
        const forwardAgentId = resolveAgentFromRequest(extra, args);
        const result = await onForwardToolCall(
          name,
          (args || {}) as Record<string, unknown>,
          forwardAgentId,
        );
        return result as any;
      }

      switch (name) {
        case "list_services": {
          const listAgentId = resolveAgentFromRequest(extra, args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  capabilities.map((cap) => ({
                    accessible: canAccessCapability(
                      listAgentId,
                      cap,
                      services.get(cap.service),
                      defaultAccess,
                    ),
                    name: cap.name,
                    service: cap.service,
                    mode: cap.mode || "proxy",
                    ttl: cap.ttl,
                    autoApprove: cap.autoApprove,
                    requiresReason: cap.requiresReason,
                    rules: cap.rules,
                    ...(cap.mode === "exec" && {
                      allowCommands: cap.allowCommands,
                      env: cap.env ? Object.keys(cap.env) : undefined,
                    }),
                  })),
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "reload_config": {
          if (!onReloadConfig) {
            throw new Error("Config reload not supported");
          }

          try {
            const result = onReloadConfig();
            const prevCapCount = capabilities.length;
            const prevServiceCount = services.size;

            capabilities = result.capabilities;
            services = result.services;

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      message: "Configuration reloaded successfully",
                      services: services.size,
                      capabilities: capabilities.length,
                      changes: {
                        services: services.size - prevServiceCount,
                        capabilities: capabilities.length - prevCapCount,
                      },
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            throw new Error(
              `Failed to reload config: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        case "execute": {
          const { capability, method, path, body, headers, reason } =
            args as any;

          // Validate required arguments
          if (!capability) {
            throw new Error("Missing required argument: capability");
          }
          if (!method) {
            throw new Error(
              "Missing required argument: method (GET, POST, PUT, DELETE, etc.)",
            );
          }
          if (!path) {
            throw new Error("Missing required argument: path");
          }

          // Find capability
          const cap = capabilities.find((c) => c.name === capability);
          if (!cap) {
            throw new DenialError(`Unknown capability: ${capability}`, {
              reasonCode: 'CAPABILITY_NOT_FOUND',
              capability,
              nextStep: `Run 'janee cap list' to see available capabilities, or add one with 'janee cap add'.`
            });
          }

          // Reject exec-mode capabilities — they should use janee_exec instead
          if (cap.mode === "exec") {
            throw new DenialError(
              `Capability "${capability}" is an exec-mode capability. Use the 'janee_exec' tool instead.`,
              {
                reasonCode: "MODE_MISMATCH",
                capability,
                nextStep: `Use the 'janee_exec' tool for exec-mode capabilities.`,
              },
            );
          }

          // Check if reason required
          if (cap.requiresReason && !reason) {
            throw new DenialError(`Capability "${capability}" requires a reason`, {
              reasonCode: 'REASON_REQUIRED',
              capability,
              nextStep: `Include a 'reason' argument explaining why you need this access.`
            });
          }

          // Check rules (path-based policies)
          const ruleCheck = checkRules(cap.rules, method, path);
          if (!ruleCheck.allowed) {
            auditLogger.logDenied(
              cap.service,
              method,
              path,
              ruleCheck.reason || "Request denied by policy",
              reason,
            );
            throw new DenialError(ruleCheck.reason || "Request denied by policy", {
              reasonCode: "RULE_DENY",
              capability,
              agentId: resolveAgentFromRequest(extra, args),
              evaluatedPolicy: `rules for ${method} ${path}`,
              nextStep: `Check capability rules with 'janee cap list --json' — the path/method may be explicitly denied.`,
            });
          }

          // Check agent-scoped access (capability-level allowedAgents, then service-level ownership)
          const executeAgentId = resolveAgentFromRequest(extra, args);
          const executeSvc = services.get(cap.service);
          if (
            !canAccessCapability(executeAgentId, cap, executeSvc, defaultAccess)
          ) {
            const denialDetail = explainAccessDenial(
              executeAgentId,
              cap,
              executeSvc,
              defaultAccess,
            );
            auditLogger.logDenied(
              cap.service,
              method,
              path,
              "Agent does not have access to this capability",
              reason,
            );
            throw new DenialError(
              `Access denied: capability "${capability}" is not accessible to this agent`,
              {
                reasonCode: denialDetail?.reason || "AGENT_NOT_ALLOWED",
                capability,
                agentId: executeAgentId,
                evaluatedPolicy: denialDetail?.detail,
                nextStep:
                  denialDetail?.reason === "AGENT_NOT_ALLOWED"
                    ? `Add this agent to allowedAgents: 'janee cap edit ${capability} --allowed-agents ${executeAgentId}'`
                    : denialDetail?.reason === "DEFAULT_ACCESS_RESTRICTED"
                      ? `Either add allowedAgents to the capability or change defaultAccess to 'open'.`
                      : `Check service ownership settings for the backing service.`,
              },
            );
          }

          // Get or create session
          const ttlSeconds = parseTTL(cap.ttl);
          const session = sessionManager.createSession(
            cap.name,
            cap.service,
            ttlSeconds,
            { agentId: executeAgentId, reason },
          );

          // Build API request
          const apiReq: APIRequest = {
            service: cap.service,
            path,
            method,
            headers: headers || {},
            body,
          };

          // Execute
          const response = await onExecute(session, apiReq);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: response.statusCode,
                    body: response.body,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "janee_exec": {
          if (!onExecCommand) {
            throw new Error(
              "CLI execution not supported in this configuration",
            );
          }

          const {
            capability: execCapName,
            command: rawExecCommand,
            cwd: execCwd,
            stdin: execStdin,
            reason: execReason,
          } = args as any;

          if (!execCapName) {
            throw new Error("Missing required argument: capability");
          }
          if (
            !rawExecCommand ||
            (Array.isArray(rawExecCommand) && rawExecCommand.length === 0) ||
            (typeof rawExecCommand === "string" && rawExecCommand.trim() === "")
          ) {
            throw new Error("Missing required argument: command");
          }

          const execCommand: string[] = Array.isArray(rawExecCommand)
            ? rawExecCommand
            : typeof rawExecCommand === "string"
              ? rawExecCommand.trim().split(/\s+/)
              : [];

          let execCap: Capability;
          let execSession: any;

          if (onForwardToolCall) {
            // Runner mode: Authority handles validation and credential injection.
            // Build a minimal capability stub so onExecCommand has the name.
            execCap = {
              name: execCapName,
              service: "",
              ttl: "1h",
              mode: "exec",
              workDir: execCwd,
            } as Capability;
            execSession = { agentId: resolveAgentFromRequest(extra, args) };
          } else {
            // Standalone mode: validate locally
            const foundCap = capabilities.find((c) => c.name === execCapName);
            if (!foundCap) {
              throw new DenialError(`Unknown capability: ${execCapName}`, {
                reasonCode: 'CAPABILITY_NOT_FOUND',
                capability: execCapName,
                nextStep: `Run 'janee cap list' to see available capabilities, or add one with 'janee cap add'.`
              });
            }
            execCap = execCwd ? { ...foundCap, workDir: execCwd } : foundCap;

            if (execCap.mode !== "exec") {
              throw new DenialError(
                `Capability "${execCapName}" is not an exec-mode capability. Use the 'execute' tool for API proxy capabilities.`,
                {
                  reasonCode: "MODE_MISMATCH",
                  capability: execCapName,
                  nextStep: `Use the 'execute' tool for proxy-mode capabilities.`,
                },
              );
            }

            const execAgentId = resolveAgentFromRequest(extra, args);
            const execSvc = services.get(execCap.service);
            if (
              !canAccessCapability(execAgentId, execCap, execSvc, defaultAccess)
            ) {
              const execDenialDetail = explainAccessDenial(
                execAgentId,
                execCap,
                execSvc,
                defaultAccess,
              );
              auditLogger.logDenied(
                execCap.service,
                "EXEC",
                execCommand.join(" "),
                "Agent does not have access to this capability",
                execReason,
              );
              throw new DenialError(
                `Access denied: capability "${execCapName}" is not accessible to this agent`,
                {
                  reasonCode: execDenialDetail?.reason || "AGENT_NOT_ALLOWED",
                  capability: execCapName,
                  agentId: execAgentId,
                  evaluatedPolicy: execDenialDetail?.detail,
                  nextStep:
                    execDenialDetail?.reason === "AGENT_NOT_ALLOWED"
                      ? `Add this agent to allowedAgents: 'janee cap edit ${execCapName} --allowed-agents ${execAgentId}'`
                      : execDenialDetail?.reason === "DEFAULT_ACCESS_RESTRICTED"
                        ? `Either add allowedAgents to the capability or change defaultAccess to 'open'.`
                        : `Check service ownership settings for the backing service.`,
                },
              );
            }

            if (execCap.requiresReason && !execReason) {
              throw new DenialError(`Capability "${execCapName}" requires a reason`, {
                reasonCode: 'REASON_REQUIRED',
                capability: execCapName,
                nextStep: `Include a 'reason' argument explaining why you need this access.`
              });
            }

            const cmdValidation = validateCommand(
              execCommand,
              execCap.allowCommands || [],
            );
            if (!cmdValidation.allowed) {
              auditLogger.logDenied(
                execCap.service,
                "EXEC",
                execCommand.join(" "),
                cmdValidation.reason || "Command not allowed",
                execReason,
              );
              throw new DenialError(
                cmdValidation.reason || "Command not allowed",
                {
                  reasonCode: "COMMAND_NOT_ALLOWED",
                  capability: execCapName,
                  agentId: execAgentId,
                  evaluatedPolicy: `allowCommands: [${(execCap.allowCommands || []).join(", ")}]`,
                  nextStep: `Update allowed commands: 'janee cap edit ${execCapName} --allow-commands "new-pattern"'`,
                },
              );
            }

            const execTtlSeconds = parseTTL(execCap.ttl);
            execSession = sessionManager.createSession(
              execCap.name,
              execCap.service,
              execTtlSeconds,
              { reason: execReason },
            );
          }

          const execResult = await onExecCommand(
            execSession,
            execCap,
            execCommand,
            execStdin,
          );

          // Log to audit
          auditLogger.log(
            {
              service: execCap.service,
              path: execCommand.join(" "),
              method: "EXEC",
              headers: { "x-janee-reason": execReason || "" },
            },
            {
              statusCode: execResult.exitCode === 0 ? 200 : 500,
              headers: {},
              body: execResult.stdout,
            },
            execResult.executionTimeMs,
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    exitCode: execResult.exitCode,
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                    executionTimeMs: execResult.executionTimeMs,
                    executionTarget: "runner",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "manage_credential": {
          const {
            action: credAction,
            service: credService,
            targetAgentId: credTarget,
          } = args as any;
          const credAgentId = resolveAgentFromRequest(extra, args);

          if (!credService) {
            throw new Error("Missing required argument: service");
          }

          const svc = services.get(credService);
          if (!svc) {
            throw new Error(`Unknown service: ${credService}`);
          }

          if (credAction === "view") {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      service: credService,
                      ownership: svc.ownership || {
                        accessPolicy: "all-agents",
                        note: "No ownership metadata (legacy credential)",
                      },
                      yourAccess: canAgentAccess(credAgentId, svc.ownership),
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          // Grant/revoke require ownership verification
          if (!credAgentId) {
            throw new Error("agentId is required for grant/revoke actions");
          }

          if (!svc.ownership) {
            throw new Error(
              "Cannot manage access for legacy credentials without ownership metadata. Re-add the service to enable scoping.",
            );
          }

          if (svc.ownership.createdBy !== credAgentId) {
            throw new Error(
              "Only the credential owner can grant or revoke access",
            );
          }

          if (credAction === "grant") {
            if (!credTarget) {
              throw new Error("targetAgentId is required for grant action");
            }
            const { grantAccess } = await import("./agent-scope.js");
            svc.ownership = grantAccess(svc.ownership, credTarget);

            // Persist ownership change to config storage
            if (onPersistOwnership) {
              onPersistOwnership(credService, svc.ownership);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Granted access to ${credTarget}`,
                      ownership: svc.ownership,
                      persisted: !!onPersistOwnership,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          if (credAction === "revoke") {
            if (!credTarget) {
              throw new Error("targetAgentId is required for revoke action");
            }
            const { revokeAccess } = await import("./agent-scope.js");
            svc.ownership = revokeAccess(svc.ownership, credTarget);

            // Persist ownership change to config storage
            if (onPersistOwnership) {
              onPersistOwnership(credService, svc.ownership);
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      success: true,
                      message: `Revoked access from ${credTarget}`,
                      ownership: svc.ownership,
                      persisted: !!onPersistOwnership,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }

          throw new Error(
            `Unknown action: ${credAction}. Use 'view', 'grant', or 'revoke'.`,
          );
        }

        case "test_service": {
          const { service: testSvcName, timeout: testTimeout } = (args ||
            {}) as { service?: string; timeout?: number };
          const testOpts = testTimeout ? { timeout: testTimeout } : {};

          let targets: [string, ServiceConfig][];
          if (testSvcName) {
            const svc = services.get(testSvcName);
            if (!svc) {
              throw new Error(
                `Unknown service: ${testSvcName}. Use list_services to see available services.`,
              );
            }
            targets = [[testSvcName, svc]];
          } else {
            targets = Array.from(services.entries());
          }

          if (targets.length === 0) {
            throw new Error("No services configured");
          }

          const results: ServiceTestResult[] = await Promise.all(
            targets.map(([name, config]) =>
              testServiceConnection(name, config, testOpts),
            ),
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  results.length === 1 ? results[0] : results,
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'explain_access': {
          const { agent: explainAgent, capability: explainCapName, method: explainMethod, path: explainPath } = args as any;
          const targetAgentId = explainAgent || resolveAgentFromRequest(extra, args);

          interface TraceStep { check: string; result: 'pass' | 'fail' | 'skip'; detail: string }
          const trace: TraceStep[] = [];

          const explainCap = capabilities.find(c => c.name === explainCapName);
          if (!explainCap) {
            trace.push({ check: 'capability_exists', result: 'fail', detail: `Capability "${explainCapName}" not found` });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  agent: targetAgentId ?? null,
                  capability: explainCapName,
                  allowed: false,
                  trace,
                  nextStep: `Run 'janee cap list' to see available capabilities.`
                }, null, 2)
              }]
            };
          }
          trace.push({ check: 'capability_exists', result: 'pass', detail: `Capability "${explainCapName}" exists (service: ${explainCap.service})` });

          // Mode check
          if (explainMethod && explainCap.mode === 'exec') {
            trace.push({ check: 'mode', result: 'fail', detail: `Capability is exec-mode but method/path were provided (use janee_exec)` });
          } else if (!explainMethod && explainCap.mode !== 'exec') {
            trace.push({ check: 'mode', result: 'pass', detail: `Capability mode: ${explainCap.mode || 'proxy'}` });
          } else {
            trace.push({ check: 'mode', result: 'pass', detail: `Capability mode: ${explainCap.mode || 'proxy'}` });
          }

          // allowedAgents
          if (explainCap.allowedAgents && explainCap.allowedAgents.length > 0) {
            if (!targetAgentId) {
              trace.push({ check: 'allowed_agents', result: 'pass', detail: `No agent ID (admin/CLI) — bypasses allowedAgents` });
            } else if (explainCap.allowedAgents.includes(targetAgentId)) {
              trace.push({ check: 'allowed_agents', result: 'pass', detail: `Agent "${targetAgentId}" is in allowedAgents [${explainCap.allowedAgents.join(', ')}]` });
            } else {
              trace.push({ check: 'allowed_agents', result: 'fail', detail: `Agent "${targetAgentId}" is NOT in allowedAgents [${explainCap.allowedAgents.join(', ')}]` });
            }
          } else {
            trace.push({ check: 'allowed_agents', result: 'skip', detail: `No allowedAgents restriction on this capability` });
          }

          // defaultAccess
          if (targetAgentId && (!explainCap.allowedAgents || explainCap.allowedAgents.length === 0)) {
            if (defaultAccess === 'restricted') {
              trace.push({ check: 'default_access', result: 'fail', detail: `defaultAccess is "restricted" and no allowedAgents list — agent blocked` });
            } else {
              trace.push({ check: 'default_access', result: 'pass', detail: `defaultAccess is "${defaultAccess ?? 'open'}" — agent allowed` });
            }
          } else {
            trace.push({ check: 'default_access', result: 'skip', detail: targetAgentId ? `allowedAgents list takes precedence` : `No agent ID (admin/CLI)` });
          }

          // Ownership
          const explainSvc = services.get(explainCap.service);
          if (targetAgentId && explainSvc?.ownership) {
            if (canAgentAccess(targetAgentId, explainSvc.ownership)) {
              trace.push({ check: 'ownership', result: 'pass', detail: `Agent can access service (ownership: ${JSON.stringify(explainSvc.ownership)})` });
            } else {
              trace.push({ check: 'ownership', result: 'fail', detail: `Agent cannot access service (ownership: ${JSON.stringify(explainSvc.ownership)})` });
            }
          } else {
            trace.push({ check: 'ownership', result: 'skip', detail: explainSvc?.ownership ? `No agent ID (admin/CLI)` : `No ownership restrictions on service` });
          }

          // Rules check (only if method/path provided)
          if (explainMethod && explainPath && explainCap.mode !== 'exec') {
            const ruleResult = checkRules(explainCap.rules, explainMethod, explainPath);
            if (ruleResult.allowed) {
              trace.push({ check: 'rules', result: 'pass', detail: `${explainMethod} ${explainPath} is allowed by rules` });
            } else {
              trace.push({ check: 'rules', result: 'fail', detail: ruleResult.reason || `${explainMethod} ${explainPath} is denied by rules` });
            }
          } else if (explainCap.mode === 'exec') {
            trace.push({ check: 'rules', result: 'skip', detail: `Exec-mode capabilities use allowCommands, not path rules` });
          } else {
            trace.push({ check: 'rules', result: 'skip', detail: `No method/path provided for rules evaluation` });
          }

          // Command validation for exec mode
          if (explainCap.mode === 'exec') {
            trace.push({ check: 'allow_commands', result: 'skip', detail: `allowCommands: [${(explainCap.allowCommands || []).join(', ')}] — provide a specific command to validate` });
          }

          const hasFail = trace.some(t => t.result === 'fail');
          const firstFail = trace.find(t => t.result === 'fail');

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agent: targetAgentId ?? null,
                capability: explainCapName,
                allowed: !hasFail,
                trace,
                ...(hasFail && firstFail ? { nextStep: firstFail.detail } : {})
              }, null, 2)
            }]
          };
        }

        case 'whoami': {
          const whoamiAgentId = resolveAgentFromRequest(extra, args);

          const accessibleCaps = capabilities
            .filter(cap => canAccessCapability(whoamiAgentId, cap, services.get(cap.service), defaultAccess))
            .map(cap => cap.name);

          const deniedCaps = capabilities
            .filter(cap => !canAccessCapability(whoamiAgentId, cap, services.get(cap.service), defaultAccess))
            .map(cap => cap.name);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                agentId: whoamiAgentId ?? null,
                identitySource: whoamiAgentId
                  ? ((extra?.sessionId && clientSessions.has(extra.sessionId)) || clientSessions.has('__default__')
                    ? 'transport (clientInfo.name)'
                    : 'client-asserted (untrusted)')
                  : 'none',
                defaultAccessPolicy: defaultAccess ?? 'open',
                capabilities: {
                  accessible: accessibleCaps,
                  denied: deniedCaps,
                },
              }, null, 2)
            }]
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const payload: Record<string, any> = {
        error: error instanceof Error ? error.message : "Unknown error",
      };
      if (error instanceof DenialError) {
        payload.denial = error.denial;
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return {
    server,
    clientSessions,
    reloadConfig: (result: ReloadResult) => {
      capabilities = result.capabilities;
      services = result.services;
    },
  };
}

/**
 * Make HTTP/HTTPS request to real API
 */
export function makeAPIRequest(
  targetUrl: URL,
  request: APIRequest,
): Promise<APIResponse> {
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: request.method,
      headers: {
        "User-Agent": "janee/" + pkgVersion,
        ...request.headers,
      },
    };

    const req = client.request(options, (res) => {
      let body = "";

      res.on("data", (chunk) => {
        body += chunk;
      });

      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers as Record<string, string | string[]>,
          body,
        });
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    if (request.body) {
      req.write(request.body);
    }

    req.end();
  });
}

/**
 * Intercept MCP transport messages to capture clientInfo.name from initialize handshakes.
 * For HTTP (with sessionId in extra), stores per-session.
 * For stdio/InMemory (no sessionId), stores under '__default__'.
 */
export function captureClientInfo(
  transport: { onmessage?: (...args: any[]) => any },
  clientSessions: Map<string, string>,
): void {
  const original = transport.onmessage;
  transport.onmessage = (message: any, extra?: any) => {
    if (message?.method === "initialize" && message?.params?.clientInfo?.name) {
      const key = extra?.sessionId || "__default__";
      clientSessions.set(key, message.params.clientInfo.name);
    }
    return (original as any)?.call(transport, message, extra);
  };
}

/**
 * Start MCP server with stdio transport (single session).
 */
export async function startMCPServer(
  serverOptions: MCPServerOptions,
): Promise<MCPServerResult> {
  const mcpResult = createMCPServer(serverOptions);
  const { server, clientSessions } = mcpResult;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  captureClientInfo(transport, clientSessions);

  console.error("Janee MCP server started (stdio)");
  return mcpResult;
}

/** Handle returned by startMCPServerHTTP for lifecycle management. */
export interface HTTPServerHandle {
  /** Gracefully close all sessions and stop the HTTP listener. */
  close(): Promise<void>;
  /** Number of active MCP sessions. */
  sessionCount(): number;
}

/**
 * Start MCP server with StreamableHTTP transport over HTTP.
 *
 * Creates a new Server + Transport per session (the official MCP SDK pattern).
 * Each session gets its own Server instance so that concurrent clients don't
 * interfere — the SDK's Server.connect() sets a single _transport slot, so
 * sharing a Server across transports would route responses to the wrong client.
 *
 * Returns an HTTPServerHandle for graceful shutdown and session introspection.
 * Sessions that are idle for longer than `idleTimeoutMs` (default: 30 minutes)
 * are automatically closed to prevent memory leaks.
 */
export async function startMCPServerHTTP(
  serverOptions: MCPServerOptions,
  httpOptions: {
    host: string;
    port: number;
    idleTimeoutMs?: number;
    runnerKey?: string;
    authorityHooks?: import("./authority.js").AuthorityExecHooks;
  },
): Promise<HTTPServerHandle> {
  const app = express();
  app.use(express.json());

  const idleTimeoutMs = httpOptions.idleTimeoutMs ?? 30 * 60 * 1000; // default 30 min

  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: Server;
      lastActivityAt: number;
    }
  >();

  // Authority REST endpoints -- active when runnerKey is provided
  if (httpOptions.runnerKey && httpOptions.authorityHooks) {
    const { timingSafeEqual } = await import("crypto");
    const runnerKey = httpOptions.runnerKey;
    const hooks = httpOptions.authorityHooks;

    const authMiddleware: express.RequestHandler = (req, res, next) => {
      const provided = req.header("x-janee-runner-key");
      if (
        !provided ||
        provided.length !== runnerKey.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(runnerKey))
      ) {
        res.status(401).json({ error: "Unauthorized runner request" });
        return;
      }
      next();
    };

    app.get("/v1/health", (_req, res) => {
      res.status(200).json({ ok: true, mode: "authority" });
    });

    app.post("/v1/exec/authorize", authMiddleware, async (req, res) => {
      try {
        const body = req.body;
        if (
          !body?.runner?.runnerId ||
          !Array.isArray(body?.command) ||
          body.command.length === 0 ||
          !body.capabilityId
        ) {
          res.status(400).json({ error: "Invalid authorize request" });
          return;
        }
        const response = await hooks.authorizeExec(body);
        res.status(200).json(response);
      } catch (error) {
        res
          .status(403)
          .json({
            error:
              error instanceof Error ? error.message : "Authorization failed",
          });
      }
    });

    app.post("/v1/exec/complete", authMiddleware, async (req, res) => {
      try {
        if (!req.body?.grantId) {
          res.status(400).json({ error: "grantId is required" });
          return;
        }
        await hooks.completeExec(req.body);
        res.status(200).json({ ok: true });
      } catch (error) {
        res
          .status(500)
          .json({
            error: error instanceof Error ? error.message : "completion failed",
          });
      }
    });

    if (hooks.testService) {
      app.post("/v1/test", authMiddleware, async (req, res) => {
        try {
          const result = await hooks.testService!(req.body?.service, {
            timeout: req.body?.timeout,
          });
          res.status(200).json(result);
        } catch (error) {
          res
            .status(500)
            .json({
              error: error instanceof Error ? error.message : "Test failed",
            });
        }
      });
    }
  }

  // Sweep idle sessions every 60 seconds
  const idleSweepInterval =
    idleTimeoutMs > 0
      ? setInterval(
          async () => {
            const now = Date.now();
            for (const [sid, session] of sessions.entries()) {
              if (now - session.lastActivityAt > idleTimeoutMs) {
                console.error(
                  `Closing idle session ${sid} (inactive for ${Math.round((now - session.lastActivityAt) / 1000)}s)`,
                );
                sessions.delete(sid);
                try {
                  await session.transport.close?.();
                  await session.server.close();
                } catch {
                  // best-effort cleanup
                }
              }
            }
          },
          Math.min(idleTimeoutMs, 60_000),
        )
      : undefined;

  if (idleSweepInterval) {
    idleSweepInterval.unref?.(); // Don't prevent Node from exiting
  }

  app.all("/mcp", async (req, res) => {
    try {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        session.lastActivityAt = Date.now();
        await session.transport.handleRequest(req, res, req.body);
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const clientName: string | undefined =
          req.body?.params?.clientInfo?.name;
        const mcpResult = createMCPServer(serverOptions);
        const { server, clientSessions } = mcpResult;

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid: string) => {
            sessions.set(sid, {
              transport,
              server,
              lastActivityAt: Date.now(),
            });
            if (clientName) clientSessions.set(sid, clientName);
          },
          onsessionclosed: async (sid: string) => {
            sessions.delete(sid);
            await server.close();
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            sessions.delete(sid);
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else if (sessionId) {
        res.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        });
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32600,
            message:
              "Bad Request: Missing session ID or not an initialize request",
          },
          id: null,
        });
      }
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  return new Promise((resolve) => {
    const httpServer = app.listen(httpOptions.port, httpOptions.host, () => {
      console.error(
        `Janee MCP server listening on http://${httpOptions.host}:${httpOptions.port}/mcp (StreamableHTTP)`,
      );

      const handle: HTTPServerHandle = {
        async close() {
          if (idleSweepInterval) clearInterval(idleSweepInterval);

          // Close all active sessions
          const closeTasks = Array.from(sessions.entries()).map(
            async ([sid, session]) => {
              sessions.delete(sid);
              try {
                await session.transport.close?.();
                await session.server.close();
              } catch {
                // best-effort
              }
            },
          );
          await Promise.all(closeTasks);

          // Close the HTTP listener
          await new Promise<void>((resolveClose, rejectClose) => {
            httpServer.close((err) =>
              err ? rejectClose(err) : resolveClose(),
            );
          });
        },
        sessionCount() {
          return sessions.size;
        },
      };

      resolve(handle);
    });
  });
}

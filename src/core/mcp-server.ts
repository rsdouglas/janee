/**
 * MCP Server for Janee
 * Exposes capabilities to AI agents via Model Context Protocol
 */

import express from 'express';
import { readFileSync } from 'fs';
import http from 'http';
import https from 'https';
import { join } from 'path';
import { URL } from 'url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  StdioServerTransport,
} from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  StreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  isInitializeRequest,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import {
  canAgentAccess,
  CredentialOwnership,
  resolveAgentIdentity,
} from './agent-scope.js';
import { AuditLogger } from './audit.js';
import {
  ExecResult,
  validateCommand,
} from './exec.js';
import {
  ServiceTestResult,
  testServiceConnection,
} from './health.js';
import {
  checkRules,
  Rules,
} from './rules.js';
import { SessionManager } from './sessions.js';
import {
  handleExec,
  handleExecute,
  handleExplainAccess,
  handleManageCredential,
  handleTestService,
  handleWhoami,
  ToolHandlerContext,
} from './tool-handlers.js';

// Read version from package.json
const packageJsonPath = join(__dirname, "../../package.json");
const pkgVersion =
  JSON.parse(readFileSync(packageJsonPath, "utf8")).version || "0.0.0";


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
      | "github-app"
      | "oauth1a-twitter"
      | "aws-sigv4";
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
    consumerKey?: string; // For oauth1a-twitter
    consumerSecret?: string; // For oauth1a-twitter
    accessToken?: string; // For oauth1a-twitter
    accessTokenSecret?: string; // For oauth1a-twitter
    accessKeyId?: string; // For aws-sigv4
    secretAccessKey?: string; // For aws-sigv4
    region?: string; // For aws-sigv4
    awsService?: string; // For aws-sigv4 (e.g. "ses", "s3")
    sessionToken?: string; // For aws-sigv4 (temporary credentials)
  };
  /** Auth-required GET path used by `janee test` to verify credentials (e.g. "/v1/balance") */
  testPath?: string;
  /** Ownership metadata for agent-scoped credential access control */
  ownership?: CredentialOwnership;
}

export type { APIRequest, APIResponse, DenialDetails, DenialReasonCode } from './types.js';
export { DenialError } from './types.js';
import type { APIRequest, APIResponse } from './types.js';
import { DenialError } from './types.js';

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
  /** Runner diagnostics: when set, the `doctor` MCP tool is available.
   * Runs locally on the runner to check authority connectivity. */
  onDoctorRunner?: (agentId?: string) => Promise<DoctorResult>;
}

export interface DoctorCheckResult {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
}

export interface DoctorResult {
  overall: "PASS" | "WARN" | "FAIL";
  checks: DoctorCheckResult[];
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

  // Tool: doctor — runner self-diagnostics (only available in runner mode)
  const doctorTool: Tool = {
    name: "doctor",
    description:
      "Run runner-to-authority diagnostics. Checks authority reachability, authentication, tool forwarding, and identity parity. Only available when running in runner mode.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
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
    if (options.onDoctorRunner) {
      tools.push(doctorTool);
    }
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      // Runner proxy: forward all non-exec/non-doctor tools to the Authority
      if (onForwardToolCall && name !== "janee_exec" && name !== "doctor") {
        const forwardAgentId = resolveAgentFromRequest(extra, args);
        const result = await onForwardToolCall(
          name,
          (args || {}) as Record<string, unknown>,
          forwardAgentId,
        );
        return result as any;
      }

      const ctx: ToolHandlerContext = {
        getCapabilities: () => capabilities,
        getServices: () => services,
        defaultAccess,
        sessionManager,
        auditLogger,
        onExecute,
        onExecCommand,
        onForwardToolCall,
        onPersistOwnership,
        resolveAgent: resolveAgentFromRequest,
        clientSessions,
        explainAccessDenial,
        canAccessCapability,
      };

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
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true, message: "Configuration reloaded successfully",
                  services: services.size, capabilities: capabilities.length,
                  changes: { services: services.size - prevServiceCount, capabilities: capabilities.length - prevCapCount },
                }, null, 2),
              }],
            };
          } catch (error) {
            throw new Error(`Failed to reload config: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        }

        case "execute":
          return await handleExecute(ctx, args, extra);

        case "janee_exec":
          return await handleExec(ctx, args, extra);

        case "manage_credential":
          return await handleManageCredential(ctx, args, extra);

        case "test_service":
          return await handleTestService(ctx, args);

        case "explain_access":
          return handleExplainAccess(ctx, args, extra);

        case "whoami":
          return handleWhoami(ctx, args, extra);

        case "doctor": {
          if (!options.onDoctorRunner) {
            throw new Error("Doctor diagnostics only available in runner mode.");
          }
          const doctorAgentId = resolveAgentFromRequest(extra, args);
          const doctorResult = await options.onDoctorRunner(doctorAgentId);
          return {
            content: [{ type: "text", text: JSON.stringify(doctorResult, null, 2) }],
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

  if (httpOptions.runnerKey && httpOptions.authorityHooks) {
    const { mountAuthorityRoutes } = await import("./authority.js");
    mountAuthorityRoutes(app, httpOptions.runnerKey, httpOptions.authorityHooks);
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

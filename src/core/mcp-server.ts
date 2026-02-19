/**
 * MCP Server for Janee
 * Exposes capabilities to AI agents via Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { SessionManager } from './sessions.js';
import { checkRules, Rules } from './rules.js';
import { AuditLogger } from './audit.js';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import express from 'express';
import { validateCommand, buildExecEnv, executeCommand, scrubCredentials, ExecResult } from './exec.js';
import { readFileSync } from 'fs';
import { canAgentAccess, resolveAgentIdentity, CredentialOwnership } from './agent-scope.js';
import { join } from 'path';


// Read version from package.json
const packageJsonPath = join(__dirname, '../../package.json');
const pkgVersion = JSON.parse(readFileSync(packageJsonPath, 'utf8')).version || '0.0.0';

export interface Capability {
  name: string;
  service: string;
  ttl: string;  // e.g., "1h", "30m"
  autoApprove?: boolean;
  requiresReason?: boolean;
  rules?: Rules;  // Optional allow/deny patterns
  // Exec mode fields (RFC 0001)
  mode?: 'proxy' | 'exec';
  allowCommands?: string[];
  env?: Record<string, string>;
  workDir?: string;
  timeout?: number;
}

export interface ServiceConfig {
  baseUrl: string;
  auth: {
    type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account' | 'github-app';
    key?: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;  // For OKX
    headers?: Record<string, string>;
    credentials?: string;  // For service-account: encrypted JSON blob
    scopes?: string[];     // For service-account: OAuth scopes
    appId?: string;           // For github-app
    privateKey?: string;      // For github-app: encrypted PEM
    installationId?: string;  // For github-app
  };
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
  onExecute: (session: any, request: APIRequest) => Promise<APIResponse>;
  onExecCommand?: (session: any, capability: Capability, command: string[], stdin?: string) => Promise<ExecResult>;
  onReloadConfig?: () => ReloadResult;
  /** Persist ownership changes to config storage (called after grant/revoke) */
  onPersistOwnership?: (serviceName: string, ownership: CredentialOwnership) => void;
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
    d: 86400
  };
  
  return value * multipliers[unit];
}

/**
 * Create and start MCP server
 */
export function createMCPServer(options: MCPServerOptions): Server {
  const { sessionManager, auditLogger, onExecute, onExecCommand, onReloadConfig, onPersistOwnership } = options;
  
  // Store as mutable to support hot-reloading
  let capabilities = options.capabilities;
  let services = options.services;

  const server = new Server(
    {
      name: 'janee',
      version: pkgVersion
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Tool: list_services
  const listServicesTool: Tool = {
    name: 'list_services',
    description: 'List available API capabilities managed by Janee. If you provide your agentId, only credentials you have access to will be shown.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Your agent identifier (optional — filters results to credentials you can access)'
        }
      },
      required: []
    }
  };

  // Tool: execute
  const executeTool: Tool = {
    name: 'execute',
    description: 'Execute an API request through Janee proxy',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'Capability name to use (from list_services)'
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          description: 'HTTP method'
        },
        path: {
          type: 'string',
          description: 'API path (e.g., /v1/customers)'
        },
        body: {
          type: 'string',
          description: 'Request body (JSON string, optional)'
        },
        headers: {
          type: 'object',
          description: 'Additional headers (optional)',
          additionalProperties: { type: 'string' }
        },
        reason: {
          type: 'string',
          description: 'Reason for this request (required for some capabilities)'
        },
        agentId: {
          type: 'string',
          description: 'Your agent identifier (required for agent-scoped credentials)'
        }
      },
      required: ['capability', 'method', 'path']
    }
  };

  // Tool: reload_config
  const reloadConfigTool: Tool = {
    name: 'reload_config',
    description: 'Reload Janee configuration from disk without restarting the server. Use after adding new services or capabilities.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  };


  // Tool: janee_exec (RFC 0001 - Secure CLI Execution)
  const execTool: Tool = {
    name: 'janee_exec',
    description: 'Execute a CLI command with credentials injected via environment variables. The agent never sees the actual credential — Janee injects it and scrubs output.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: {
          type: 'string',
          description: 'Capability name (must be exec mode, from list_services)'
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command and arguments as array, e.g. ["gh", "issue", "list"]'
        },
        stdin: {
          type: 'string',
          description: 'Optional stdin input to pipe to the command'
        },
        reason: {
          type: 'string',
          description: 'Reason for this execution (required for some capabilities)'
        }
      },
      required: ['capability', 'command']
    }
  };


  // Tool: manage_credential (agent-scoped credential access control)
  const manageCredentialTool: Tool = {
    name: 'manage_credential',
    description: 'View or manage access policies for agent-scoped credentials. Agents can check who has access, grant access to other agents, or revoke access.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['view', 'grant', 'revoke'],
          description: 'Action to perform: view ownership info, grant access to another agent, or revoke access'
        },
        service: {
          type: 'string',
          description: 'Service name to manage'
        },
        targetAgentId: {
          type: 'string',
          description: 'Agent ID to grant/revoke access for (required for grant/revoke actions)'
        },
        agentId: {
          type: 'string',
          description: 'Your agent identifier (used to verify ownership)'
        }
      },
      required: ['action', 'service']
    }
  };

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: Tool[] = [listServicesTool, executeTool, manageCredentialTool];
    // Add exec tool if handler is provided
    if (onExecCommand) {
      tools.push(execTool);
    }
    // Only expose reload_config if a reload handler is provided
    if (onReloadConfig) {
      tools.push(reloadConfigTool);
    }
    return { tools };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_services': {
          const listAgentId = resolveAgentIdentity(
            { agentId: extra?.sessionId, metadata: { verifiedAgentId: extra?.authInfo?.clientId } },
            (args as any)?.agentId
          );
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(
                capabilities
                  .filter(cap => {
                    const svc = services.get(cap.service);
                    return canAgentAccess(listAgentId, svc?.ownership);
                  })
                  .map(cap => ({
                  name: cap.name,
                  service: cap.service,
                  mode: cap.mode || 'proxy',
                  ttl: cap.ttl,
                  autoApprove: cap.autoApprove,
                  requiresReason: cap.requiresReason,
                  rules: cap.rules,
                  ...(cap.mode === 'exec' && {
                    allowCommands: cap.allowCommands,
                    env: cap.env ? Object.keys(cap.env) : undefined,
                  })
                })),
                null,
                2
              )
            }]
          };
        }

        case 'reload_config': {
          if (!onReloadConfig) {
            throw new Error('Config reload not supported');
          }

          try {
            const result = onReloadConfig();
            const prevCapCount = capabilities.length;
            const prevServiceCount = services.size;
            
            capabilities = result.capabilities;
            services = result.services;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Configuration reloaded successfully',
                  services: services.size,
                  capabilities: capabilities.length,
                  changes: {
                    services: services.size - prevServiceCount,
                    capabilities: capabilities.length - prevCapCount
                  }
                }, null, 2)
              }]
            };
          } catch (error) {
            throw new Error(`Failed to reload config: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        case 'execute': {
          const { capability, method, path, body, headers, reason } = args as any;

          // Validate required arguments
          if (!capability) {
            throw new Error('Missing required argument: capability');
          }
          if (!method) {
            throw new Error('Missing required argument: method (GET, POST, PUT, DELETE, etc.)');
          }
          if (!path) {
            throw new Error('Missing required argument: path');
          }

          // Find capability
          const cap = capabilities.find(c => c.name === capability);
          if (!cap) {
            throw new Error(`Unknown capability: ${capability}`);
          }

          // Reject exec-mode capabilities — they should use janee_exec instead
          if (cap.mode === 'exec') {
            throw new Error(`Capability "${capability}" is an exec-mode capability. Use the 'janee_exec' tool instead.`);
          }

          // Check if reason required
          if (cap.requiresReason && !reason) {
            throw new Error(`Capability "${capability}" requires a reason`);
          }

          // Check rules (path-based policies)
          const ruleCheck = checkRules(cap.rules, method, path);
          if (!ruleCheck.allowed) {
            // Log denied request
            auditLogger.logDenied(
              cap.service,
              method,
              path,
              ruleCheck.reason || 'Request denied by policy',
              reason
            );
            throw new Error(ruleCheck.reason || 'Request denied by policy');
          }

          // Check agent-scoped access (transport-bound identity preferred over client-asserted)
          const executeAgentId = resolveAgentIdentity(
            { agentId: extra?.sessionId, metadata: { verifiedAgentId: extra?.authInfo?.clientId } },
            (args as any).agentId
          );
          const executeSvc = services.get(cap.service);
          if (!canAgentAccess(executeAgentId, executeSvc?.ownership)) {
            auditLogger.logDenied(
              cap.service,
              method,
              path,
              'Agent does not have access to this credential',
              reason
            );
            throw new Error(`Access denied: credential for service "${cap.service}" is not accessible to this agent`);
          }

          // Get or create session
          const ttlSeconds = parseTTL(cap.ttl);
          const session = sessionManager.createSession(
            cap.name,
            cap.service,
            ttlSeconds,
            { agentId: executeAgentId, reason }
          );

          // Build API request
          const apiReq: APIRequest = {
            service: cap.service,
            path,
            method,
            headers: headers || {},
            body
          };

          // Execute
          const response = await onExecute(session, apiReq);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                status: response.statusCode,
                body: response.body
              }, null, 2)
            }]
          };
        }


        case 'janee_exec': {
          if (!onExecCommand) {
            throw new Error('CLI execution not supported in this configuration');
          }

          const { capability: execCapName, command: rawExecCommand, stdin: execStdin, reason: execReason } = args as any;

          // Validate required arguments
          if (!execCapName) {
            throw new Error('Missing required argument: capability');
          }
          if (!rawExecCommand || (Array.isArray(rawExecCommand) && rawExecCommand.length === 0) || (typeof rawExecCommand === 'string' && rawExecCommand.trim() === '')) {
            throw new Error('Missing required argument: command');
          }

          // Normalize command to array — accept both string and array from MCP clients
          const execCommand: string[] = Array.isArray(rawExecCommand)
            ? rawExecCommand
            : typeof rawExecCommand === 'string'
              ? rawExecCommand.trim().split(/\s+/)
              : [];

          // Find capability
          const execCap = capabilities.find(c => c.name === execCapName);
          if (!execCap) {
            throw new Error(`Unknown capability: ${execCapName}`);
          }

          // Verify this is an exec-mode capability
          if (execCap.mode !== 'exec') {
            throw new Error(`Capability "${execCapName}" is not an exec-mode capability. Use the 'execute' tool for API proxy capabilities.`);
          }

          // Check if reason required
          if (execCap.requiresReason && !execReason) {
            throw new Error(`Capability "${execCapName}" requires a reason`);
          }

          // Validate command against whitelist
          const cmdValidation = validateCommand(execCommand, execCap.allowCommands || []);
          if (!cmdValidation.allowed) {
            auditLogger.logDenied(
              execCap.service,
              'EXEC',
              execCommand.join(' '),
              cmdValidation.reason || 'Command not allowed',
              execReason
            );
            throw new Error(cmdValidation.reason || 'Command not allowed');
          }

          // Get or create session
          const execTtlSeconds = parseTTL(execCap.ttl);
          const execSession = sessionManager.createSession(
            execCap.name,
            execCap.service,
            execTtlSeconds,
            { reason: execReason }
          );

          // Execute command
          const execResult = await onExecCommand(execSession, execCap, execCommand, execStdin);

          // Log to audit
          auditLogger.log({
            service: execCap.service,
            path: execCommand.join(' '),
            method: 'EXEC',
            headers: { 'x-janee-reason': execReason || '' },
          }, {
            statusCode: execResult.exitCode === 0 ? 200 : 500,
            headers: {},
            body: execResult.stdout,
          }, execResult.executionTimeMs);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                exitCode: execResult.exitCode,
                stdout: execResult.stdout,
                stderr: execResult.stderr,
                executionTimeMs: execResult.executionTimeMs,
              }, null, 2)
            }]
          };
        }

        case 'manage_credential': {
          const { action: credAction, service: credService, targetAgentId: credTarget } = args as any;
          const credAgentId = resolveAgentIdentity(
            { agentId: extra?.sessionId, metadata: { verifiedAgentId: extra?.authInfo?.clientId } },
            (args as any).agentId
          );

          if (!credService) {
            throw new Error('Missing required argument: service');
          }

          const svc = services.get(credService);
          if (!svc) {
            throw new Error(`Unknown service: ${credService}`);
          }

          if (credAction === 'view') {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  service: credService,
                  ownership: svc.ownership || { accessPolicy: 'all-agents', note: 'No ownership metadata (legacy credential)' },
                  yourAccess: canAgentAccess(credAgentId, svc.ownership)
                }, null, 2)
              }]
            };
          }

          // Grant/revoke require ownership verification
          if (!credAgentId) {
            throw new Error('agentId is required for grant/revoke actions');
          }

          if (!svc.ownership) {
            throw new Error('Cannot manage access for legacy credentials without ownership metadata. Re-add the service to enable scoping.');
          }

          if (svc.ownership.createdBy !== credAgentId) {
            throw new Error('Only the credential owner can grant or revoke access');
          }

          if (credAction === 'grant') {
            if (!credTarget) {
              throw new Error('targetAgentId is required for grant action');
            }
            const { grantAccess } = await import('./agent-scope.js');
            svc.ownership = grantAccess(svc.ownership, credTarget);

            // Persist ownership change to config storage
            if (onPersistOwnership) {
              onPersistOwnership(credService, svc.ownership);
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `Granted access to ${credTarget}`,
                  ownership: svc.ownership,
                  persisted: !!onPersistOwnership
                }, null, 2)
              }]
            };
          }

          if (credAction === 'revoke') {
            if (!credTarget) {
              throw new Error('targetAgentId is required for revoke action');
            }
            const { revokeAccess } = await import('./agent-scope.js');
            svc.ownership = revokeAccess(svc.ownership, credTarget);

            // Persist ownership change to config storage
            if (onPersistOwnership) {
              onPersistOwnership(credService, svc.ownership);
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: `Revoked access from ${credTarget}`,
                  ownership: svc.ownership,
                  persisted: !!onPersistOwnership
                }, null, 2)
              }]
            };
          }

          throw new Error(`Unknown action: ${credAction}. Use 'view', 'grant', or 'revoke'.`);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
          }, null, 2)
        }],
        isError: true
      };
    }
  });

  return server;
}

/**
 * Make HTTP/HTTPS request to real API
 */
export function makeAPIRequest(
  targetUrl: URL,
  request: APIRequest
): Promise<APIResponse> {
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: targetUrl.pathname + targetUrl.search,
      method: request.method,
      headers: {
        'User-Agent': 'janee/' + pkgVersion,
        ...request.headers
      }
    };

    const req = client.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers as Record<string, string | string[]>,
          body
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (request.body) {
      req.write(request.body);
    }

    req.end();
  });
}

/**
 * Start MCP server with stdio transport (default)
 */
export async function startMCPServer(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Janee MCP server started (stdio)');
}

/**
 * Start MCP server with StreamableHTTP transport over HTTP
 *
 * Note: Express is used for convenience (routing + body parsing).
 * StreamableHTTP only requires Node.js IncomingMessage/ServerResponse,
 * so you could use native http.createServer() if you prefer.
 */
export async function startMCPServerHTTP(
  server: Server,
  options: { host: string; port: number }
): Promise<void> {
  const app = express();

  // Parse JSON bodies (StreamableHTTP accepts pre-parsed body as third parameter)
  // This middleware runs globally but doesn't break streaming since we pass the parsed body
  app.use(express.json());

  // Create StreamableHTTP transport (replaces deprecated SSE transport)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
  });

  await server.connect(transport);

  // Handle GET and POST requests to /mcp endpoint
  // StreamableHTTP protocol uses GET for streaming responses and POST for requests
  app.all('/mcp', async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  return new Promise((resolve) => {
    app.listen(options.port, options.host, () => {
      console.error(`Janee MCP server listening on http://${options.host}:${options.port}/mcp (StreamableHTTP)`);
      resolve();
    });
  });
}

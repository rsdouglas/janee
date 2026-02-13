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
    type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account';
    key?: string;
    apiKey?: string;
    apiSecret?: string;
    passphrase?: string;  // For OKX
    headers?: Record<string, string>;
    credentials?: string;  // For service-account: encrypted JSON blob
    scopes?: string[];     // For service-account: OAuth scopes
  };
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
  sessionManager: SessionManager;
  auditLogger: AuditLogger;
  onExecute: (session: any, request: APIRequest) => Promise<APIResponse>;
  onExecCommand?: (session: any, capability: Capability, command: string[], stdin?: string) => Promise<ExecResult>;
  onReloadConfig?: () => ReloadResult;
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
  const { sessionManager, auditLogger, onExecute, onExecCommand, onReloadConfig } = options;
  
  // Store as mutable to support hot-reloading
  let capabilities = options.capabilities;
  let services = options.services;

  const server = new Server(
    {
      name: 'janee',
      version: '0.1.0'
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
    description: 'List available API capabilities managed by Janee',
    inputSchema: {
      type: 'object',
      properties: {},
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

  // Register tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [listServicesTool, executeTool];
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
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'list_services':
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(
                capabilities.map(cap => ({
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

          // Find capability
          const cap = capabilities.find(c => c.name === capability);
          if (!cap) {
            throw new Error(`Unknown capability: ${capability}`);
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

          // Get or create session
          const ttlSeconds = parseTTL(cap.ttl);
          const session = sessionManager.createSession(
            cap.name,
            cap.service,
            ttlSeconds,
            { reason }
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

          const { capability: execCapName, command: execCommand, stdin: execStdin, reason: execReason } = args as any;

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
      headers: request.headers
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

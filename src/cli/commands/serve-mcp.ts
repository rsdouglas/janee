import { randomUUID } from 'crypto';
import { URL } from 'url';

import { AuditLogger } from '../../core/audit';
import { buildAuthHeaders } from '../../core/auth.js';
import { DEFAULT_TIMEOUT_MS } from '../../core/types';
import { getErrorMessage } from '../cli-utils';
import {
  authorityAuthorizeExec,
  authorityCompleteExec,
  buildAuthorityHooks,
} from '../../core/authority.js';
import {
  buildExecEnv,
  executeCommand,
} from '../../core/exec.js';
import {
  getInstallationToken,
  GitHubAppCredentials,
} from '../../core/github-app';
import {
  Capability,
  makeAPIRequest,
  MCPServerOptions,
  ReloadResult,
  ServiceConfig,
  startMCPServer,
  startMCPServerHTTP,
} from '../../core/mcp-server';
import {
  forwardToolCall,
  resetAuthoritySession,
} from '../../core/runner-proxy.js';
import { runDoctorChecks } from './doctor';
import { SessionManager } from '../../core/sessions';
import {
  getAuditDir,
  hasYAMLConfig,
  loadYAMLConfig,
} from '../config-yaml';

/**
 * Load config and convert to MCP format
 */
function loadConfigForMCP(): ReloadResult {
  const config = loadYAMLConfig();

  const capabilities: Capability[] = Object.entries(config.capabilities).map(
    ([name, cap]) => ({
      name,
      service: cap.service,
      ttl: cap.ttl,
      autoApprove: cap.autoApprove,
      requiresReason: cap.requiresReason,
      rules: cap.rules,
      allowedAgents: cap.allowedAgents,
      // Exec mode fields (RFC 0001)
      mode: cap.mode || 'proxy',
      allowCommands: cap.allowCommands,
      env: cap.env,
      workDir: cap.workDir,
      timeout: cap.timeout,
    })
  );

  const services = new Map<string, ServiceConfig>();
  for (const [name, service] of Object.entries(config.services)) {
    services.set(name, service);
  }

  return { capabilities, services };
}

export interface ServeMCPOptions {
  transport?: 'stdio' | 'http';
  port?: string;
  host?: string;
  authority?: string;
  runnerKey?: string;
  runnerId?: string;
  runnerEnv?: string;
  runnerHostLabel?: string;
}

export async function serveMCPCommand(options: ServeMCPOptions = {}): Promise<void> {
  try {
    // Default options
    const transport = options.transport || 'stdio';
    const port = parseInt(options.port || '9100');
    const host = options.host || 'localhost';

    // Validate transport type
    if (transport !== 'stdio' && transport !== 'http') {
      console.error(`❌ Invalid transport type: ${transport}`);
      console.error('Valid options: stdio, http');
      process.exit(1);
    }

    const isRunnerMode = !!options.authority;

    // In standalone mode, local config is required. In runner mode, it's optional.
    if (!isRunnerMode && !hasYAMLConfig()) {
      console.error('❌ YAML config required for MCP mode');
      console.error('');
      console.error('Run: janee migrate');
      console.error('Or: janee init (for new setup)');
      process.exit(1);
    }

    const config = hasYAMLConfig() ? loadYAMLConfig() : { server: {}, services: {}, capabilities: {} };
    const sessionManager = new SessionManager();
    const auditLogger = new AuditLogger(getAuditDir(), {
      logBodies: (config as any).server?.logBodies ?? true
    });

    // Load initial config (may be empty in runner mode)
    const { capabilities, services } = hasYAMLConfig() ? loadConfigForMCP() : { capabilities: [] as Capability[], services: new Map<string, ServiceConfig>() };

    // Keep a mutable reference to services for the onExecute closure
    let currentServices = services;

    const runnerName = options.runnerId || process.env.JANEE_RUNNER_ID || 'janee-runner';

    // In HTTP standalone mode (no --authority), this is an Authority: hide janee_exec
    // since commands would run on the host, not in the agent's context.
    const isAuthorityHTTP = transport === 'http' && !isRunnerMode;

    const serverOptions: MCPServerOptions = {
      capabilities,
      services,
      sessionManager,
      auditLogger,
      defaultAccess: (config as any).server?.defaultAccess,
      hideExecTool: isAuthorityHTTP,

      // Runner proxy: forward non-exec tools to the Authority
      ...(isRunnerMode ? {
        onForwardToolCall: async (toolName: string, args: Record<string, unknown>, agentId?: string) => {
          return forwardToolCall(options.authority!, agentId || runnerName, toolName, args);
        },
        onDoctorRunner: async (agentId?: string) => {
          const runnerKey = options.runnerKey || process.env.JANEE_RUNNER_KEY;
          return runDoctorChecks(options.authority!, runnerKey, agentId || runnerName);
        },
      } : {}),

      // RFC 0001 + runner/authority mode: secure CLI execution handler
      onExecCommand: async (session, capability, command, stdin) => {
        const authorityUrl = options.authority;

        // Authority-backed runner mode
        if (authorityUrl) {
          const runnerKey = options.runnerKey || process.env.JANEE_RUNNER_KEY;
          if (!runnerKey) {
            throw new Error('Authority mode requires runner key (--runner-key or JANEE_RUNNER_KEY)');
          }

          const grant = await authorityAuthorizeExec(authorityUrl, runnerKey, {
            runner: {
              runnerId: options.runnerId || process.env.JANEE_RUNNER_ID || 'local-runner',
              environment: options.runnerEnv || process.env.JANEE_RUNNER_ENV || 'dev',
              hostLabel: options.runnerHostLabel || process.env.JANEE_RUNNER_HOST,
            },
            agentId: session?.agentId,
            capabilityId: capability.name,
            command,
            cwd: capability.workDir,
            timeoutMs: capability.timeout,
            requestId: randomUUID(),
          });

          const execResult = await executeCommand(command, grant.envInjections, {
            workDir: grant.constraints.cwd || capability.workDir,
            timeout: grant.effectiveTimeoutMs,
            stdin,
            credential: grant.scrubValues[0] || '',
            extraCredentials: {
              apiKey: grant.scrubValues[1],
              apiSecret: grant.scrubValues[2],
              passphrase: grant.scrubValues[3],
            },
          });

          await authorityCompleteExec(authorityUrl, runnerKey, {
            grantId: grant.grantId,
            exitCode: execResult.exitCode,
            startedAt: new Date(Date.now() - execResult.executionTimeMs).toISOString(),
            durationMs: execResult.executionTimeMs,
            stdoutBytes: Buffer.byteLength(execResult.stdout || '', 'utf8'),
            stderrBytes: Buffer.byteLength(execResult.stderr || '', 'utf8'),
            scrubbedStdoutHits: execResult.scrubbedStdoutHits || 0,
            scrubbedStderrHits: execResult.scrubbedStderrHits || 0,
          });

          return execResult;
        }

        // Standalone mode
        const serviceConfig = currentServices.get(capability.service);
        if (!serviceConfig) {
          throw new Error(`Service not found: ${capability.service}`);
        }

        let credential = '';
        let extraCredentials: { apiKey?: string; apiSecret?: string; passphrase?: string } | undefined;

        if (serviceConfig.auth.type === 'bearer' && serviceConfig.auth.key) {
          credential = serviceConfig.auth.key;
        } else if (
          serviceConfig.auth.type === 'hmac-mexc' ||
          serviceConfig.auth.type === 'hmac-bybit' ||
          serviceConfig.auth.type === 'hmac-okx'
        ) {
          extraCredentials = {
            apiKey: serviceConfig.auth.apiKey,
            apiSecret: serviceConfig.auth.apiSecret,
            passphrase: serviceConfig.auth.passphrase,
          };
        } else if (serviceConfig.auth.type === 'github-app' && serviceConfig.auth.appId && serviceConfig.auth.privateKey && serviceConfig.auth.installationId) {
          const ghCreds: GitHubAppCredentials = {
            appId: serviceConfig.auth.appId,
            privateKey: serviceConfig.auth.privateKey,
            installationId: serviceConfig.auth.installationId,
          };
          credential = await getInstallationToken(capability.service, ghCreds);
        }

        const injectedEnv = buildExecEnv(
          capability.env || {},
          credential,
          extraCredentials
        );

        return executeCommand(command, injectedEnv, {
          workDir: capability.workDir,
          timeout: capability.timeout || DEFAULT_TIMEOUT_MS,
          stdin,
          credential,
          extraCredentials,
        });
      },

      onReloadConfig: () => {
        if (options.authority) {
          // Runner mode: forward reload to Authority, then refresh our forwarded view
          const runnerName = options.runnerId || process.env.JANEE_RUNNER_ID || 'janee-runner';
          forwardToolCall(options.authority, runnerName, 'reload_config', {}).catch(() => {});
          resetAuthoritySession();
        }
        const result = loadConfigForMCP();
        currentServices = result.services;
        return result;
      },

      onExecute: async (session, request) => {
        // In runner mode, execute calls are forwarded by onForwardToolCall
        // before reaching this handler. This is standalone-only.
        const serviceConfig = currentServices.get(request.service);
        if (!serviceConfig) {
          throw new Error(`Service not found: ${request.service}`);
        }

        // Build target URL (properly join base + path)
        let baseUrl = serviceConfig.baseUrl;
        if (!baseUrl.endsWith('/')) baseUrl += '/';
        let reqPath = request.path;
        if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
        const targetUrl = new URL(reqPath, baseUrl);

        // SSRF protection: validate origin matches service baseUrl (issue #16)
        const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
        if (targetUrl.origin !== serviceOrigin) {
          throw new Error(`Request blocked: URL origin ${targetUrl.origin} does not match service origin ${serviceOrigin}`);
        }

        // Build headers with auth injection
        const headers: Record<string, string> = { ...request.headers };
        const authResult = await buildAuthHeaders(request.service, serviceConfig, {
          method: request.method,
          targetUrl,
          body: request.body,
        });
        Object.assign(headers, authResult.headers);
        if (authResult.urlParams) {
          for (const [key, value] of Object.entries(authResult.urlParams)) {
            targetUrl.searchParams.set(key, value);
          }
        }

        // Set Content-Type for requests with body
        if (request.body && !headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }

        // Make API request
        const response = await makeAPIRequest(targetUrl, {
          ...request,
          headers
        });

        // Log to audit
        auditLogger.log(request, response);

        return response;
      }
    };

    // Start server with selected transport
    if (transport === 'http') {
      const runnerKey = options.runnerKey || process.env.JANEE_RUNNER_KEY;
      const isAuthority = runnerKey && !options.authority;

      await startMCPServerHTTP(serverOptions, {
        host,
        port,
        // When we have a runner key but no --authority, we ARE the authority
        ...(isAuthority ? {
          runnerKey,
          authorityHooks: buildAuthorityHooks(
            {
              services: Object.fromEntries(currentServices),
              capabilities: serverOptions.capabilities,
            },
            auditLogger,
          ),
        } : {}),
      });

      process.on('SIGHUP', () => reloadConfig((result) => {
        serverOptions.capabilities = result.capabilities;
        serverOptions.services = result.services;
      }));
    } else {
      const mcpResult = await startMCPServer(serverOptions);

      process.on('SIGHUP', () => reloadConfig((result) => {
        mcpResult.reloadConfig(result);
      }));
    }

    function reloadConfig(apply: (result: ReloadResult) => void): void {
      try {
        const result = loadConfigForMCP();
        apply(result);
        currentServices = result.services;
        console.error(`[janee] SIGHUP: reloaded config (${result.capabilities.length} capabilities, ${result.services.size} services)`);
      } catch (err) {
        console.error(`[janee] SIGHUP reload failed: ${getErrorMessage(err)}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', getErrorMessage(error));
    process.exit(1);
  }
}

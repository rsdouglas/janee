import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';
import { startMCPServer, startMCPServerHTTP, MCPServerOptions, Capability, ServiceConfig, makeAPIRequest, ReloadResult } from '../../core/mcp-server';
import { SessionManager } from '../../core/sessions';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { signBybit, signOKX, signMEXC } from '../../core/signing';
import { getAccessToken, validateServiceAccountCredentials, ServiceAccountCredentials, clearCachedToken } from '../../core/service-account';
import { getInstallationToken, clearCachedInstallationToken, GitHubAppCredentials } from '../../core/github-app';
import { URL } from 'url';
import { buildExecEnv, executeCommand } from '../../core/exec.js';
import { authorityAuthorizeExec, authorityCompleteExec, buildAuthorityHooks } from '../../core/authority.js';
import { forwardToolCall, resetAuthoritySession } from '../../core/runner-proxy.js';
import { randomUUID } from 'crypto';

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
        onForwardToolCall: async (toolName: string, args: Record<string, unknown>) => {
          return forwardToolCall(options.authority!, runnerName, toolName, args);
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
          timeout: capability.timeout || 30000,
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

        // Build headers
        const headers: Record<string, string> = { ...request.headers };

        // Inject auth
        if (serviceConfig.auth.type === 'bearer' && serviceConfig.auth.key) {
          headers['Authorization'] = `Bearer ${serviceConfig.auth.key}`;
        } else if (serviceConfig.auth.type === 'headers' && serviceConfig.auth.headers) {
          Object.assign(headers, serviceConfig.auth.headers);
        } else if (serviceConfig.auth.type === 'hmac-mexc' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // MEXC HMAC - signs query string, adds signature as URL param
          const result = signMEXC({
            apiKey: serviceConfig.auth.apiKey,
            apiSecret: serviceConfig.auth.apiSecret,
            queryString: targetUrl.searchParams.toString()
          });
          Object.assign(headers, result.headers);
          if (result.urlParams) {
            for (const [key, value] of Object.entries(result.urlParams)) {
              targetUrl.searchParams.set(key, value);
            }
          }
        } else if (serviceConfig.auth.type === 'hmac-bybit' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // Bybit-style HMAC - signature in headers
          const result = signBybit({
            apiKey: serviceConfig.auth.apiKey,
            apiSecret: serviceConfig.auth.apiSecret,
            method: request.method,
            queryString: targetUrl.searchParams.toString(),
            body: request.body
          });
          Object.assign(headers, result.headers);
        } else if (serviceConfig.auth.type === 'hmac-okx' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret && serviceConfig.auth.passphrase) {
          // OKX-style HMAC - signature with passphrase, base64 encoded
          const result = signOKX({
            apiKey: serviceConfig.auth.apiKey,
            apiSecret: serviceConfig.auth.apiSecret,
            passphrase: serviceConfig.auth.passphrase,
            method: request.method,
            requestPath: '/' + reqPath + (targetUrl.search || ''),
            body: request.body
          });
          Object.assign(headers, result.headers);
        } else if (serviceConfig.auth.type === 'service-account' && serviceConfig.auth.credentials && serviceConfig.auth.scopes) {
          // Google service account OAuth2
          try {
            const credentials = JSON.parse(serviceConfig.auth.credentials) as ServiceAccountCredentials;
            validateServiceAccountCredentials(credentials);

            const accessToken = await getAccessToken(
              request.service,
              credentials,
              serviceConfig.auth.scopes
            );

            headers['Authorization'] = `Bearer ${accessToken}`;
          } catch (error) {
            // If we get a 401, clear cache and retry once
            if (error instanceof Error && error.message.includes('401')) {
              clearCachedToken(request.service, serviceConfig.auth.scopes);
              const credentials = JSON.parse(serviceConfig.auth.credentials) as ServiceAccountCredentials;
              const accessToken = await getAccessToken(
                request.service,
                credentials,
                serviceConfig.auth.scopes
              );
              headers['Authorization'] = `Bearer ${accessToken}`;
            } else {
              throw error;
            }
          }
        } else if (serviceConfig.auth.type === 'github-app' && serviceConfig.auth.appId && serviceConfig.auth.privateKey && serviceConfig.auth.installationId) {
          const ghCreds: GitHubAppCredentials = {
            appId: serviceConfig.auth.appId,
            privateKey: serviceConfig.auth.privateKey,
            installationId: serviceConfig.auth.installationId,
          };
          try {
            const installationToken = await getInstallationToken(request.service, ghCreds);
            headers['Authorization'] = `Bearer ${installationToken}`;
          } catch (error) {
            if (error instanceof Error && error.message.includes('401')) {
              clearCachedInstallationToken(request.service);
              const installationToken = await getInstallationToken(request.service, ghCreds);
              headers['Authorization'] = `Bearer ${installationToken}`;
            } else {
              throw error;
            }
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
    } else {
      await startMCPServer(serverOptions);
    }

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

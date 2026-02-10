import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';
import { createMCPServer, startMCPServer, Capability, ServiceConfig, makeAPIRequest, ReloadResult } from '../../core/mcp-server';
import { SessionManager } from '../../core/sessions';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { signBybit, signOKX, signMEXC } from '../../core/signing';
import { getAccessToken, validateServiceAccountCredentials, ServiceAccountCredentials, clearCachedToken } from '../../core/service-account';
import { URL } from 'url';

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
      rules: cap.rules
    })
  );

  const services = new Map<string, ServiceConfig>();
  for (const [name, service] of Object.entries(config.services)) {
    services.set(name, service);
  }

  return { capabilities, services };
}

export async function serveMCPCommand(): Promise<void> {
  try {
    // Check for YAML config
    if (!hasYAMLConfig()) {
      console.error('❌ YAML config required for MCP mode');
      console.error('');
      console.error('Run: janee migrate');
      console.error('Or: janee init (for new setup)');
      process.exit(1);
    }

    const config = loadYAMLConfig();
    const sessionManager = new SessionManager();
    const auditLogger = new AuditLogger(getAuditDir(), {
      logBodies: config.server?.logBodies ?? true
    });

    // Load initial config
    const { capabilities, services } = loadConfigForMCP();
    
    // Keep a mutable reference to services for the onExecute closure
    let currentServices = services;

    // Create MCP server
    const mcpServer = createMCPServer({
      capabilities,
      services,
      sessionManager,
      auditLogger,
      
      onReloadConfig: () => {
        const result = loadConfigForMCP();
        // Update our local reference for onExecute
        currentServices = result.services;
        return result;
      },
      
      onExecute: async (session, request) => {
        // Get service config (use currentServices for hot-reload support)
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
        } else if (serviceConfig.auth.type === 'hmac' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // Generic HMAC - signs query string, adds signature as URL param (MEXC, etc.)
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
    });

    // Start server
    await startMCPServer(mcpServer);

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

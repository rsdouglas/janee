import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';
import { createMCPServer, startMCPServer, Capability, ServiceConfig, makeAPIRequest, ReloadResult } from '../../core/mcp-server';
import { SessionManager } from '../../core/sessions';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { URL } from 'url';
import { createHmac } from 'crypto';

interface ConfigForMCP extends ReloadResult {
  defaultPolicy: 'allow' | 'deny';
}

/**
 * Load config and convert to MCP format
 */
function loadConfigForMCP(): ConfigForMCP {
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

  return { capabilities, services, defaultPolicy: config.defaultPolicy || 'allow' };
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

    const sessionManager = new SessionManager();
    const auditLogger = new AuditLogger(getAuditDir());

    // Load initial config
    const { capabilities, services, defaultPolicy } = loadConfigForMCP();

    // Startup security warnings
    const config = loadYAMLConfig();
    if (!config.defaultPolicy) {
      console.error('Security: defaultPolicy is not set; defaulting to "allow" (backward-compatible).');
      console.error('  Consider adding `defaultPolicy: deny` to ~/.janee/config.yaml');
      console.error('');
    }
    const rulelessCaps = capabilities.filter(c => !c.rules || (!c.rules.allow && !c.rules.deny));
    for (const cap of rulelessCaps) {
      if (defaultPolicy === 'deny') {
        console.error(`  ${cap.name}: no rules defined — DENIES ALL requests (defaultPolicy: deny)`);
      } else {
        console.error(`  Warning: ${cap.name}: no rules defined — ALLOWS ALL requests to ${cap.service}`);
      }
    }
    if (rulelessCaps.length > 0) console.error('');

    // Keep a mutable reference to services for the onExecute closure
    let currentServices = services;

    // Create MCP server
    const mcpServer = createMCPServer({
      capabilities,
      services,
      defaultPolicy,
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

        // Build headers
        const headers: Record<string, string> = { ...request.headers };

        // Inject auth
        if (serviceConfig.auth.type === 'bearer' && serviceConfig.auth.key) {
          headers['Authorization'] = `Bearer ${serviceConfig.auth.key}`;
        } else if (serviceConfig.auth.type === 'headers' && serviceConfig.auth.headers) {
          Object.assign(headers, serviceConfig.auth.headers);
        } else if (serviceConfig.auth.type === 'hmac' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // HMAC signature (MEXC-style) - query param signature
          const timestamp = Date.now().toString();
          targetUrl.searchParams.set('timestamp', timestamp);
          
          // Create signature from query string
          const queryString = targetUrl.searchParams.toString();
          const signature = createHmac('sha256', serviceConfig.auth.apiSecret)
            .update(queryString)
            .digest('hex');
          
          targetUrl.searchParams.set('signature', signature);
          headers['X-MEXC-APIKEY'] = serviceConfig.auth.apiKey;
        } else if (serviceConfig.auth.type === 'hmac-bybit' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // Bybit-style HMAC - header signature
          const timestamp = Date.now().toString();
          const recvWindow = '5000';
          const queryString = targetUrl.searchParams.toString();
          
          // Signature payload: timestamp + apiKey + recvWindow + queryString
          const signPayload = timestamp + serviceConfig.auth.apiKey + recvWindow + queryString;
          const signature = createHmac('sha256', serviceConfig.auth.apiSecret)
            .update(signPayload)
            .digest('hex');
          
          headers['X-BAPI-API-KEY'] = serviceConfig.auth.apiKey;
          headers['X-BAPI-TIMESTAMP'] = timestamp;
          headers['X-BAPI-SIGN'] = signature;
          headers['X-BAPI-RECV-WINDOW'] = recvWindow;
        } else if (serviceConfig.auth.type === 'hmac-okx' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret && serviceConfig.auth.passphrase) {
          // OKX-style HMAC - header signature with passphrase, base64 encoded
          const timestamp = new Date().toISOString().slice(0, -1) + 'Z'; // ISO8601 format
          const method = request.method.toUpperCase();
          const requestPath = '/' + reqPath + (targetUrl.search || '');
          const body = request.body || '';
          
          // Signature payload: timestamp + method + requestPath + body
          const signPayload = timestamp + method + requestPath + body;
          const signature = createHmac('sha256', serviceConfig.auth.apiSecret)
            .update(signPayload)
            .digest('base64');
          
          headers['OK-ACCESS-KEY'] = serviceConfig.auth.apiKey;
          headers['OK-ACCESS-SIGN'] = signature;
          headers['OK-ACCESS-TIMESTAMP'] = timestamp;
          headers['OK-ACCESS-PASSPHRASE'] = serviceConfig.auth.passphrase;
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

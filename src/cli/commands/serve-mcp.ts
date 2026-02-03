import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';
import { createMCPServer, startMCPServer, Capability, ServiceConfig, makeAPIRequest } from '../../core/mcp-server';
import { SessionManager } from '../../core/sessions';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { URL } from 'url';
import { createHmac } from 'crypto';

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
    const auditLogger = new AuditLogger(getAuditDir());

    // Convert config to MCP format
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

    // Create MCP server
    const mcpServer = createMCPServer({
      capabilities,
      services,
      sessionManager,
      auditLogger,
      
      onExecute: async (session, request) => {
        // Get service config
        const serviceConfig = services.get(request.service);
        if (!serviceConfig) {
          throw new Error(`Service not found: ${request.service}`);
        }

        // Build target URL
        const targetUrl = new URL(request.path, serviceConfig.baseUrl);

        // Build headers
        const headers: Record<string, string> = { ...request.headers };

        // Inject auth
        if (serviceConfig.auth.type === 'bearer' && serviceConfig.auth.key) {
          headers['Authorization'] = `Bearer ${serviceConfig.auth.key}`;
        } else if (serviceConfig.auth.type === 'headers' && serviceConfig.auth.headers) {
          Object.assign(headers, serviceConfig.auth.headers);
        } else if (serviceConfig.auth.type === 'hmac' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
          // HMAC signature (MEXC-style)
          const timestamp = Date.now().toString();
          targetUrl.searchParams.set('timestamp', timestamp);
          
          // Create signature from query string
          const queryString = targetUrl.searchParams.toString();
          const signature = createHmac('sha256', serviceConfig.auth.apiSecret)
            .update(queryString)
            .digest('hex');
          
          targetUrl.searchParams.set('signature', signature);
          headers['X-MEXC-APIKEY'] = serviceConfig.auth.apiKey;
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

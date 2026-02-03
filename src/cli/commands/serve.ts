import { loadConfig, getService, getServiceKey } from '../config';
import { createProxyServer } from '../../core/proxy';
import { AuditLogger } from '../../core/audit';
import path from 'path';
import os from 'os';

export async function serveCommand(options: { port: string; llm: boolean }): Promise<void> {
  try {
    const config = loadConfig();
    const port = parseInt(options.port) || config.settings.port;

    // Initialize audit logger
    const auditLogger = new AuditLogger(
      path.join(os.homedir(), '.janee', 'logs')
    );

    // Create proxy server
    const server = createProxyServer({
      getServiceKey: (serviceName) => {
        return getServiceKey(serviceName);
      },
      
      getServiceBaseUrl: (serviceName) => {
        const service = getService(serviceName);
        if (!service) {
          throw new Error(`Service "${serviceName}" not found`);
        }
        return service.baseUrl;
      },

      onRequest: async (req) => {
        console.log(`→ ${req.method} /${req.service}${req.path}`);
      },

      onResponse: async (req, res) => {
        const statusColor = res.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        const reset = '\x1b[0m';
        console.log(`← ${statusColor}${res.statusCode}${reset} ${req.method} /${req.service}${req.path}`);
        
        // Log to audit
        auditLogger.log(req, res);
      }
    });

    // Start server
    server.listen(port, () => {
      console.log('');
      console.log('🔐 Janee proxy server running');
      console.log('');
      console.log(`   Local:   http://localhost:${port}`);
      console.log('');
      console.log('Services configured:');
      config.services.forEach(s => {
        console.log(`   • ${s.name} → http://localhost:${port}/${s.name}/...`);
      });
      console.log('');
      console.log('Press Ctrl+C to stop');
      console.log('');
    });

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('\n\n👋 Shutting down Janee proxy...');
      server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
      });
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

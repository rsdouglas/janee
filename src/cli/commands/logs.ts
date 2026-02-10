import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';

export async function logsCommand(options: {
  follow?: boolean;
  lines?: string;
  service?: string;
  json?: boolean;
}): Promise<void> {
  try {
    const auditLogger = new AuditLogger(getAuditDir());

    if (options.follow) {
      // JSON mode not supported for follow (streaming)
      if (options.json) {
        console.log(JSON.stringify({ error: '--json not supported with --follow' }, null, 2));
        process.exit(1);
      }

      // Tail logs in real-time
      console.log('Following logs (Ctrl+C to stop)...\n');

      for await (const event of auditLogger.tail()) {
        const timestamp = new Date(event.timestamp).toLocaleTimeString();
        const statusColor = event.statusCode && event.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        const reset = '\x1b[0m';
        
        console.log(
          `${timestamp} ${event.method.padEnd(6)} /${event.service}${event.path} ${statusColor}${event.statusCode || '---'}${reset}`
        );
      }
    } else {
      // Show recent logs
      const limit = parseInt(options.lines || '20');
      const events = await auditLogger.readLogs({
        limit,
        service: options.service
      });

      if (options.json) {
        // JSON output
        const output = events.reverse().map(event => ({
          id: event.id,
          timestamp: event.timestamp,
          method: event.method,
          service: event.service,
          path: event.path,
          statusCode: event.statusCode,
          duration: event.duration,
          agentId: event.agentId,
          denied: event.denied,
          denyReason: event.denyReason,
          reason: event.reason
        }));
        
        console.log(JSON.stringify({ logs: output }, null, 2));
        return;
      }

      // Human-readable output
      if (events.length === 0) {
        console.log('No logs found.');
        console.log('');
        console.log('Logs will appear when you use the proxy:');
        console.log('  janee serve');
        return;
      }

      console.log('');
      console.log(`Recent activity (last ${events.length} requests):`);
      console.log('');

      events.reverse().forEach(event => {
        const timestamp = new Date(event.timestamp).toLocaleString();
        const statusColor = event.statusCode && event.statusCode >= 400 ? '\x1b[31m' : '\x1b[32m';
        const reset = '\x1b[0m';
        
        console.log(
          `${timestamp} ${event.method.padEnd(6)} /${event.service}${event.path} ${statusColor}${event.statusCode || '---'}${reset}`
        );
      });

      console.log('');
    }

  } catch (error) {
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Unknown error occurred' }, null, 2));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

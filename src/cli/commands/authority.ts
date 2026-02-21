import { loadYAMLConfig } from '../config-yaml';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { createAuthorityApp, buildAuthorityHooks } from '../../core/authority';
import { createHash } from 'crypto';
import http from 'http';

export interface AuthorityOptions {
  port?: string;
  host?: string;
  runnerKey?: string;
}

export async function authorityCommand(options: AuthorityOptions = {}): Promise<void> {
  const config = loadYAMLConfig();
  const port = parseInt(options.port || '9120', 10);
  const host = options.host || '127.0.0.1';
  const runnerKey = options.runnerKey || process.env.JANEE_RUNNER_KEY;

  if (!runnerKey) {
    throw new Error('Runner key required: provide --runner-key or JANEE_RUNNER_KEY');
  }

  const auditLogger = new AuditLogger(getAuditDir(), {
    logBodies: config.server?.logBodies ?? true,
  });

  const capabilities = Object.entries(config.capabilities).map(([name, cap]) => ({
    name,
    service: cap.service,
    ttl: cap.ttl,
    mode: cap.mode || 'proxy',
    allowCommands: cap.allowCommands,
    env: cap.env,
    workDir: cap.workDir,
    timeout: cap.timeout,
    allowedAgents: cap.allowedAgents,
  }));

  const hooks = buildAuthorityHooks(
    { services: config.services, capabilities },
    auditLogger,
  );

  const app = createAuthorityApp(runnerKey, hooks);

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(port, host, () => {
      const fingerprint = createHash('sha256').update(runnerKey).digest('hex').slice(0, 12);
      console.error(`Authority listening on http://${host}:${port}`);
      console.error(`Runner key fingerprint: ${fingerprint}`);
      resolve();
    });
  });
}

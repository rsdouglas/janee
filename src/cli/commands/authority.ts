import { loadYAMLConfig } from '../config-yaml';
import { AuditLogger } from '../../core/audit';
import { getAuditDir } from '../config-yaml';
import { Capability } from '../../core/mcp-server';
import { buildExecEnv, hashPolicyFingerprint, validateCommand } from '../../core/exec';
import { createAuthorityApp, ExecAuthorizeRequest, ExecAuthorizeResponse } from '../../core/authority';
import { createHash, randomUUID } from 'crypto';
import http from 'http';

export interface AuthorityOptions {
  port?: string;
  host?: string;
  runnerKey?: string;
}

function maskSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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

  const capabilities: Capability[] = Object.entries(config.capabilities).map(([name, cap]) => ({
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

  const grantCache = new Map<string, { startedAt: number; capabilityId: string }>();

  const app = createAuthorityApp(runnerKey, {
    authorizeExec: async (req: ExecAuthorizeRequest): Promise<ExecAuthorizeResponse> => {
      const cap = capabilities.find((c) => c.name === req.capabilityId);
      if (!cap) throw new Error(`Unknown capability: ${req.capabilityId}`);
      if (cap.mode !== 'exec') throw new Error('Capability is not exec-mode');

      if (cap.allowedAgents && cap.allowedAgents.length > 0 && req.agentId && !cap.allowedAgents.includes(req.agentId)) {
        throw new Error(`Agent ${req.agentId} is not allowed for capability ${cap.name}`);
      }

      const cmdCheck = validateCommand(req.command, cap.allowCommands || []);
      if (!cmdCheck.allowed) {
        throw new Error(cmdCheck.reason || 'Command denied by policy');
      }

      const service = config.services[cap.service];
      if (!service) throw new Error(`Service not found: ${cap.service}`);

      let credential = '';
      let extraCredentials: { apiKey?: string; apiSecret?: string; passphrase?: string } | undefined;
      if (service.auth.type === 'bearer') {
        credential = service.auth.key || '';
      } else if (service.auth.type === 'hmac-mexc' || service.auth.type === 'hmac-bybit' || service.auth.type === 'hmac-okx') {
        extraCredentials = {
          apiKey: service.auth.apiKey,
          apiSecret: service.auth.apiSecret,
          passphrase: service.auth.passphrase,
        };
      }

      const envInjections = buildExecEnv(cap.env || {}, credential, extraCredentials);
      const scrubValues = [credential, extraCredentials?.apiKey, extraCredentials?.apiSecret, extraCredentials?.passphrase]
        .filter((v): v is string => Boolean(v));

      const grantId = randomUUID();
      grantCache.set(grantId, { startedAt: Date.now(), capabilityId: cap.name });
      const effectiveTimeoutMs = Math.min(req.timeoutMs || cap.timeout || 30000, cap.timeout || 30000);

      return {
        grantId,
        grantExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        effectiveTimeoutMs,
        envInjections,
        scrubValues,
        constraints: {
          cwd: cap.workDir,
          policyHash: hashPolicyFingerprint(cap),
          executable: req.command[0],
          command: req.command,
        },
      };
    },
    completeExec: async (req) => {
      const grant = grantCache.get(req.grantId);
      grantCache.delete(req.grantId);
      auditLogger.log({
        service: grant?.capabilityId || 'unknown',
        method: 'EXEC_COMPLETE',
        path: req.grantId,
        headers: {},
        body: undefined,
      }, {
        statusCode: req.exitCode === 0 ? 200 : 500,
        headers: {},
        body: JSON.stringify({
          durationMs: req.durationMs,
          stdoutBytes: req.stdoutBytes,
          stderrBytes: req.stderrBytes,
          scrubbedStdoutHits: req.scrubbedStdoutHits,
          scrubbedStderrHits: req.scrubbedStderrHits,
        }),
      }, req.durationMs);
    },
  });

  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(port, host, () => {
      console.error(`Authority listening on http://${host}:${port}`);
      console.error(`Runner key fingerprint: ${maskSecret(runnerKey).slice(0, 12)}`);
      resolve();
    });
  });
}

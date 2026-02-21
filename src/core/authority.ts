import express from 'express';
import { randomUUID, timingSafeEqual } from 'crypto';
import { validateCommand, buildExecEnv, hashPolicyFingerprint } from './exec.js';

export interface RunnerIdentity {
  runnerId: string;
  environment?: string;
  hostLabel?: string;
}

export interface ExecAuthorizeRequest {
  runner: RunnerIdentity;
  agentId?: string;
  capabilityId: string;
  command: string[];
  cwd?: string;
  timeoutMs?: number;
  reason?: string;
  requestId?: string;
}

export interface ExecAuthorizeResponse {
  grantId: string;
  grantExpiresAt: string;
  effectiveTimeoutMs: number;
  envInjections: Record<string, string>;
  scrubValues: string[];
  constraints: {
    cwd?: string;
    policyHash: string;
    executable: string;
    command: string[];
  };
}

export interface ExecCompleteRequest {
  grantId: string;
  exitCode: number;
  startedAt: string;
  durationMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  scrubbedStdoutHits: number;
  scrubbedStderrHits: number;
}

export interface AuthorityExecHooks {
  authorizeExec: (req: ExecAuthorizeRequest) => Promise<ExecAuthorizeResponse>;
  completeExec: (req: ExecCompleteRequest) => Promise<void>;
}

export function createAuthorityApp(apiKey: string, hooks: AuthorityExecHooks): express.Express {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  app.use((req, res, next) => {
    if (req.path === '/v1/health') {
      next();
      return;
    }

    const provided = req.header('x-janee-runner-key');
    if (!provided || provided.length !== apiKey.length ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey))) {
      res.status(401).json({ error: 'Unauthorized runner request' });
      return;
    }
    next();
  });

  app.get('/v1/health', (_req, res) => {
    res.status(200).json({ ok: true, mode: 'authority' });
  });

  app.post('/v1/exec/authorize', async (req, res) => {
    try {
      const body = req.body as ExecAuthorizeRequest;
      if (!body?.runner?.runnerId || !Array.isArray(body?.command) || body.command.length === 0 || !body.capabilityId) {
        res.status(400).json({ error: 'Invalid authorize request' });
        return;
      }
      const response = await hooks.authorizeExec(body);
      res.status(200).json(response);
    } catch (error) {
      res.status(403).json({ error: error instanceof Error ? error.message : 'Authorization failed' });
    }
  });

  app.post('/v1/exec/complete', async (req, res) => {
    try {
      const body = req.body as ExecCompleteRequest;
      if (!body?.grantId) {
        res.status(400).json({ error: 'grantId is required' });
        return;
      }
      await hooks.completeExec(body);
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'completion failed' });
    }
  });

  return app;
}

/**
 * Build standard authority exec hooks from config.
 * Used by both standalone `janee authority` and integrated HTTP serve.
 */
export function buildAuthorityHooks(
  config: { services: Record<string, any>; capabilities: Array<{ name: string; service: string; mode?: string; allowCommands?: string[]; env?: Record<string, string>; workDir?: string; timeout?: number; allowedAgents?: string[] }> },
  auditLogger: { log: (req: any, res: any, duration?: number) => void },
): AuthorityExecHooks {
  const grantCache = new Map<string, { startedAt: number; capabilityId: string }>();

  return {
    authorizeExec: async (req: ExecAuthorizeRequest): Promise<ExecAuthorizeResponse> => {
      const cap = config.capabilities.find((c) => c.name === req.capabilityId);
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
  };
}

export async function authorityAuthorizeExec(
  authorityUrl: string,
  runnerKey: string,
  request: ExecAuthorizeRequest
): Promise<ExecAuthorizeResponse> {
  const res = await fetch(`${authorityUrl.replace(/\/$/, '')}/v1/exec/authorize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-janee-runner-key': runnerKey,
      'x-janee-request-id': request.requestId || randomUUID(),
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Authority authorize failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<ExecAuthorizeResponse>;
}

export async function authorityCompleteExec(
  authorityUrl: string,
  runnerKey: string,
  request: ExecCompleteRequest
): Promise<void> {
  const res = await fetch(`${authorityUrl.replace(/\/$/, '')}/v1/exec/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-janee-runner-key': runnerKey,
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Authority completion failed (${res.status}): ${body}`);
  }
}

import express from 'express';
import { randomUUID } from 'crypto';

export interface RunnerIdentity {
  runnerId: string;
  environment?: string;
  hostLabel?: string;
  creatureId?: string;
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
    if (!provided || provided !== apiKey) {
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

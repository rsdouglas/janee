import { describe, expect, it } from 'vitest';
import { createAuthorityApp, authorityAuthorizeExec, authorityCompleteExec } from './authority';
import http from 'http';

describe('authority API', () => {
  it('authorizes and completes an execution lifecycle', async () => {
    const calls: string[] = [];
    const app = createAuthorityApp('runner-secret', {
      authorizeExec: async (req) => {
        calls.push(`authorize:${req.capabilityId}`);
        return {
          grantId: 'grant-1',
          grantExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          effectiveTimeoutMs: 1000,
          envInjections: { GH_TOKEN: 'abc123456789' },
          scrubValues: ['abc123456789'],
          constraints: {
            cwd: '/tmp/work',
            policyHash: 'policy-123',
            executable: req.command[0],
            command: req.command,
          },
        };
      },
      completeExec: async (req) => {
        calls.push(`complete:${req.grantId}:${req.exitCode}`);
      },
    });

    const server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an inet server address');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const grant = await authorityAuthorizeExec(baseUrl, 'runner-secret', {
      runner: { runnerId: 'r-1' },
      capabilityId: 'github-patch',
      command: ['gh', 'pr', 'view'],
      timeoutMs: 5000,
    });

    expect(grant.grantId).toBe('grant-1');
    expect(grant.envInjections.GH_TOKEN).toBe('abc123456789');

    await authorityCompleteExec(baseUrl, 'runner-secret', {
      grantId: grant.grantId,
      exitCode: 0,
      startedAt: new Date().toISOString(),
      durationMs: 20,
      stdoutBytes: 100,
      stderrBytes: 0,
      scrubbedStdoutHits: 1,
      scrubbedStderrHits: 0,
    });

    expect(calls).toEqual(['authorize:github-patch', 'complete:grant-1:0']);

    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  });
});

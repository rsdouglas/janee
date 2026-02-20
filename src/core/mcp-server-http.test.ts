import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startMCPServerHTTP, MCPServerOptions } from './mcp-server';
import { SessionManager } from './sessions';
import { AuditLogger } from './audit';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

function makeOptions(): MCPServerOptions {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-http-test-'));
  return {
    capabilities: [
      {
        name: 'test-cap',
        service: 'test-svc',
        ttl: '1h',
        mode: 'proxy',
      },
    ],
    services: new Map([
      [
        'test-svc',
        {
          url: 'https://example.com',
          auth: { type: 'bearer' as const, key: 'test-key' },
        },
      ],
    ]),
    sessionManager: new SessionManager(),
    auditLogger: new AuditLogger(tmpDir),
    onExecute: async () => ({ status: 200, body: '{}' }),
  };
}

describe('startMCPServerHTTP lifecycle', () => {
  let handle: Awaited<ReturnType<typeof startMCPServerHTTP>> | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  });

  it('returns a handle with close() and sessionCount()', async () => {
    handle = await startMCPServerHTTP(makeOptions(), {
      host: '127.0.0.1',
      port: 0, // let OS pick a port
    });

    expect(typeof handle.close).toBe('function');
    expect(typeof handle.sessionCount).toBe('function');
    expect(handle.sessionCount()).toBe(0);
  });

  it('close() shuts down the HTTP server', async () => {
    handle = await startMCPServerHTTP(makeOptions(), {
      host: '127.0.0.1',
      port: 0,
    });

    await handle.close();
    handle = undefined; // prevent double-close in afterEach
  });

  it('starts with 0 sessions', async () => {
    handle = await startMCPServerHTTP(makeOptions(), {
      host: '127.0.0.1',
      port: 0,
    });

    expect(handle.sessionCount()).toBe(0);
  });
});

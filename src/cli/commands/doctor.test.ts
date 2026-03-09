import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { forwardToolCall } from '../../core/runner-proxy';
import { doctorRunnerCommand } from './doctor';

vi.mock('../../core/runner-proxy', () => ({
  forwardToolCall: vi.fn(),
  resetAuthoritySession: vi.fn(),
}));

const mockForward = forwardToolCall as ReturnType<typeof vi.fn>;

let consoleLogs: string[];
let processExitCode: number | undefined;

beforeEach(() => {
  vi.restoreAllMocks();
  consoleLogs = [];
  processExitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation((...args) => { consoleLogs.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null | undefined) => {
    processExitCode = typeof code === 'number' ? code : undefined;
    throw new Error(`process.exit(${code})`);
  });
});

function mockFetch(responses: Record<string, { status: number; body: any }>) {
  const origFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url: any, opts?: any) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    for (const [pattern, resp] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => resp.body,
          text: async () => JSON.stringify(resp.body),
        } as Response;
      }
    }
    return origFetch(url, opts);
  }) as any;
}

describe('janee doctor runner', () => {
  it('should report all PASS when authority is healthy', async () => {
    mockFetch({
      '/v1/health': { status: 200, body: { ok: true, mode: 'authority' } },
      '/v1/exec/authorize': { status: 400, body: { error: 'Invalid authorize request' } },
    });

    mockForward.mockImplementation(async (_url: string, _agent: string, tool: string) => {
      if (tool === 'list_services') {
        return { content: [{ type: 'text', text: JSON.stringify([{ name: 'cap-1' }]) }] };
      }
      if (tool === 'whoami') {
        return { content: [{ type: 'text', text: JSON.stringify({ agentId: 'doctor-probe' }) }] };
      }
      return { content: [] };
    });

    await doctorRunnerCommand('http://localhost:9120', { runnerKey: 'test-key', json: true });

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.overall).toBe('PASS');
    expect(parsed.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'authority_reachable', status: 'PASS' }),
      expect.objectContaining({ name: 'runner_key', status: 'PASS' }),
      expect.objectContaining({ name: 'tool_forwarding', status: 'PASS' }),
      expect.objectContaining({ name: 'identity_parity', status: 'PASS' }),
    ]));
  });

  it('should report FAIL when authority is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('Connection refused'); }) as any;
    mockForward.mockRejectedValue(new Error('Connection refused'));

    try {
      await doctorRunnerCommand('http://localhost:9999', { runnerKey: 'k', json: true });
    } catch {}

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.overall).toBe('FAIL');
    expect(parsed.checks.find((c: any) => c.name === 'authority_reachable').status).toBe('FAIL');
  });

  it('should report FAIL when runner key is rejected', async () => {
    mockFetch({
      '/v1/health': { status: 200, body: { ok: true, mode: 'authority' } },
      '/v1/exec/authorize': { status: 401, body: { error: 'Unauthorized' } },
    });

    mockForward.mockImplementation(async () => ({ content: [{ type: 'text', text: '[]' }] }));

    await doctorRunnerCommand('http://localhost:9120', { runnerKey: 'bad-key', json: true });

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    const keyCheck = parsed.checks.find((c: any) => c.name === 'runner_key');
    expect(keyCheck.status).toBe('FAIL');
    expect(keyCheck.detail).toContain('rejected');
  });

  it('should report FAIL when no runner key provided', async () => {
    const origEnv = process.env.JANEE_RUNNER_KEY;
    delete process.env.JANEE_RUNNER_KEY;

    mockFetch({
      '/v1/health': { status: 200, body: { ok: true, mode: 'authority' } },
    });
    mockForward.mockImplementation(async () => ({ content: [{ type: 'text', text: '[]' }] }));

    await doctorRunnerCommand('http://localhost:9120', { json: true });

    process.env.JANEE_RUNNER_KEY = origEnv;

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    const keyCheck = parsed.checks.find((c: any) => c.name === 'runner_key');
    expect(keyCheck.status).toBe('FAIL');
    expect(keyCheck.detail).toContain('No runner key');
  });

  it('should include explain_access check when --agent is given', async () => {
    mockFetch({
      '/v1/health': { status: 200, body: { ok: true, mode: 'authority' } },
      '/v1/exec/authorize': { status: 400, body: {} },
    });

    mockForward.mockImplementation(async (_url: string, _agent: string, tool: string) => {
      if (tool === 'list_services') return { content: [{ type: 'text', text: '[]' }] };
      if (tool === 'whoami') return { content: [{ type: 'text', text: JSON.stringify({ agentId: 'my-agent' }) }] };
      if (tool === 'explain_access') return { content: [{ type: 'text', text: JSON.stringify({ allowed: false }) }] };
      return { content: [] };
    });

    await doctorRunnerCommand('http://localhost:9120', { runnerKey: 'k', agent: 'my-agent', json: true });

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    const explainCheck = parsed.checks.find((c: any) => c.name === 'explain_access_forwarding');
    expect(explainCheck).toBeDefined();
    expect(explainCheck.status).toBe('PASS');
  });

  it('should render human-readable output', async () => {
    mockFetch({
      '/v1/health': { status: 200, body: { ok: true, mode: 'authority' } },
      '/v1/exec/authorize': { status: 400, body: {} },
    });

    mockForward.mockImplementation(async (_url: string, _agent: string, tool: string) => {
      if (tool === 'list_services') return { content: [{ type: 'text', text: '[]' }] };
      if (tool === 'whoami') return { content: [{ type: 'text', text: JSON.stringify({ agentId: 'doctor-probe' }) }] };
      return { content: [] };
    });

    await doctorRunnerCommand('http://localhost:9120', { runnerKey: 'k' });

    const output = consoleLogs.join('\n');
    expect(output).toContain('Runner → Authority diagnostics');
    expect(output).toContain('authority_reachable');
    expect(output).toContain('Overall: PASS');
  });
});

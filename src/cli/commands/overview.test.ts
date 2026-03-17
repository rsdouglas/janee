import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  hasYAMLConfig,
  loadYAMLConfig,
} from '../config-yaml';
import { overviewCommand } from './overview';

vi.mock('../config-yaml', () => ({
  loadYAMLConfig: vi.fn(),
  hasYAMLConfig: vi.fn(),
  saveYAMLConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/tmp/janee-test'),
  getAuditDir: vi.fn(() => '/tmp/janee-test/logs'),
}));

const mockLoad = vi.mocked(loadYAMLConfig);
const mockHas = vi.mocked(hasYAMLConfig);

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(' '));
  console.error = (...args: any[]) => errors.push(args.join(' '));
  return {
    logs,
    errors,
    restore: () => { console.log = origLog; console.error = origError; },
  };
}

vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

function baseConfig(overrides: any = {}) {
  return {
    version: '0.3.0',
    masterKey: 'test-key',
    server: { port: 9100, host: 'localhost', ...overrides.server },
    services: overrides.services ?? {},
    capabilities: overrides.capabilities ?? {},
  };
}

describe('overviewCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should show service and capability counts', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'k' } },
        resend: { baseUrl: 'https://api.resend.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        stripe: { service: 'stripe', ttl: '1h' },
        resend: { service: 'resend', ttl: '1h' },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('2 services');
    expect(output).toContain('2 capabilities');
  });

  it('should show per-agent access when allowedAgents is set', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'k' } },
        serp: { baseUrl: 'https://serpapi.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        stripe: { service: 'stripe', ttl: '1h', allowedAgents: ['billing-bot'] },
        serp: { service: 'serp', ttl: '1h', access: 'open' },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('billing-bot');
    expect(output).toContain('stripe');
    expect(output).toContain('serp');
  });

  it('should show unreachable capabilities', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      server: { defaultAccess: 'restricted' },
      services: {
        slack: { baseUrl: 'https://slack.com/api', auth: { type: 'bearer', key: 'k' } },
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        slack: { service: 'slack', ttl: '1h' },
        stripe: { service: 'stripe', ttl: '1h', allowedAgents: ['bot-a'] },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('Unreachable');
    expect(output).toContain('slack');
  });

  it('should show unreachable for cap-level restricted override', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'k' } },
        serp: { baseUrl: 'https://serpapi.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        stripe: { service: 'stripe', ttl: '1h', access: 'restricted' },
        serp: { service: 'serp', ttl: '1h', allowedAgents: ['bot-a'] },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('Unreachable');
    expect(output).toContain('stripe');
  });

  it('should not flag as unreachable when ownership grants access', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      services: {
        slack: {
          baseUrl: 'https://slack.com/api',
          auth: { type: 'bearer', key: 'k' },
          ownership: { accessPolicy: 'shared', sharedWith: ['bot-a'], createdAt: '2026-01-01' },
        },
      },
      capabilities: {
        slack: { service: 'slack', ttl: '1h' },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).not.toContain('Unreachable');
  });

  it('should output JSON', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      server: { defaultAccess: 'restricted' },
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        stripe: { service: 'stripe', ttl: '1h', allowedAgents: ['bot-a'] },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.services).toBe(1);
    expect(parsed.capabilities).toBe(1);
    expect(parsed.agents['bot-a'].accessible).toContain('stripe');
    expect(parsed.unreachable).toHaveLength(0);
  });

  it('should show open message when no agents configured', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      services: {
        resend: { baseUrl: 'https://api.resend.com', auth: { type: 'bearer', key: 'k' } },
      },
      capabilities: {
        resend: { service: 'resend', ttl: '1h' },
      },
    }) as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('all capabilities are open');
  });

  it('should handle empty config', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig() as any);

    const cap = captureConsole();
    await overviewCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('0 services');
    expect(output).toContain('No capabilities configured');
  });
});

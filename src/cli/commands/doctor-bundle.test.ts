import {
  existsSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
import { doctorBundleCommand } from './doctor-bundle';

vi.mock('../config-yaml', () => ({
  hasYAMLConfig: vi.fn(),
  loadYAMLConfig: vi.fn(),
  getAuditDir: vi.fn(() => '/tmp/nonexistent-audit-dir'),
}));

vi.mock('../../core/audit', () => ({
  AuditLogger: vi.fn().mockImplementation(() => ({
    readLogs: vi.fn().mockResolvedValue([]),
  })),
}));

const mockHasConfig = hasYAMLConfig as ReturnType<typeof vi.fn>;
const mockLoadConfig = loadYAMLConfig as ReturnType<typeof vi.fn>;

let consoleLogs: string[];

beforeEach(() => {
  vi.restoreAllMocks();
  consoleLogs = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => { consoleLogs.push(args.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const fakeConfig = {
  version: '0.3.0',
  masterKey: 'should-not-appear',
  server: { port: 8999, host: '127.0.0.1', defaultAccess: 'restricted' as const },
  services: {
    'stripe': { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test_REDACTED' } },
    'github': { baseUrl: 'https://api.github.com', auth: { type: 'github-app' }, ownership: { type: 'agent-created', agentId: 'codex' } },
  },
  capabilities: {
    'stripe-read': { service: 'stripe', ttl: '1h', rules: { allow: ['GET /**'] } },
    'github-write': { service: 'github', ttl: '30m', mode: 'proxy', allowedAgents: ['codex'] },
  },
};

describe('janee doctor bundle', () => {
  it('should output redacted config to stdout', async () => {
    mockHasConfig.mockReturnValue(true);
    mockLoadConfig.mockReturnValue(fakeConfig);

    await doctorBundleCommand({});

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);

    expect(parsed.config).toBeDefined();
    expect(parsed.config.serviceCount).toBe(2);
    expect(parsed.config.capabilityCount).toBe(2);
    expect(parsed.config.services[0].name).toBe('stripe');
    expect(parsed.config.services[0].authType).toBe('bearer');
    // Verify no secrets leak
    expect(output).not.toContain('sk_test_');
    expect(output).not.toContain('should-not-appear');
  });

  it('should include agent access summary', async () => {
    mockHasConfig.mockReturnValue(true);
    mockLoadConfig.mockReturnValue(fakeConfig);

    await doctorBundleCommand({ agent: 'codex' });

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);

    expect(parsed.agentAccess).toBeDefined();
    expect(parsed.agentAccess.agent).toBe('codex');
    expect(parsed.agentAccess.accessible).toContain('github-write');
    // stripe-read has no allowedAgents but defaultAccess is restricted
    expect(parsed.agentAccess.denied).toContain('stripe-read');
  });

  it('should write to file when --output is specified', async () => {
    mockHasConfig.mockReturnValue(true);
    mockLoadConfig.mockReturnValue(fakeConfig);

    const tmpDir = mkdtempSync(join(tmpdir(), 'janee-bundle-'));
    const outPath = join(tmpDir, 'bundle.json');

    await doctorBundleCommand({ output: outPath });

    expect(existsSync(outPath)).toBe(true);
    const content = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(content.config.serviceCount).toBe(2);

    unlinkSync(outPath);
  });

  it('should handle missing config gracefully', async () => {
    mockHasConfig.mockReturnValue(false);

    await doctorBundleCommand({});

    const output = consoleLogs.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.config).toBeNull();
    expect(parsed.error).toContain('No config found');
  });
});

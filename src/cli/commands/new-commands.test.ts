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
  saveYAMLConfig,
} from '../config-yaml';
import {
  capabilityAddCommand,
  capabilityEditCommand,
  capabilityListCommand,
} from './capability';
import {
  configGetCommand,
  configSetCommand,
} from './config';
import { serviceEditCommand } from './service-edit';
import { whoamiCommand } from './whoami';

vi.mock('../config-yaml', () => ({
  loadYAMLConfig: vi.fn(),
  hasYAMLConfig: vi.fn(),
  saveYAMLConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/tmp/janee-test'),
  getAuditDir: vi.fn(() => '/tmp/janee-test/logs'),
}));

const mockLoad = vi.mocked(loadYAMLConfig);
const mockHas = vi.mocked(hasYAMLConfig);
const mockSave = vi.mocked(saveYAMLConfig);

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

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

function baseConfig(overrides: any = {}) {
  return {
    version: '0.3.0',
    masterKey: 'test-key',
    server: { port: 9100, host: 'localhost' },
    services: {
      stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
      okx: { baseUrl: 'https://www.okx.com', auth: { type: 'hmac-okx', apiKey: 'k', apiSecret: 's', passphrase: 'p' } },
      ghapp: { baseUrl: 'https://api.github.com', auth: { type: 'github-app', appId: '1', privateKey: 'pem', installationId: '2' } },
    },
    capabilities: {
      stripe_read: { service: 'stripe', ttl: '1h' },
    },
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// cap add — new flags
// ---------------------------------------------------------------------------
describe('capabilityAddCommand — extended flags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should set allowedAgents on cap add', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await capabilityAddCommand('new_cap', {
      service: 'stripe',
      allowedAgents: ['creature:patch', 'creature:secure'],
      json: true,
    });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.capabilities.new_cap.allowedAgents).toEqual(['creature:patch', 'creature:secure']);
  });

  it('should set mode and exec fields on cap add', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await capabilityAddCommand('exec_cap', {
      service: 'stripe',
      mode: 'exec',
      allowCommands: ['bird', 'gh'],
      envMap: ['GH_TOKEN={{credential}}', 'FOO=bar'],
      workDir: '/tmp',
      timeout: '5000',
      json: true,
    });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    const c = saved.capabilities.exec_cap;
    expect(c.mode).toBe('exec');
    expect(c.allowCommands).toEqual(['bird', 'gh']);
    expect(c.env).toEqual({ GH_TOKEN: '{{credential}}', FOO: 'bar' });
    expect(c.workDir).toBe('/tmp');
    expect(c.timeout).toBe(5000);
  });

  it('should reject invalid mode', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await capabilityAddCommand('bad', { service: 'stripe', mode: 'invalid', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Invalid mode');
  });

  it('should reject invalid env-map format', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await capabilityAddCommand('bad', { service: 'stripe', envMap: ['NOEQUALS'], json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Invalid env mapping');
  });

  it('should reject invalid timeout', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await capabilityAddCommand('bad', { service: 'stripe', timeout: 'notanumber', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Invalid timeout');
  });
});

// ---------------------------------------------------------------------------
// cap edit — new flags
// ---------------------------------------------------------------------------
describe('capabilityEditCommand — extended flags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should update allowedAgents on cap edit', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await capabilityEditCommand('stripe_read', {
      allowedAgents: ['agent:new'],
      json: true,
    });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.capabilities.stripe_read.allowedAgents).toEqual(['agent:new']);
  });

  it('should clear agents with --clear-agents', async () => {
    mockHas.mockReturnValue(true);
    const cfg = baseConfig();
    cfg.capabilities.stripe_read.allowedAgents = ['old:agent'];
    mockLoad.mockReturnValue(cfg);
    const cap = captureConsole();
    await capabilityEditCommand('stripe_read', { clearAgents: true, json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.capabilities.stripe_read.allowedAgents).toBeUndefined();
  });

  it('should update mode and timeout on cap edit', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await capabilityEditCommand('stripe_read', {
      mode: 'exec',
      timeout: '10000',
      json: true,
    });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.capabilities.stripe_read.mode).toBe('exec');
    expect(saved.capabilities.stripe_read.timeout).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// cap list — new fields in JSON output
// ---------------------------------------------------------------------------
describe('capabilityListCommand — extended fields', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should include new fields in JSON output', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig({
      capabilities: {
        exec_cap: {
          service: 'stripe',
          ttl: '30m',
          mode: 'exec',
          allowedAgents: ['agent:a'],
          allowCommands: ['gh'],
          env: { TOKEN: '{{credential}}' },
          workDir: '/app',
          timeout: 5000,
        },
      },
    }));
    const cap = captureConsole();
    await capabilityListCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    const c = parsed.capabilities[0];
    expect(c.mode).toBe('exec');
    expect(c.allowedAgents).toEqual(['agent:a']);
    expect(c.allowCommands).toEqual(['gh']);
    expect(c.env).toEqual({ TOKEN: '{{credential}}' });
    expect(c.workDir).toBe('/app');
    expect(c.timeout).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// service edit
// ---------------------------------------------------------------------------
describe('serviceEditCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should update baseUrl', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('stripe', { url: 'https://new.stripe.com', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.stripe.baseUrl).toBe('https://new.stripe.com');
    const out = JSON.parse(cap.logs.join(''));
    expect(out.ok).toBe(true);
    expect(out.changes).toContain('baseUrl → https://new.stripe.com');
  });

  it('should update testPath', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('stripe', { testPath: '/v2/health', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.stripe.testPath).toBe('/v2/health');
  });

  it('should rotate bearer key', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('stripe', { key: 'sk_new', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.stripe.auth.key).toBe('sk_new');
  });

  it('should rotate HMAC passphrase', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('okx', { passphrase: 'newpass', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.okx.auth.passphrase).toBe('newpass');
  });

  it('should reject --passphrase on non-okx service', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await serviceEditCommand('stripe', { passphrase: 'x', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('only applicable to hmac-okx');
  });

  it('should error with no changes', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await serviceEditCommand('stripe', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('No changes specified');
  });

  it('should error for unknown service', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await serviceEditCommand('nonexistent', { url: 'http://x', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('not found');
  });

  it('should rotate HMAC apiKey via --key', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('okx', { key: 'new-api-key', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.okx.auth.apiKey).toBe('new-api-key');
    const out = JSON.parse(cap.logs.join(''));
    expect(out.changes).toContain('HMAC apiKey rotated');
  });

  it('should rotate HMAC apiSecret', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('okx', { apiSecret: 'new-secret', json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.okx.auth.apiSecret).toBe('new-secret');
  });

  it('should reject --key on github-app auth', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await serviceEditCommand('ghapp', { key: 'nope', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('not applicable');
  });

  it('should reject --api-secret on non-hmac service', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await serviceEditCommand('stripe', { apiSecret: 'nope', json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('not applicable');
  });

  it('should apply multiple changes at once', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await serviceEditCommand('stripe', {
      url: 'https://new.stripe.com',
      testPath: '/v2/check',
      key: 'sk_rotated',
      json: true,
    });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.services.stripe.baseUrl).toBe('https://new.stripe.com');
    expect(saved.services.stripe.testPath).toBe('/v2/check');
    expect(saved.services.stripe.auth.key).toBe('sk_rotated');
    const out = JSON.parse(cap.logs.join(''));
    expect(out.changes).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// config get / set
// ---------------------------------------------------------------------------
describe('configGetCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should show all config values', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await configGetCommand(undefined, { json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed['server.port']).toBe(9100);
    expect(parsed['server.host']).toBe('localhost');
  });

  it('should show a single key', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await configGetCommand('server.port', { json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.key).toBe('server.port');
    expect(parsed.value).toBe(9100);
  });

  it('should error on unknown key', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await configGetCommand('server.nonexistent', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Unknown config key');
  });
});

describe('configSetCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should set a number value', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await configSetCommand('server.port', '9200', { json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.server.port).toBe(9200);
  });

  it('should set a boolean value', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await configSetCommand('server.logBodies', 'true', { json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.server.logBodies).toBe(true);
  });

  it('should set an enum value', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await configSetCommand('server.defaultAccess', 'restricted', { json: true });
    cap.restore();
    const saved = mockSave.mock.calls[0][0] as any;
    expect(saved.server.defaultAccess).toBe('restricted');
  });

  it('should reject invalid enum value', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await configSetCommand('server.defaultAccess', 'invalid', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Invalid value');
  });

  it('should reject invalid boolean', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await configSetCommand('server.logBodies', 'yes', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Invalid boolean');
  });

  it('should reject llm keys (not currently supported)', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await configSetCommand('llm.provider', 'openai', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Unknown config key');
  });

  it('should reject unknown key', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    try {
      await configSetCommand('server.nonexistent', 'x', { json: true });
    } catch {}
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Unknown config key');
  });
});

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------
describe('whoamiCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should show admin identity when no --agent', async () => {
    mockHas.mockReturnValue(true);
    mockLoad.mockReturnValue(baseConfig());
    const cap = captureConsole();
    await whoamiCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.agentId).toBeNull();
    expect(parsed.role).toBe('admin (CLI)');
    expect(parsed.capabilities.accessible).toContain('stripe_read');
  });

  it('should show accessible caps for a matching agent', async () => {
    mockHas.mockReturnValue(true);
    const cfg = baseConfig();
    cfg.capabilities.stripe_read.allowedAgents = ['creature:patch'];
    mockLoad.mockReturnValue(cfg);
    const cap = captureConsole();
    await whoamiCommand({ agent: 'creature:patch', json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.agentId).toBe('creature:patch');
    expect(parsed.capabilities.accessible).toContain('stripe_read');
    expect(parsed.capabilities.denied).toHaveLength(0);
  });

  it('should show denied caps for a non-matching agent', async () => {
    mockHas.mockReturnValue(true);
    const cfg = baseConfig();
    cfg.capabilities.stripe_read.allowedAgents = ['creature:patch'];
    mockLoad.mockReturnValue(cfg);
    const cap = captureConsole();
    await whoamiCommand({ agent: 'other:agent', json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.agentId).toBe('other:agent');
    expect(parsed.capabilities.denied).toContain('stripe_read');
    expect(parsed.capabilities.accessible).toHaveLength(0);
  });

  it('should respect defaultAccess restricted policy', async () => {
    mockHas.mockReturnValue(true);
    const cfg = baseConfig({ server: { port: 9100, host: 'localhost', defaultAccess: 'restricted' } });
    mockLoad.mockReturnValue(cfg);
    const cap = captureConsole();
    await whoamiCommand({ agent: 'any:agent', json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.defaultAccessPolicy).toBe('restricted');
    expect(parsed.capabilities.denied).toContain('stripe_read');
  });
});

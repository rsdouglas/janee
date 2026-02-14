import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config-yaml module
vi.mock('../config-yaml', () => ({
  loadYAMLConfig: vi.fn(),
  hasYAMLConfig: vi.fn(),
  saveYAMLConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/tmp/janee-test'),
  getAuditDir: vi.fn(() => '/tmp/janee-test/logs'),
}));

import { loadYAMLConfig, hasYAMLConfig, saveYAMLConfig, getConfigDir } from '../config-yaml';
import { listCommand } from './list';
import { removeCommand } from './remove';
import { searchCommand } from './search';

const mockLoadYAMLConfig = vi.mocked(loadYAMLConfig);
const mockHasYAMLConfig = vi.mocked(hasYAMLConfig);
const mockSaveYAMLConfig = vi.mocked(saveYAMLConfig);

// Capture console output
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
    restore: () => {
      console.log = origLog;
      console.error = origError;
    }
  };
}

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

describe('listCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should exit with error when no config exists', async () => {
    mockHasYAMLConfig.mockReturnValue(false);
    const cap = captureConsole();
    try {
      await listCommand();
    } catch (e) {
      // process.exit throws
    }
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(cap.logs.join(' ')).toContain('No config found');
  });

  it('should show JSON error when no config exists with --json', async () => {
    mockHasYAMLConfig.mockReturnValue(false);
    const cap = captureConsole();
    try {
      await listCommand({ json: true });
    } catch (e) {}
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
    const output = cap.logs.join(' ');
    expect(output).toContain('error');
  });

  it('should list services in human-readable format', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '0.2.0',
      masterKey: 'test-key',
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
        github: { baseUrl: 'https://api.github.com', auth: { type: 'bearer', key: 'ghp_test' } },
      },
      capabilities: {
        stripe_readonly: {
          service: 'stripe',
          ttl: '1h',
          rules: { allow: ['GET *'], deny: ['POST *'] }
        }
      }
    } as any);
    const cap = captureConsole();
    await listCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('stripe');
    expect(output).toContain('github');
    expect(output).toContain('stripe_readonly');
  });

  it('should list services in JSON format', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '0.2.0',
      masterKey: 'test-key',
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
      },
      capabilities: {
        stripe_readonly: {
          service: 'stripe',
          ttl: '1h',
          rules: { allow: ['GET *'], deny: [] }
        }
      }
    } as any);
    const cap = captureConsole();
    await listCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.services).toHaveLength(1);
    expect(parsed.services[0].name).toBe('stripe');
    expect(parsed.capabilities).toHaveLength(1);
  });

  it('should show helpful message when no services configured', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '0.2.0',
      masterKey: 'test-key',
      services: {},
      capabilities: {}
    } as any);
    const cap = captureConsole();
    await listCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('No services configured');
    expect(output).toContain('janee add');
  });
});

describe('removeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should exit with error when no config exists', async () => {
    mockHasYAMLConfig.mockReturnValue(false);
    const cap = captureConsole();
    try {
      await removeCommand('stripe', { yes: true });
    } catch (e) {}
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error when service not found', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '0.2.0',
      masterKey: 'test-key',
      services: {},
      capabilities: {}
    } as any);
    const cap = captureConsole();
    try {
      await removeCommand('nonexistent', { yes: true });
    } catch (e) {}
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should remove service with --yes flag', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    const config = {
      version: '0.2.0',
      masterKey: 'test-key',
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
      },
      capabilities: {}
    } as any;
    mockLoadYAMLConfig.mockReturnValue(config);
    const cap = captureConsole();
    await removeCommand('stripe', { yes: true });
    cap.restore();
    expect(mockSaveYAMLConfig).toHaveBeenCalled();
    expect(cap.logs.join(' ')).toContain('removed successfully');
  });

  it('should remove dependent capabilities', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    const config = {
      version: '0.2.0',
      masterKey: 'test-key',
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
      },
      capabilities: {
        stripe_readonly: { service: 'stripe', ttl: '1h' },
        stripe_write: { service: 'stripe', ttl: '30m' },
      }
    } as any;
    mockLoadYAMLConfig.mockReturnValue(config);
    const cap = captureConsole();
    await removeCommand('stripe', { yes: true });
    cap.restore();
    expect(mockSaveYAMLConfig).toHaveBeenCalled();
    const savedConfig = mockSaveYAMLConfig.mock.calls[0][0] as any;
    expect(savedConfig.capabilities).toEqual({});
  });

  it('should output JSON on remove with --json', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    const config = {
      version: '0.2.0',
      masterKey: 'test-key',
      services: {
        stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'sk_test' } },
      },
      capabilities: {}
    } as any;
    mockLoadYAMLConfig.mockReturnValue(config);
    const cap = captureConsole();
    await removeCommand('stripe', { json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.ok).toBe(true);
    expect(parsed.service).toBe('stripe');
  });

  it('should output JSON error when service not found with --json', async () => {
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '0.2.0',
      masterKey: 'test-key',
      services: {},
      capabilities: {}
    } as any);
    const cap = captureConsole();
    try {
      await removeCommand('nonexistent', { json: true });
    } catch (e) {}
    cap.restore();
    // Find the JSON log entry
    const jsonLog = cap.logs.find(l => l.startsWith('{'));
    expect(jsonLog).toBeDefined();
    const parsed = JSON.parse(jsonLog!);
    expect(parsed.ok).toBe(false);
  });
});

describe('searchCommand', () => {
  it('should list all services when no query', () => {
    const cap = captureConsole();
    searchCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('Service Directory');
  });

  it('should output JSON when --json and no query', () => {
    const cap = captureConsole();
    searchCommand(undefined, { json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should search for specific service', () => {
    const cap = captureConsole();
    searchCommand('stripe');
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('stripe');
  });

  it('should handle no results gracefully', () => {
    const cap = captureConsole();
    searchCommand('zzz_nonexistent_service_zzz');
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('No services found');
  });

  it('should output JSON search results', () => {
    const cap = captureConsole();
    searchCommand('stripe', { json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(Array.isArray(parsed)).toBe(true);
  });
});

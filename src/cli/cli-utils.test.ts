import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config-yaml', () => ({
  hasYAMLConfig: vi.fn(),
}));

import { hasYAMLConfig } from './config-yaml';
import {
  getErrorMessage,
  cliError,
  handleCommandError,
  requireConfig,
  resolveEnvVar,
  parseEnvMap,
} from './cli-utils';

const mockHasYAMLConfig = vi.mocked(hasYAMLConfig);

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

beforeEach(() => vi.clearAllMocks());

describe('getErrorMessage', () => {
  it('should extract message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('should return fallback for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('Unknown error occurred');
    expect(getErrorMessage(42)).toBe('Unknown error occurred');
    expect(getErrorMessage(null)).toBe('Unknown error occurred');
  });
});

describe('cliError', () => {
  it('should output text error and exit', () => {
    const cap = captureConsole();
    try { cliError('something broke'); } catch {}
    cap.restore();
    expect(cap.errors[0]).toBe('❌ something broke');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should output JSON error and exit', () => {
    const cap = captureConsole();
    try { cliError('something broke', true); } catch {}
    cap.restore();
    expect(JSON.parse(cap.logs[0])).toEqual({ ok: false, error: 'something broke' });
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe('handleCommandError', () => {
  it('should handle Error instances in text mode', () => {
    const cap = captureConsole();
    try { handleCommandError(new Error('oops')); } catch {}
    cap.restore();
    expect(cap.errors[0]).toBe('❌ Error: oops');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should handle non-Error values in JSON mode', () => {
    const cap = captureConsole();
    try { handleCommandError('string', true); } catch {}
    cap.restore();
    expect(JSON.parse(cap.logs[0])).toEqual({ ok: false, error: 'Unknown error occurred' });
  });
});

describe('requireConfig', () => {
  it('should do nothing when config exists', () => {
    mockHasYAMLConfig.mockReturnValue(true);
    requireConfig();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with text error when config missing', () => {
    mockHasYAMLConfig.mockReturnValue(false);
    const cap = captureConsole();
    try { requireConfig(); } catch {}
    cap.restore();
    expect(cap.errors[0]).toContain('No config found');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with JSON error when config missing', () => {
    mockHasYAMLConfig.mockReturnValue(false);
    const cap = captureConsole();
    try { requireConfig(true); } catch {}
    cap.restore();
    expect(JSON.parse(cap.logs[0]).error).toContain('No config found');
  });
});

describe('resolveEnvVar', () => {
  it('should return trimmed value when env var exists', () => {
    process.env.TEST_CLI_VAR = '  hello  ';
    expect(resolveEnvVar('TEST_CLI_VAR', 'test')).toBe('hello');
    delete process.env.TEST_CLI_VAR;
  });

  it('should throw when env var is missing', () => {
    delete process.env.MISSING_VAR;
    expect(() => resolveEnvVar('MISSING_VAR', 'test key'))
      .toThrow('Environment variable MISSING_VAR is not set (needed for test key)');
  });
});

describe('parseEnvMap', () => {
  it('should parse valid mappings', () => {
    expect(parseEnvMap(['KEY=value', 'FOO=bar=baz'])).toEqual({
      KEY: 'value',
      FOO: 'bar=baz',
    });
  });

  it('should trim keys and values', () => {
    expect(parseEnvMap([' KEY = value '])).toEqual({ KEY: 'value' });
  });

  it('should throw on missing equals sign', () => {
    expect(() => parseEnvMap(['NOEQUALS'])).toThrow('Invalid env mapping');
  });

  it('should throw on empty key', () => {
    expect(() => parseEnvMap(['=value'])).toThrow('Invalid env mapping');
  });
});

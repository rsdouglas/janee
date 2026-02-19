/**
 * Tests for the --header flag in the add command (headers auth type)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../config-yaml', () => ({
  loadYAMLConfig: vi.fn(),
  hasYAMLConfig: vi.fn(),
  saveYAMLConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/tmp/janee-test-headers'),
  getAuditDir: vi.fn(() => '/tmp/janee-test-headers/logs'),
}));

vi.mock('../../core/directory', () => ({
  getService: vi.fn().mockReturnValue(undefined),
  searchDirectory: vi.fn().mockReturnValue([]),
}));

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

import { loadYAMLConfig, hasYAMLConfig, saveYAMLConfig } from '../config-yaml';
import { addCommand } from './add';

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

describe('addCommand --header flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasYAMLConfig.mockReturnValue(true);
    mockLoadYAMLConfig.mockReturnValue({
      version: '1.0',
      masterKey: { type: 'password', hash: 'test' },
      services: {}
    });
  });

  it('should accept a single --header and create headers auth', async () => {
    const capture = captureConsole();
    try {
      await addCommand('devto', {
        url: 'https://dev.to/api',
        authType: 'headers',
        header: ['api-key=test-key-123'],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockSaveYAMLConfig).toHaveBeenCalled();
    const savedConfig = mockSaveYAMLConfig.mock.calls[0][0];
    const service = savedConfig.services['devto'];
    expect(service).toBeDefined();
    expect(service.auth.type).toBe('headers');
    expect(service.auth.headers).toEqual({ 'api-key': 'test-key-123' });
  });

  it('should accept multiple --header flags', async () => {
    const capture = captureConsole();
    try {
      await addCommand('myapi', {
        url: 'https://api.example.com',
        authType: 'headers',
        header: ['X-API-Key=abc123', 'X-Tenant-ID=tenant-42'],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockSaveYAMLConfig).toHaveBeenCalled();
    const savedConfig = mockSaveYAMLConfig.mock.calls[0][0];
    const service = savedConfig.services['myapi'];
    expect(service.auth.type).toBe('headers');
    expect(service.auth.headers).toEqual({
      'X-API-Key': 'abc123',
      'X-Tenant-ID': 'tenant-42'
    });
  });

  it('should reject --header with invalid format (no equals)', async () => {
    const capture = captureConsole();
    try {
      await addCommand('badapi', {
        url: 'https://api.example.com',
        authType: 'headers',
        header: ['invalid-no-equals'],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockExit).toHaveBeenCalledWith(1);
    const jsonOutput = capture.logs.find(l => l.includes('Invalid --header format'));
    expect(jsonOutput).toBeDefined();
  });

  it('should reject --header with empty name', async () => {
    const capture = captureConsole();
    try {
      await addCommand('badapi', {
        url: 'https://api.example.com',
        authType: 'headers',
        header: ['=somevalue'],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockExit).toHaveBeenCalledWith(1);
    const jsonOutput = capture.logs.find(l => l.includes('empty header name'));
    expect(jsonOutput).toBeDefined();
  });

  it('should reject --header with empty value', async () => {
    const capture = captureConsole();
    try {
      await addCommand('badapi', {
        url: 'https://api.example.com',
        authType: 'headers',
        header: ['api-key='],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockExit).toHaveBeenCalledWith(1);
    const jsonOutput = capture.logs.find(l => l.includes('empty value'));
    expect(jsonOutput).toBeDefined();
  });

  it('should handle values containing equals signs', async () => {
    const capture = captureConsole();
    try {
      await addCommand('base64api', {
        url: 'https://api.example.com',
        authType: 'headers',
        header: ['Authorization=Basic dXNlcjpwYXNz=='],
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockSaveYAMLConfig).toHaveBeenCalled();
    const savedConfig = mockSaveYAMLConfig.mock.calls[0][0];
    const service = savedConfig.services['base64api'];
    expect(service.auth.headers?.['Authorization']).toBe('Basic dXNlcjpwYXNz==');
  });

  it('should reject --key without --header for headers auth type (no template)', async () => {
    const capture = captureConsole();
    try {
      await addCommand('devto', {
        url: 'https://dev.to/api',
        authType: 'headers',
        key: 'my-key',
        json: true
      });
    } catch (e) {}
    capture.restore();

    expect(mockExit).toHaveBeenCalledWith(1);
    const jsonOutput = capture.logs.find(l => l.includes('--header name=value'));
    expect(jsonOutput).toBeDefined();
  });
});

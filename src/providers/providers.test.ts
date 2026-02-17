/**
 * Tests for the Secrets Provider system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { 
  parseProviderURI,
  createProvider,
  getProvider,
  resolveSecret,
  healthCheckAll,
  disposeAll,
  registerProviderType,
  SecretError,
  SecretErrorCode,
  validateSecretPath,
} from './index';
import { FilesystemProvider } from './filesystem';
import { EnvProvider } from './env';
import { generateMasterKey, encryptSecret, decryptSecret } from '../core/crypto';

// --- URI Parsing ---

describe('parseProviderURI', () => {
  it('parses scheme://path URIs', () => {
    expect(parseProviderURI('vault://mcp/stripe/key')).toEqual({
      provider: 'vault',
      path: 'mcp/stripe/key',
    });
  });

  it('normalizes provider names to lowercase', () => {
    expect(parseProviderURI('Vault://mcp/stripe/key')).toEqual({
      provider: 'vault',
      path: 'mcp/stripe/key',
    });
    expect(parseProviderURI('AWS-Secrets://prod/db')).toEqual({
      provider: 'aws-secrets',
      path: 'prod/db',
    });
  });

  it('handles dashes and underscores in provider names', () => {
    expect(parseProviderURI('aws-secrets://prod/db-password')).toEqual({
      provider: 'aws-secrets',
      path: 'prod/db-password',
    });
  });

  it('returns null provider for plain paths', () => {
    expect(parseProviderURI('stripe-api-key')).toEqual({
      provider: null,
      path: 'stripe-api-key',
    });
  });

  it('returns null provider for paths with slashes but no scheme', () => {
    expect(parseProviderURI('secrets/stripe/key')).toEqual({
      provider: null,
      path: 'secrets/stripe/key',
    });
  });

  it('handles env:// URIs', () => {
    expect(parseProviderURI('env://STRIPE_API_KEY')).toEqual({
      provider: 'env',
      path: 'STRIPE_API_KEY',
    });
  });

  it('percent-decodes path components', () => {
    expect(parseProviderURI('vault://path%20with%20spaces/key')).toEqual({
      provider: 'vault',
      path: 'path with spaces/key',
    });
  });

  it('rejects invalid percent-encoding', () => {
    expect(() => parseProviderURI('vault://path%ZZ/key')).toThrow(SecretError);
    expect(() => parseProviderURI('vault://path%ZZ/key')).toThrow(/percent-encoding/);
  });

  it('rejects provider names longer than 64 chars', () => {
    const longName = 'a'.repeat(65);
    expect(() => parseProviderURI(longName + '://path')).toThrow(SecretError);
    expect(() => parseProviderURI(longName + '://path')).toThrow(/maximum length/);
  });

  it('rejects empty URIs', () => {
    expect(() => parseProviderURI('')).toThrow(SecretError);
  });

  it('rejects paths with .. traversal segments', () => {
    expect(() => parseProviderURI('vault://secrets/../../../etc/passwd')).toThrow(SecretError);
    expect(() => parseProviderURI('vault://secrets/../../../etc/passwd')).toThrow(/must not contain/);
  });

  it('rejects absolute paths in plain mode', () => {
    expect(() => parseProviderURI('/etc/passwd')).toThrow(SecretError);
    expect(() => parseProviderURI('/etc/passwd')).toThrow(/must be relative/);
  });
});

// --- Path Validation ---

describe('validateSecretPath', () => {
  it('accepts valid relative paths', () => {
    expect(() => validateSecretPath('stripe/api-key')).not.toThrow();
    expect(() => validateSecretPath('simple-key')).not.toThrow();
    expect(() => validateSecretPath('services/github/token')).not.toThrow();
  });

  it('rejects empty paths', () => {
    expect(() => validateSecretPath('')).toThrow(SecretError);
  });

  it('rejects absolute paths', () => {
    expect(() => validateSecretPath('/etc/passwd')).toThrow(SecretError);
  });

  it('rejects .. traversal segments', () => {
    expect(() => validateSecretPath('../escape')).toThrow(SecretError);
    expect(() => validateSecretPath('a/../../escape')).toThrow(SecretError);
    expect(() => validateSecretPath('a/b/../c')).toThrow(SecretError);
  });

  it('rejects paths exceeding max length', () => {
    const longPath = 'a/'.repeat(600);
    expect(() => validateSecretPath(longPath)).toThrow(SecretError);
    expect(() => validateSecretPath(longPath)).toThrow(/maximum length/);
  });

  it('allows paths with dots that are not traversal', () => {
    expect(() => validateSecretPath('.hidden')).not.toThrow();
    expect(() => validateSecretPath('file.txt')).not.toThrow();
    expect(() => validateSecretPath('path/to/.config')).not.toThrow();
  });
});

// --- SecretError ---

describe('SecretError', () => {
  it('has correct code and message', () => {
    const err = new SecretError(SecretErrorCode.INVALID_PATH, 'bad path');
    expect(err.code).toBe(SecretErrorCode.INVALID_PATH);
    expect(err.message).toBe('bad path');
    expect(err.name).toBe('SecretError');
    expect(err).toBeInstanceOf(Error);
  });

  it('carries optional provider and path info', () => {
    const err = new SecretError(SecretErrorCode.CRYPTO_ERROR, 'decrypt failed', {
      provider: 'local',
      secretPath: 'stripe/key',
    });
    expect(err.provider).toBe('local');
    expect(err.secretPath).toBe('stripe/key');
  });
});

// --- Environment Provider ---

describe('EnvProvider', () => {
  let provider: EnvProvider;

  beforeEach(async () => {
    provider = new EnvProvider({
      name: 'test-env',
      type: 'env',
      config: {},
    });
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.dispose();
    delete process.env.TEST_SECRET_VALUE;
    delete process.env.JANEE_DB_PASSWORD;
  });

  it('reads existing environment variables', async () => {
    process.env.TEST_SECRET_VALUE = 'super-secret-123';
    expect(await provider.getSecret('TEST_SECRET_VALUE')).toBe('super-secret-123');
  });

  it('returns null for missing variables', async () => {
    expect(await provider.getSecret('NONEXISTENT_VAR_XYZ')).toBeNull();
  });

  it('supports prefix configuration', async () => {
    const prefixed = new EnvProvider({
      name: 'prefixed',
      type: 'env',
      config: { prefix: 'JANEE_' },
    });
    await prefixed.initialize();

    process.env.JANEE_DB_PASSWORD = 'db-pass-456';
    expect(await prefixed.getSecret('DB_PASSWORD')).toBe('db-pass-456');

    await prefixed.dispose();
  });

  it('throws SecretError when required var is missing', async () => {
    const strict = new EnvProvider({
      name: 'strict',
      type: 'env',
      config: { required: true },
    });
    await strict.initialize();

    try {
      await strict.getSecret('MISSING_REQUIRED_VAR');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.NOT_FOUND);
    }

    await strict.dispose();
  });

  it('lists matching environment variables', async () => {
    process.env.TEST_SECRET_VALUE = 'a';
    const secrets = await provider.listSecrets('TEST_SECRET');
    expect(secrets).toContain('TEST_SECRET_VALUE');
  });

  it('health check always passes', async () => {
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('throws SecretError if not initialized', async () => {
    const uninitialized = new EnvProvider({
      name: 'raw',
      type: 'env',
      config: {},
    });
    try {
      await uninitialized.getSecret('FOO');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.NOT_INITIALIZED);
    }
  });
});

// --- Filesystem Provider ---

describe('FilesystemProvider', () => {
  let provider: FilesystemProvider;
  let tmpDir: string;
  let masterKey: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-test-'));
    masterKey = generateMasterKey();
    
    provider = new FilesystemProvider({
      name: 'test-fs',
      type: 'filesystem',
      config: { path: tmpDir, masterKey },
    });
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves secrets', async () => {
    await provider.setSecret!('stripe/api-key', 'sk_test_abc123');
    const value = await provider.getSecret('stripe/api-key');
    expect(value).toBe('sk_test_abc123');
  });

  it('returns null for missing secrets', async () => {
    const value = await provider.getSecret('nonexistent');
    expect(value).toBeNull();
  });

  it('encrypts secrets on disk', async () => {
    await provider.setSecret!('sensitive', 'plaintext-value');
    
    const filePath = path.join(tmpDir, 'sensitive');
    const raw = fs.readFileSync(filePath, 'utf8');
    
    // Raw file should NOT contain plaintext
    expect(raw).not.toContain('plaintext-value');
    // But should be decryptable
    expect(decryptSecret(raw, masterKey)).toBe('plaintext-value');
  });

  it('handles nested paths', async () => {
    await provider.setSecret!('services/stripe/api-key', 'sk_abc');
    await provider.setSecret!('services/github/token', 'ghp_xyz');
    
    expect(await provider.getSecret('services/stripe/api-key')).toBe('sk_abc');
    expect(await provider.getSecret('services/github/token')).toBe('ghp_xyz');
  });

  it('deletes secrets', async () => {
    await provider.setSecret!('temp-key', 'temp-value');
    expect(await provider.getSecret('temp-key')).toBe('temp-value');
    
    await provider.deleteSecret!('temp-key');
    expect(await provider.getSecret('temp-key')).toBeNull();
  });

  it('lists all secrets', async () => {
    await provider.setSecret!('a', '1');
    await provider.setSecret!('nested/b', '2');
    await provider.setSecret!('nested/c', '3');
    
    const all = await provider.listSecrets!();
    expect(all).toHaveLength(3);
    expect(all).toContain('a');
    expect(all).toContain(path.join('nested', 'b'));
    expect(all).toContain(path.join('nested', 'c'));
  });

  it('lists secrets with prefix filter', async () => {
    await provider.setSecret!('prod/stripe', '1');
    await provider.setSecret!('prod/github', '2');
    await provider.setSecret!('dev/openai', '3');
    
    const prodSecrets = await provider.listSecrets!('prod');
    expect(prodSecrets.length).toBe(2);
  });

  it('health check passes for valid directory', async () => {
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeDefined();
  });

  it('throws SecretError if not initialized', async () => {
    const raw = new FilesystemProvider({
      name: 'raw-fs',
      type: 'filesystem',
      config: { path: tmpDir, masterKey },
    });
    try {
      await raw.getSecret('foo');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.NOT_INITIALIZED);
    }
  });

  // --- Security: Path traversal prevention ---

  it('rejects .. path traversal attempts', async () => {
    try {
      await provider.getSecret('../../../etc/passwd');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.INVALID_PATH);
    }
  });

  it('rejects absolute paths', async () => {
    try {
      await provider.getSecret('/etc/passwd');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.INVALID_PATH);
    }
  });

  it('rejects paths that would escape via normalization', async () => {
    try {
      await provider.getSecret('a/b/../../../../etc/passwd');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SecretError);
      expect((err as SecretError).code).toBe(SecretErrorCode.INVALID_PATH);
    }
  });

  it('requires masterKey in config', () => {
    expect(() => new FilesystemProvider({
      name: 'bad',
      type: 'filesystem',
      config: { path: tmpDir },
    })).toThrow(SecretError);
  });
});

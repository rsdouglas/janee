/**
 * Tests for the Environment Variable Secrets Provider
 *
 * Covers: initialization, secret retrieval, prefix handling,
 * required mode, listing, disposal, and health checks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnvProvider } from './env';
import { SecretError, SecretErrorCode } from './types';

describe('EnvProvider', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  function deleteEnv(key: string) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  afterEach(() => {
    // Restore original env
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    Object.keys(savedEnv).forEach(k => delete savedEnv[k]);
  });

  function createProvider(overrides: Record<string, unknown> = {}) {
    return new EnvProvider({
      name: 'test-env',
      type: 'env',
      config: { ...overrides },
    });
  }

  describe('initialization', () => {
    it('initializes without errors', async () => {
      const provider = createProvider();
      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it('has correct name and type', () => {
      const provider = createProvider();
      expect(provider.name).toBe('test-env');
      expect(provider.type).toBe('env');
    });

    it('throws NOT_INITIALIZED when getSecret called before initialize', async () => {
      const provider = createProvider();
      await expect(provider.getSecret('FOO')).rejects.toThrow(SecretError);
      try {
        await provider.getSecret('FOO');
      } catch (err) {
        expect((err as SecretError).code).toBe(SecretErrorCode.NOT_INITIALIZED);
      }
    });

    it('throws NOT_INITIALIZED when listSecrets called before initialize', async () => {
      const provider = createProvider();
      await expect(provider.listSecrets()).rejects.toThrow(SecretError);
    });
  });

  describe('getSecret', () => {
    let provider: EnvProvider;

    beforeEach(async () => {
      provider = createProvider();
      await provider.initialize();
    });

    it('returns value for existing env var', async () => {
      setEnv('JANEE_TEST_SECRET', 'my-secret-value');
      const result = await provider.getSecret('JANEE_TEST_SECRET');
      expect(result).toBe('my-secret-value');
    });

    it('returns null for missing env var', async () => {
      deleteEnv('NONEXISTENT_VAR_12345');
      const result = await provider.getSecret('NONEXISTENT_VAR_12345');
      expect(result).toBeNull();
    });

    it('returns empty string for env var set to empty', async () => {
      setEnv('JANEE_TEST_EMPTY', '');
      const result = await provider.getSecret('JANEE_TEST_EMPTY');
      expect(result).toBe('');
    });
  });

  describe('prefix', () => {
    it('prepends prefix to lookups', async () => {
      setEnv('MYAPP_API_KEY', 'prefixed-value');
      const provider = new EnvProvider({
        name: 'prefixed',
        type: 'env',
        config: { prefix: 'MYAPP_' },
      });
      await provider.initialize();

      const result = await provider.getSecret('API_KEY');
      expect(result).toBe('prefixed-value');
    });

    it('uses empty prefix by default', async () => {
      setEnv('DIRECT_KEY', 'direct-value');
      const provider = createProvider();
      await provider.initialize();

      const result = await provider.getSecret('DIRECT_KEY');
      expect(result).toBe('direct-value');
    });
  });

  describe('required mode', () => {
    it('throws NOT_FOUND for missing vars when required=true', async () => {
      deleteEnv('MISSING_REQUIRED_VAR');
      const provider = new EnvProvider({
        name: 'required-env',
        type: 'env',
        config: { required: true },
      });
      await provider.initialize();

      await expect(provider.getSecret('MISSING_REQUIRED_VAR')).rejects.toThrow(SecretError);
      try {
        await provider.getSecret('MISSING_REQUIRED_VAR');
      } catch (err) {
        expect((err as SecretError).code).toBe(SecretErrorCode.NOT_FOUND);
        expect((err as SecretError).message).toContain('MISSING_REQUIRED_VAR');
      }
    });

    it('returns value normally when required=true and var exists', async () => {
      setEnv('EXISTING_REQUIRED', 'exists');
      const provider = new EnvProvider({
        name: 'required-env',
        type: 'env',
        config: { required: true },
      });
      await provider.initialize();

      const result = await provider.getSecret('EXISTING_REQUIRED');
      expect(result).toBe('exists');
    });
  });

  describe('listSecrets', () => {
    it('lists env vars matching prefix', async () => {
      setEnv('JANEE_LIST_A', 'a');
      setEnv('JANEE_LIST_B', 'b');
      setEnv('OTHER_VAR', 'other');

      const provider = new EnvProvider({
        name: 'list-test',
        type: 'env',
        config: { prefix: 'JANEE_' },
      });
      await provider.initialize();

      const secrets = await provider.listSecrets('LIST_');
      expect(secrets).toContain('LIST_A');
      expect(secrets).toContain('LIST_B');
      expect(secrets).not.toContain('OTHER_VAR');
    });

    it('returns empty array when no matches', async () => {
      const provider = new EnvProvider({
        name: 'list-test',
        type: 'env',
        config: { prefix: 'ZZZZZ_NONEXISTENT_' },
      });
      await provider.initialize();

      const secrets = await provider.listSecrets();
      expect(secrets).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('marks provider as uninitialized after dispose', async () => {
      const provider = createProvider();
      await provider.initialize();
      await provider.dispose();

      await expect(provider.getSecret('FOO')).rejects.toThrow(SecretError);
    });
  });

  describe('healthCheck', () => {
    it('returns healthy=true', async () => {
      const provider = createProvider();
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBe(0);
    });
  });
});

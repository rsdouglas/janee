/**
 * Tests for the Filesystem Secrets Provider
 *
 * Covers: initialization, encrypt/decrypt round-trip, missing secrets,
 * setSecret, deleteSecret, listSecrets, healthCheck, disposal, and
 * error handling (bad master key, directory permissions).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemProvider } from './filesystem';
import { SecretError, SecretErrorCode } from './types';
import { generateMasterKey } from '../core/crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FilesystemProvider', () => {
  let tmpDir: string;
  let masterKey: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-fs-test-'));
    masterKey = generateMasterKey();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createProvider(overrides: Record<string, unknown> = {}) {
    return new FilesystemProvider({
      name: 'test-fs',
      type: 'filesystem',
      config: {
        masterKey,
        path: tmpDir,
        ...overrides,
      },
    });
  }

  describe('construction', () => {
    it('throws CONFIG_ERROR when masterKey is missing', () => {
      expect(() => new FilesystemProvider({
        name: 'bad',
        type: 'filesystem',
        config: { path: tmpDir },
      })).toThrow(SecretError);

      try {
        new FilesystemProvider({
          name: 'bad',
          type: 'filesystem',
          config: { path: tmpDir },
        });
      } catch (err) {
        expect((err as SecretError).code).toBe(SecretErrorCode.CONFIG_ERROR);
      }
    });

    it('has correct name and type', () => {
      const provider = createProvider();
      expect(provider.name).toBe('test-fs');
      expect(provider.type).toBe('filesystem');
    });
  });

  describe('initialization', () => {
    it('creates secrets directory if missing', async () => {
      const newDir = path.join(tmpDir, 'subdir', 'secrets');
      const provider = createProvider({ path: newDir });
      await provider.initialize();

      expect(fs.existsSync(newDir)).toBe(true);
    });

    it('succeeds when directory already exists', async () => {
      const provider = createProvider();
      await expect(provider.initialize()).resolves.toBeUndefined();
    });

    it('throws NOT_INITIALIZED when getSecret called before initialize', async () => {
      const provider = createProvider();
      await expect(provider.getSecret('foo')).rejects.toThrow(SecretError);
      try {
        await provider.getSecret('foo');
      } catch (err) {
        expect((err as SecretError).code).toBe(SecretErrorCode.NOT_INITIALIZED);
      }
    });
  });

  describe('setSecret + getSecret round-trip', () => {
    let provider: FilesystemProvider;

    beforeEach(async () => {
      provider = createProvider();
      await provider.initialize();
    });

    it('stores and retrieves a secret', async () => {
      await provider.setSecret('api-key', 'super-secret-123');
      const value = await provider.getSecret('api-key');
      expect(value).toBe('super-secret-123');
    });

    it('handles nested paths', async () => {
      await provider.setSecret('services/stripe/api-key', 'sk_test_abc');
      const value = await provider.getSecret('services/stripe/api-key');
      expect(value).toBe('sk_test_abc');
    });

    it('handles special characters in values', async () => {
      const specialValue = 'p@$$w0rd!#%^&*()_+={}"<>?';
      await provider.setSecret('special', specialValue);
      expect(await provider.getSecret('special')).toBe(specialValue);
    });

    it('handles empty string values', async () => {
      await provider.setSecret('empty', '');
      expect(await provider.getSecret('empty')).toBe('');
    });

    it('handles unicode values', async () => {
      const unicode = '日本語テスト 🔐🗝️';
      await provider.setSecret('unicode', unicode);
      expect(await provider.getSecret('unicode')).toBe(unicode);
    });

    it('overwrites existing secret', async () => {
      await provider.setSecret('key', 'value-1');
      await provider.setSecret('key', 'value-2');
      expect(await provider.getSecret('key')).toBe('value-2');
    });
  });

  describe('getSecret', () => {
    it('returns null for non-existent secret', async () => {
      const provider = createProvider();
      await provider.initialize();
      expect(await provider.getSecret('nonexistent')).toBeNull();
    });

    it('throws CRYPTO_ERROR when file is corrupted', async () => {
      const provider = createProvider();
      await provider.initialize();

      // Write a corrupt file directly
      const filePath = path.join(tmpDir, 'corrupted');
      fs.writeFileSync(filePath, 'not-valid-encrypted-data');

      await expect(provider.getSecret('corrupted')).rejects.toThrow(SecretError);
      try {
        await provider.getSecret('corrupted');
      } catch (err) {
        expect((err as SecretError).code).toBe(SecretErrorCode.CRYPTO_ERROR);
      }
    });

    it('cannot decrypt with wrong master key', async () => {
      // Store with one key
      const provider1 = createProvider();
      await provider1.initialize();
      await provider1.setSecret('key', 'secret');

      // Try to read with different key
      const differentKey = generateMasterKey();
      const provider2 = createProvider({ masterKey: differentKey });
      await provider2.initialize();

      await expect(provider2.getSecret('key')).rejects.toThrow(SecretError);
    });
  });

  describe('deleteSecret', () => {
    it('removes an existing secret', async () => {
      const provider = createProvider();
      await provider.initialize();
      await provider.setSecret('to-delete', 'value');
      expect(await provider.getSecret('to-delete')).toBe('value');

      await provider.deleteSecret('to-delete');
      expect(await provider.getSecret('to-delete')).toBeNull();
    });

    it('is idempotent for non-existent secrets', async () => {
      const provider = createProvider();
      await provider.initialize();
      await expect(provider.deleteSecret('never-existed')).resolves.toBeUndefined();
    });
  });

  describe('listSecrets', () => {
    it('lists all stored secrets', async () => {
      const provider = createProvider();
      await provider.initialize();
      await provider.setSecret('alpha', 'a');
      await provider.setSecret('beta', 'b');
      await provider.setSecret('gamma', 'c');

      const secrets = await provider.listSecrets();
      expect(secrets.sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('lists secrets with prefix filter', async () => {
      const provider = createProvider();
      await provider.initialize();
      await provider.setSecret('mcp/service-a', 'a');
      await provider.setSecret('mcp/service-b', 'b');
      await provider.setSecret('other/key', 'c');

      const secrets = await provider.listSecrets('mcp');
      expect(secrets.sort()).toEqual(['mcp/service-a', 'mcp/service-b'].sort().map(s => path.relative(tmpDir, path.join(tmpDir, s))));
    });

    it('returns empty array for empty directory', async () => {
      const provider = createProvider();
      await provider.initialize();
      expect(await provider.listSecrets()).toEqual([]);
    });

    it('returns empty array for non-existent prefix', async () => {
      const provider = createProvider();
      await provider.initialize();
      expect(await provider.listSecrets('nonexistent')).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('marks provider as uninitialized', async () => {
      const provider = createProvider();
      await provider.initialize();
      await provider.dispose();

      await expect(provider.getSecret('foo')).rejects.toThrow(SecretError);
    });
  });

  describe('healthCheck', () => {
    it('returns healthy when directory exists and writable', async () => {
      const provider = createProvider();
      await provider.initialize();

      const result = await provider.healthCheck();
      expect(result.healthy).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
    });

    it('returns unhealthy for non-existent directory', async () => {
      const provider = createProvider({ path: '/tmp/nonexistent-janee-test-dir-xyz' });
      // Don't initialize (which creates the dir)
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(false);
    });
  });
});

/**
 * Tests for config split (config.yaml + credentials.json)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  loadYAMLConfig, 
  saveYAMLConfig, 
  JaneeYAMLConfig,
  initYAMLConfig,
  hasYAMLConfig
} from './config-yaml';
import { encryptSecret, generateMasterKey } from '../core/crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';

describe('Config YAML', () => {
  let testConfigDir: string;
  let testJaneeDir: string;
  let testConfigFile: string;
  let testCredentialsFile: string;
  let originalHomedir: () => string;
  
  beforeEach(() => {
    testConfigDir = path.join(os.tmpdir(), `janee-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    testJaneeDir = path.join(testConfigDir, '.janee');
    testConfigFile = path.join(testJaneeDir, 'config.yaml');
    testCredentialsFile = path.join(testJaneeDir, 'credentials.json');
    
    fs.mkdirSync(testJaneeDir, { recursive: true });
    
    originalHomedir = os.homedir;
    os.homedir = () => testConfigDir;
  });
  
  afterEach(() => {
    os.homedir = originalHomedir;
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('Split file format', () => {
    it('should write secrets to credentials.json, not config.yaml', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true },
        services: {
          testSvc: {
            baseUrl: 'https://api.test.com',
            auth: { type: 'bearer', key: 'my-secret-key' }
          }
        },
        capabilities: {}
      };

      saveYAMLConfig(config);

      // YAML should NOT contain the secret or masterKey
      const yamlOnDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(yamlOnDisk).not.toContain('my-secret-key');
      expect(yamlOnDisk).not.toContain(masterKey);
      expect(yamlOnDisk).toContain('type: bearer');
      expect(yamlOnDisk).toContain('baseUrl: https://api.test.com');

      // credentials.json should exist with masterKey and encrypted secret
      expect(fs.existsSync(testCredentialsFile)).toBe(true);
      const creds = JSON.parse(fs.readFileSync(testCredentialsFile, 'utf8'));
      expect(creds.masterKey).toBe(masterKey);
      expect(creds.secrets.testSvc.key).toBeDefined();
      expect(creds.secrets.testSvc.key).not.toBe('my-secret-key');
    });

    it('should round-trip save and load correctly', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true },
        services: {
          bearer: {
            baseUrl: 'https://api1.com',
            auth: { type: 'bearer', key: 'bearer-key' }
          },
          hmac: {
            baseUrl: 'https://api2.com',
            auth: { type: 'hmac-mexc', apiKey: 'hk', apiSecret: 'hs' }
          },
          hdrs: {
            baseUrl: 'https://api3.com',
            auth: { type: 'headers', headers: { 'X-Key': 'hv' } }
          }
        },
        capabilities: {}
      };

      saveYAMLConfig(config);
      const loaded = loadYAMLConfig();

      expect(loaded.masterKey).toBe(masterKey);
      expect(loaded.services.bearer.auth.key).toBe('bearer-key');
      expect(loaded.services.hmac.auth.apiKey).toBe('hk');
      expect(loaded.services.hmac.auth.apiSecret).toBe('hs');
      expect(loaded.services.hdrs.auth.headers?.['X-Key']).toBe('hv');
    });

    it('should handle all auth types correctly', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true },
        services: {
          svcAccount: {
            baseUrl: 'https://api4.com',
            auth: { type: 'service-account', credentials: '{"key":"val"}', scopes: ['read'] }
          },
          ghApp: {
            baseUrl: 'https://api.github.com',
            auth: { type: 'github-app', appId: '123', privateKey: 'PEM-DATA', installationId: '456' }
          },
          okx: {
            baseUrl: 'https://www.okx.com',
            auth: { type: 'hmac-okx', apiKey: 'k', apiSecret: 's', passphrase: 'p' }
          }
        },
        capabilities: {}
      };

      saveYAMLConfig(config);
      const loaded = loadYAMLConfig();

      expect(loaded.services.svcAccount.auth.credentials).toBe('{"key":"val"}');
      expect(loaded.services.svcAccount.auth.scopes).toEqual(['read']);
      expect(loaded.services.ghApp.auth.privateKey).toBe('PEM-DATA');
      expect(loaded.services.ghApp.auth.appId).toBe('123');
      expect(loaded.services.ghApp.auth.installationId).toBe('456');
      expect(loaded.services.okx.auth.passphrase).toBe('p');

      // Non-secret metadata should be in YAML
      const yamlOnDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(yamlOnDisk).toContain("appId: '123'");
      expect(yamlOnDisk).toContain("installationId: '456'");
      expect(yamlOnDisk).not.toContain('PEM-DATA');
    });

    it('should preserve capabilities and server config', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true, defaultAccess: 'restricted' },
        services: {
          api: {
            baseUrl: 'https://api.com',
            auth: { type: 'bearer', key: 'k' }
          }
        },
        capabilities: {
          api_ro: { service: 'api', ttl: '1h', autoApprove: true, rules: { allow: ['GET *'], deny: ['POST *'] } }
        }
      };

      saveYAMLConfig(config);
      const loaded = loadYAMLConfig();

      expect(loaded.server.defaultAccess).toBe('restricted');
      expect(loaded.capabilities.api_ro.rules?.allow).toEqual(['GET *']);
    });
  });

  describe('Strict Decryption Mode', () => {
    it('should throw error on decryption failure when strictDecryption is true', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: { type: 'bearer', key: 'test-key' }
          }
        },
        capabilities: {}
      };

      saveYAMLConfig(config);

      // Corrupt credentials by swapping to a different master key
      const wrongKey = generateMasterKey();
      const creds = JSON.parse(fs.readFileSync(testCredentialsFile, 'utf8'));
      creds.masterKey = wrongKey;
      fs.writeFileSync(testCredentialsFile, JSON.stringify(creds));

      expect(() => loadYAMLConfig()).toThrow(/Failed to decrypt/);
    });

    it('should fall back to plaintext when strictDecryption is false', () => {
      const masterKey = generateMasterKey();
      const config: JaneeYAMLConfig = {
        version: '0.3.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: false },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: { type: 'bearer', key: 'test-key' }
          }
        },
        capabilities: {}
      };

      saveYAMLConfig(config);

      // Replace encrypted value with plaintext in credentials.json
      const creds = JSON.parse(fs.readFileSync(testCredentialsFile, 'utf8'));
      creds.secrets.testService.key = 'plaintext-value';
      fs.writeFileSync(testCredentialsFile, JSON.stringify(creds));

      const loaded = loadYAMLConfig();
      expect(loaded.services.testService.auth.key).toBe('plaintext-value');
    });
  });

  describe('Legacy migration (v0.2.0 → v0.3.0)', () => {
    it('should auto-migrate inline masterKey + secrets on first load', () => {
      const masterKey = generateMasterKey();
      const encKey = encryptSecret('my-bearer-token', masterKey);

      // Write a legacy v0.2.0 config with inline masterKey and encrypted secrets
      const legacyConfig = {
        version: '0.2.0',
        masterKey,
        server: { port: 9119, host: 'localhost', strictDecryption: true },
        services: {
          myapi: {
            baseUrl: 'https://api.example.com',
            auth: { type: 'bearer', key: encKey }
          }
        },
        capabilities: {
          myapi: { service: 'myapi', ttl: '1h', autoApprove: true }
        }
      };
      fs.writeFileSync(testConfigFile, yaml.dump(legacyConfig), { mode: 0o600 });

      // Load should trigger migration and return decrypted config
      const loaded = loadYAMLConfig();
      expect(loaded.masterKey).toBe(masterKey);
      expect(loaded.services.myapi.auth.key).toBe('my-bearer-token');
      expect(loaded.capabilities.myapi.ttl).toBe('1h');

      // After migration, config.yaml should NOT have masterKey
      const yamlOnDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(yamlOnDisk).not.toContain(masterKey);
      const parsedYaml = yaml.load(yamlOnDisk) as any;
      expect(parsedYaml.masterKey).toBeUndefined();
      expect(parsedYaml.version).toBe('0.3.0');

      // credentials.json should exist
      expect(fs.existsSync(testCredentialsFile)).toBe(true);
      const creds = JSON.parse(fs.readFileSync(testCredentialsFile, 'utf8'));
      expect(creds.masterKey).toBe(masterKey);
      expect(creds.secrets.myapi).toBeDefined();
    });

    it('should migrate HMAC services correctly', () => {
      const masterKey = generateMasterKey();
      const legacyConfig = {
        version: '0.2.0',
        masterKey,
        server: { port: 9119, host: 'localhost' },
        services: {
          exchange: {
            baseUrl: 'https://api.exchange.com',
            auth: {
              type: 'hmac-bybit',
              apiKey: encryptSecret('ak', masterKey),
              apiSecret: encryptSecret('as', masterKey)
            }
          }
        },
        capabilities: {}
      };
      fs.writeFileSync(testConfigFile, yaml.dump(legacyConfig), { mode: 0o600 });

      const loaded = loadYAMLConfig();
      expect(loaded.services.exchange.auth.apiKey).toBe('ak');
      expect(loaded.services.exchange.auth.apiSecret).toBe('as');
    });
  });

  describe('initYAMLConfig', () => {
    it('should create split config with v0.3.0', () => {
      const config = initYAMLConfig();

      expect(config.server.strictDecryption).toBe(true);
      expect(config.version).toBe('0.3.0');
      expect(fs.existsSync(testConfigFile)).toBe(true);
      expect(fs.existsSync(testCredentialsFile)).toBe(true);

      // YAML should not contain masterKey
      const yamlOnDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(yamlOnDisk).not.toContain(config.masterKey);
    });
  });
});

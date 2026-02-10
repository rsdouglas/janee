/**
 * Tests for YAML config encryption and strict mode
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

describe('Config YAML', () => {
  let testConfigDir: string;
  let testConfigFile: string;
  let originalHomedir: () => string;
  
  beforeEach(() => {
    // Create unique test directory for each test
    testConfigDir = path.join(os.tmpdir(), `janee-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    testConfigFile = path.join(testConfigDir, '.janee', 'config.yaml');
    
    // Create test directory structure
    fs.mkdirSync(path.join(testConfigDir, '.janee'), { recursive: true });
    
    // Mock homedir to use test directory
    originalHomedir = os.homedir;
    os.homedir = () => testConfigDir;
  });
  
  afterEach(() => {
    // Restore original homedir
    os.homedir = originalHomedir;
    
    // Clean up test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe('Strict Decryption Mode', () => {
    it('should throw error on decryption failure when strictDecryption is true', () => {
      const masterKey = generateMasterKey();
      
      // Create config with strictDecryption: true
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: true
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'bearer',
              key: encryptSecret('test-key', masterKey)
            }
          }
        },
        capabilities: {}
      };
      
      saveYAMLConfig(config);
      
      // Corrupt the encrypted key by changing master key to a different one
      const wrongMasterKey = generateMasterKey();
      const corruptedConfig = fs.readFileSync(testConfigFile, 'utf8')
        .replace(masterKey, wrongMasterKey);
      fs.writeFileSync(testConfigFile, corruptedConfig, 'utf8');
      
      // Should throw with strict mode
      expect(() => loadYAMLConfig()).toThrow(/Failed to decrypt bearer token for service "testService"/);
    });

    it('should fall back to plaintext when strictDecryption is false', () => {
      const masterKey = generateMasterKey();
      const plaintextKey = 'plaintext-api-key';
      
      // Create config with strictDecryption: false and plaintext key
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: false
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'bearer',
              key: plaintextKey  // Not encrypted
            }
          }
        },
        capabilities: {}
      };
      
      // Write directly to file as YAML (bypassing encryption)
      const yaml = require('js-yaml');
      fs.writeFileSync(testConfigFile, yaml.dump(config), 'utf8');
      
      // Should load plaintext value without error
      const loaded = loadYAMLConfig();
      expect(loaded.services.testService.auth.key).toBe(plaintextKey);
    });

    it('should default to strict mode when not specified', () => {
      const masterKey = generateMasterKey();
      
      // Create config without strictDecryption setting
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost'
          // strictDecryption not set
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'bearer',
              key: encryptSecret('test-key', masterKey)
            }
          }
        },
        capabilities: {}
      };
      
      saveYAMLConfig(config);
      
      // Corrupt the encrypted key by changing to wrong master key
      const wrongMasterKey = generateMasterKey();
      const corruptedConfig = fs.readFileSync(testConfigFile, 'utf8')
        .replace(masterKey, wrongMasterKey);
      fs.writeFileSync(testConfigFile, corruptedConfig, 'utf8');
      
      // Should throw (default is strict)
      expect(() => loadYAMLConfig()).toThrow(/Failed to decrypt/);
    });
  });

  describe('Headers Auth Type Encryption', () => {
    it('should encrypt and decrypt headers auth values', () => {
      const masterKey = generateMasterKey();
      
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: true
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'headers',
              headers: {
                'X-API-Key': 'secret-api-key-123',
                'X-Custom-Header': 'another-secret'
              }
            }
          }
        },
        capabilities: {}
      };
      
      // Save and reload
      saveYAMLConfig(config);
      const loaded = loadYAMLConfig();
      
      // Values should be decrypted correctly
      expect(loaded.services.testService.auth.headers?.['X-API-Key']).toBe('secret-api-key-123');
      expect(loaded.services.testService.auth.headers?.['X-Custom-Header']).toBe('another-secret');
      
      // Check that values are encrypted on disk
      const onDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(onDisk).not.toContain('secret-api-key-123');
      expect(onDisk).not.toContain('another-secret');
    });

    it('should encrypt all header values independently', () => {
      const masterKey = generateMasterKey();
      
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: true
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'headers',
              headers: {
                'Authorization': 'Bearer secret-token',
                'X-API-Key': 'another-key',
                'X-Signature': 'signature-value'
              }
            }
          }
        },
        capabilities: {}
      };
      
      saveYAMLConfig(config);
      
      // Verify all values are encrypted on disk (should not contain plaintext)
      const onDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(onDisk).not.toContain('Bearer secret-token');
      expect(onDisk).not.toContain('another-key');
      expect(onDisk).not.toContain('signature-value');
      
      // Reload and verify all decrypted correctly
      const loaded = loadYAMLConfig();
      expect(loaded.services.testService.auth.headers?.['Authorization']).toBe('Bearer secret-token');
      expect(loaded.services.testService.auth.headers?.['X-API-Key']).toBe('another-key');
      expect(loaded.services.testService.auth.headers?.['X-Signature']).toBe('signature-value');
    });

    it('should throw on corrupted header value in strict mode', () => {
      const masterKey = generateMasterKey();
      
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: true
        },
        services: {
          testService: {
            baseUrl: 'https://api.test.com',
            auth: {
              type: 'headers',
              headers: {
                'X-API-Key': 'secret-key'
              }
            }
          }
        },
        capabilities: {}
      };
      
      saveYAMLConfig(config);
      
      // Corrupt one header value (replace first base64 value with invalid base64)
      let onDisk = fs.readFileSync(testConfigFile, 'utf8');
      // Find the first base64-like value after X-API-Key and corrupt it
      onDisk = onDisk.replace(/(X-API-Key:\s+)([A-Za-z0-9+/=]+)/, '$1corrupted-not-base64!!!');
      fs.writeFileSync(testConfigFile, onDisk, 'utf8');
      
      // Should throw with descriptive error
      expect(() => loadYAMLConfig()).toThrow(/Failed to decrypt header "X-API-Key" for service "testService"/);
    });
  });

  describe('initYAMLConfig', () => {
    it('should create config with strictDecryption enabled by default', () => {
      const config = initYAMLConfig();
      
      expect(config.server.strictDecryption).toBe(true);
    });
  });

  describe('Multiple Auth Types', () => {
    it('should encrypt all auth types correctly', () => {
      const masterKey = generateMasterKey();
      
      const config: JaneeYAMLConfig = {
        version: '0.2.0',
        masterKey,
        server: {
          port: 9119,
          host: 'localhost',
          strictDecryption: true
        },
        services: {
          bearerService: {
            baseUrl: 'https://api1.com',
            auth: { type: 'bearer', key: 'bearer-key' }
          },
          hmacService: {
            baseUrl: 'https://api2.com',
            auth: { 
              type: 'hmac-mexc', 
              apiKey: 'hmac-key',
              apiSecret: 'hmac-secret'
            }
          },
          headersService: {
            baseUrl: 'https://api3.com',
            auth: {
              type: 'headers',
              headers: { 'X-Key': 'header-value' }
            }
          }
        },
        capabilities: {}
      };
      
      saveYAMLConfig(config);
      const loaded = loadYAMLConfig();
      
      // All values should decrypt correctly
      expect(loaded.services.bearerService.auth.key).toBe('bearer-key');
      expect(loaded.services.hmacService.auth.apiKey).toBe('hmac-key');
      expect(loaded.services.hmacService.auth.apiSecret).toBe('hmac-secret');
      expect(loaded.services.headersService.auth.headers?.['X-Key']).toBe('header-value');
      
      // All values should be encrypted on disk
      const onDisk = fs.readFileSync(testConfigFile, 'utf8');
      expect(onDisk).not.toContain('bearer-key');
      expect(onDisk).not.toContain('hmac-key');
      expect(onDisk).not.toContain('hmac-secret');
      expect(onDisk).not.toContain('header-value');
    });
  });
});

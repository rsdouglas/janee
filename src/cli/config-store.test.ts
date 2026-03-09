import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the config dir to use a temp directory
const tmpDir = path.join(os.tmpdir(), 'janee-test-' + process.pid);

vi.stubEnv('JANEE_HOME', tmpDir);

import { generateMasterKey } from '../core/crypto';
import {
  addCapability,
  addService,
  hasConfig,
  initConfig,
  loadConfig,
  saveConfig,
  _resetMigrationFlag,
  JaneeConfig,
} from './config-store';

describe('config-store (SQLite)', () => {
  beforeEach(() => {
    _resetMigrationFlag();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { mode: 0o700, recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('should report no config initially', () => {
    expect(hasConfig()).toBe(false);
  });

  it('should initialize a fresh config', () => {
    const config = initConfig();
    expect(config.masterKey).toBeTruthy();
    expect(config.version).toBe('0.2.0');
    expect(config.server.port).toBe(9119);
    expect(hasConfig()).toBe(true);
  });

  it('should refuse double init', () => {
    initConfig();
    expect(() => initConfig()).toThrow('Config already exists');
  });

  it('should load config after init', () => {
    initConfig();
    const config = loadConfig();
    expect(config.masterKey).toBeTruthy();
    expect(config.server.port).toBe(9119);
    expect(Object.keys(config.services)).toHaveLength(0);
    expect(Object.keys(config.capabilities)).toHaveLength(0);
  });

  it('should add and load a service', () => {
    initConfig();
    addService('testapi', 'https://api.test.com', {
      type: 'bearer',
      key: 'test-secret-key',
    });

    const config = loadConfig();
    expect(config.services.testapi).toBeDefined();
    expect(config.services.testapi.baseUrl).toBe('https://api.test.com');
    // Key should be decrypted on load
    expect(config.services.testapi.auth.key).toBe('test-secret-key');
  });

  it('should refuse duplicate service names', () => {
    initConfig();
    addService('dup', 'https://example.com', { type: 'bearer', key: 'x' });
    expect(() =>
      addService('dup', 'https://example.com', { type: 'bearer', key: 'y' })
    ).toThrow('already exists');
  });

  it('should add and load a capability', () => {
    initConfig();
    addService('myapi', 'https://api.example.com', {
      type: 'bearer',
      key: 'secret',
    });
    addCapability('myapi_readonly', {
      service: 'myapi',
      ttl: '1h',
      autoApprove: true,
      rules: {
        allow: ['GET *'],
        deny: ['POST *', 'DELETE *'],
      },
    });

    const config = loadConfig();
    expect(config.capabilities.myapi_readonly).toBeDefined();
    expect(config.capabilities.myapi_readonly.ttl).toBe('1h');
    expect(config.capabilities.myapi_readonly.rules?.allow).toContain('GET *');
  });

  it('should round-trip save/load preserving all data', () => {
    const original = initConfig();
    original.server.logBodies = true;
    original.llm = { provider: 'anthropic', model: 'claude-3' };
    saveConfig(original);

    const loaded = loadConfig();
    expect(loaded.server.logBodies).toBe(true);
    expect(loaded.llm?.provider).toBe('anthropic');
    expect(loaded.llm?.model).toBe('claude-3');
  });

  it('should encrypt secrets at rest', () => {
    initConfig();
    addService('enc-test', 'https://example.com', {
      type: 'bearer',
      key: 'my-super-secret',
    });

    // Read the raw DB to verify encryption
    const Database = require('better-sqlite3');
    const dbPath = path.join(tmpDir, 'config.db');
    const db = new Database(dbPath);
    const row = db.prepare('SELECT config FROM services WHERE name = ?').get('enc-test') as { config: string };
    db.close();

    const storedConfig = JSON.parse(row.config);
    // Stored key should NOT be plaintext
    expect(storedConfig.auth.key).not.toBe('my-super-secret');
    // But loading should decrypt
    const config = loadConfig();
    expect(config.services['enc-test'].auth.key).toBe('my-super-secret');
  });

  it('should handle HMAC auth encryption', () => {
    initConfig();
    addService('exchange', 'https://api.exchange.com', {
      type: 'hmac-bybit',
      apiKey: 'my-api-key',
      apiSecret: 'my-api-secret',
    });

    const config = loadConfig();
    expect(config.services.exchange.auth.apiKey).toBe('my-api-key');
    expect(config.services.exchange.auth.apiSecret).toBe('my-api-secret');
  });

  it('should migrate from YAML on first load', () => {
    // Create a YAML config file manually
    const yamlPath = path.join(tmpDir, 'config.yaml');
    // generateMasterKey imported at top
    const masterKey = generateMasterKey();

    const yamlContent = `
version: '0.2.0'
masterKey: '${masterKey}'
server:
  port: 9119
  host: localhost
services: {}
capabilities: {}
`;
    fs.writeFileSync(yamlPath, yamlContent);

    // Loading should trigger migration
    const config = loadConfig();
    expect(config.masterKey).toBe(masterKey);
    expect(config.server.port).toBe(9119);

    // YAML should be renamed
    expect(fs.existsSync(yamlPath)).toBe(false);
    expect(fs.existsSync(yamlPath + '.migrated')).toBe(true);

    // DB should exist
    expect(fs.existsSync(path.join(tmpDir, 'config.db'))).toBe(true);
  });
});

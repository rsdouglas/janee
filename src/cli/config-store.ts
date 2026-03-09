/**
 * SQLite-backed configuration store for Janee.
 *
 * Replaces the YAML config file with a SQLite database for:
 *  - Atomic writes (no partial corruption)
 *  - Binary blob storage (no base64 noise)
 *  - Schema enforcement
 *  - No caching — always reads fresh from disk
 *
 * On first run, automatically migrates from config.yaml if present.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import yaml from 'js-yaml';
import os from 'os';
import path from 'path';

import {
  agentCreatedOwnership,
  cliCreatedOwnership,
  CredentialOwnership,
} from '../core/agent-scope';
import {
  decryptSecret,
  encryptSecret,
  generateMasterKey,
} from '../core/crypto';

// Re-export types (unchanged from config-yaml.ts)
export type { CredentialOwnership } from '../core/agent-scope';

export interface AuthConfig {
  type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account' | 'github-app';
  key?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  headers?: Record<string, string>;
  credentials?: string;
  scopes?: string[];
  appId?: string;
  privateKey?: string;
  installationId?: string;
}

export interface ServiceConfig {
  baseUrl: string;
  auth: AuthConfig;
  testPath?: string;
  ownership?: CredentialOwnership;
}

export interface CapabilityConfig {
  service: string;
  ttl: string;
  autoApprove?: boolean;
  requiresReason?: boolean;
  rules?: {
    allow?: string[];
    deny?: string[];
  };
  allowedAgents?: string[];
  mode?: 'proxy' | 'exec';
  allowCommands?: string[];
  env?: Record<string, string>;
  workDir?: string;
  timeout?: number;
}

export interface LLMConfig {
  provider?: 'openai' | 'anthropic';
  apiKey?: string;
  model?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  logBodies?: boolean;
  strictDecryption?: boolean;
  defaultAccess?: 'open' | 'restricted';
}

export interface JaneeConfig {
  version: string;
  masterKey: string;
  server: ServerConfig;
  llm?: LLMConfig;
  services: Record<string, ServiceConfig>;
  capabilities: Record<string, CapabilityConfig>;
}

// For backwards compatibility
export type JaneeYAMLConfig = JaneeConfig;

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getConfigDir(): string {
  return process.env.JANEE_HOME || path.join(os.homedir(), '.janee');
}

export function getAuditDir(): string {
  return path.join(getConfigDir(), 'logs');
}

function getDbPath(): string {
  return path.join(getConfigDir(), 'config.db');
}

function getYamlPath(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

// ---------------------------------------------------------------------------
// Database helpers (no caching — open/close per operation)
// ---------------------------------------------------------------------------

function openDb(): Database.Database {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Restrict file permissions
  fs.chmodSync(dbPath, 0o600);
  return db;
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      name      TEXT PRIMARY KEY,
      config    TEXT NOT NULL   -- JSON blob
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      name      TEXT PRIMARY KEY,
      config    TEXT NOT NULL   -- JSON blob
    );
  `);

  // Set schema version if not present
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') as { value: string } | undefined;
  if (!row) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  }
}

// ---------------------------------------------------------------------------
// Core read/write
// ---------------------------------------------------------------------------

function readMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, value);
}

// ---------------------------------------------------------------------------
// Decrypt helpers
// ---------------------------------------------------------------------------

function tryDecrypt(
  encrypted: string,
  masterKey: string,
  strictMode: boolean,
  fieldDescription: string
): string {
  try {
    return decryptSecret(encrypted, masterKey);
  } catch (error) {
    if (strictMode) {
      throw new Error(
        `Failed to decrypt ${fieldDescription}. ` +
        `This usually means the value is corrupted or the master key is wrong. ` +
        `To allow plaintext values (not recommended), set server.strictDecryption to false. ` +
        `Error: ${error instanceof Error ? error.message : error}`
      );
    }
    return encrypted;
  }
}

function decryptServiceAuth(name: string, svc: ServiceConfig, masterKey: string, strict: boolean): void {
  if (svc.auth.type === 'bearer' && svc.auth.key) {
    svc.auth.key = tryDecrypt(svc.auth.key, masterKey, strict, `bearer token for service "${name}"`);
  } else if (['hmac-mexc', 'hmac-bybit', 'hmac-okx'].includes(svc.auth.type)) {
    if (svc.auth.apiKey)
      svc.auth.apiKey = tryDecrypt(svc.auth.apiKey, masterKey, strict, `API key for service "${name}"`);
    if (svc.auth.apiSecret)
      svc.auth.apiSecret = tryDecrypt(svc.auth.apiSecret, masterKey, strict, `API secret for service "${name}"`);
    if (svc.auth.passphrase)
      svc.auth.passphrase = tryDecrypt(svc.auth.passphrase, masterKey, strict, `passphrase for service "${name}"`);
  } else if (svc.auth.type === 'headers' && svc.auth.headers) {
    for (const [headerName, headerValue] of Object.entries(svc.auth.headers)) {
      svc.auth.headers[headerName] = tryDecrypt(headerValue, masterKey, strict, `header "${headerName}" for service "${name}"`);
    }
  } else if (svc.auth.type === 'service-account' && svc.auth.credentials) {
    svc.auth.credentials = tryDecrypt(svc.auth.credentials, masterKey, strict, `service account credentials for service "${name}"`);
  } else if (svc.auth.type === 'github-app' && svc.auth.privateKey) {
    svc.auth.privateKey = tryDecrypt(svc.auth.privateKey, masterKey, strict, `GitHub App private key for service "${name}"`);
  }
}

function encryptServiceAuth(svc: ServiceConfig, masterKey: string): ServiceConfig {
  const copy: ServiceConfig = JSON.parse(JSON.stringify(svc));
  if (copy.auth.type === 'bearer' && copy.auth.key) {
    copy.auth.key = encryptSecret(copy.auth.key, masterKey);
  } else if (['hmac-mexc', 'hmac-bybit', 'hmac-okx'].includes(copy.auth.type)) {
    if (copy.auth.apiKey) copy.auth.apiKey = encryptSecret(copy.auth.apiKey, masterKey);
    if (copy.auth.apiSecret) copy.auth.apiSecret = encryptSecret(copy.auth.apiSecret, masterKey);
    if (copy.auth.passphrase) copy.auth.passphrase = encryptSecret(copy.auth.passphrase, masterKey);
  } else if (copy.auth.type === 'headers' && copy.auth.headers) {
    for (const headerName of Object.keys(copy.auth.headers)) {
      copy.auth.headers[headerName] = encryptSecret(copy.auth.headers[headerName], masterKey);
    }
  } else if (copy.auth.type === 'service-account' && copy.auth.credentials) {
    copy.auth.credentials = encryptSecret(copy.auth.credentials, masterKey);
  } else if (copy.auth.type === 'github-app' && copy.auth.privateKey) {
    copy.auth.privateKey = encryptSecret(copy.auth.privateKey, masterKey);
  }
  return copy;
}

let _yamlMigrationChecked = false;

// ---------------------------------------------------------------------------
// YAML migration
// ---------------------------------------------------------------------------

function migrateFromYAML(db: Database.Database): void {
  if (_yamlMigrationChecked) return;
  _yamlMigrationChecked = true;

  const yamlPath = getYamlPath();
  if (!fs.existsSync(yamlPath)) return;

  // Only migrate if the database is empty (no master key yet)
  const existingKey = readMeta(db, 'master_key');
  if (existingKey) {
    // DB already populated — YAML is stale. Rename it to avoid confusion.
    const stalePath = yamlPath + '.stale-' + Date.now();
    fs.renameSync(yamlPath, stalePath);
    console.log(`SQLite config already populated. Renamed stale config.yaml to ${path.basename(stalePath)}`);
    return;
  }

  console.log('Migrating config.yaml → SQLite...');
  const content = fs.readFileSync(yamlPath, 'utf8');
  const config = yaml.load(content) as JaneeConfig;
  config.services = config.services || {};
  config.capabilities = config.capabilities || {};

  // Write metadata
  writeMeta(db, 'master_key', config.masterKey);
  writeMeta(db, 'version', config.version || '0.2.0');
  writeMeta(db, 'server', JSON.stringify(config.server));
  if (config.llm) {
    writeMeta(db, 'llm', JSON.stringify(config.llm));
  }

  // Write services (stored with encrypted values — YAML already has them encrypted)
  const insertService = db.prepare('INSERT OR REPLACE INTO services (name, config) VALUES (?, ?)');
  for (const [name, svc] of Object.entries(config.services)) {
    insertService.run(name, JSON.stringify(svc));
  }

  // Write capabilities
  const insertCap = db.prepare('INSERT OR REPLACE INTO capabilities (name, config) VALUES (?, ?)');
  for (const [name, cap] of Object.entries(config.capabilities)) {
    insertCap.run(name, JSON.stringify(cap));
  }

  // Rename YAML to signal migration complete
  const backupPath = yamlPath + '.migrated';
  fs.renameSync(yamlPath, backupPath);
  console.log(`Migration complete. Old config saved as ${backupPath}`);
}


// ---------------------------------------------------------------------------
// Public API — drop-in replacements for config-yaml.ts exports
// ---------------------------------------------------------------------------

/**
 * Check if a config store exists (SQLite DB or YAML to migrate)
 */
export function hasConfig(): boolean {
  return fs.existsSync(getDbPath()) || fs.existsSync(getYamlPath());
}

/** @internal — reset migration flag for tests */
export function _resetMigrationFlag(): void {
  _yamlMigrationChecked = false;
}

/** @deprecated Use hasConfig() */
export const hasYAMLConfig = hasConfig;

/**
 * Load full config from SQLite. Always fresh — no caching.
 * Secrets are decrypted in the returned object.
 */
export function loadConfig(): JaneeConfig {
  const db = openDb();
  try {
    ensureSchema(db);
    migrateFromYAML(db);

    const masterKey = readMeta(db, 'master_key');
    if (!masterKey) {
      throw new Error('No config found. Run `janee init` to create one.');
    }

    const version = readMeta(db, 'version') || '0.2.0';
    const serverJson = readMeta(db, 'server');
    const server: ServerConfig = serverJson ? JSON.parse(serverJson) : { port: 9119, host: 'localhost' };
    const llmJson = readMeta(db, 'llm');
    const llm: LLMConfig | undefined = llmJson ? JSON.parse(llmJson) : undefined;

    const strictDecryption = server.strictDecryption ?? true;

    // Load services
    const services: Record<string, ServiceConfig> = {};
    const serviceRows = db.prepare('SELECT name, config FROM services').all() as { name: string; config: string }[];
    for (const row of serviceRows) {
      const svc: ServiceConfig = JSON.parse(row.config);
      decryptServiceAuth(row.name, svc, masterKey, strictDecryption);
      services[row.name] = svc;
    }

    // Load capabilities
    const capabilities: Record<string, CapabilityConfig> = {};
    const capRows = db.prepare('SELECT name, config FROM capabilities').all() as { name: string; config: string }[];
    for (const row of capRows) {
      capabilities[row.name] = JSON.parse(row.config);
    }

    return { version, masterKey, server, llm, services, capabilities };
  } finally {
    db.close();
  }
}

/** @deprecated Use loadConfig() */
export const loadYAMLConfig = loadConfig;

/**
 * Save full config to SQLite. Encrypts secrets before writing.
 */
export function saveConfig(config: JaneeConfig): void {
  const db = openDb();
  try {
    ensureSchema(db);

    const save = db.transaction(() => {
      writeMeta(db, 'master_key', config.masterKey);
      writeMeta(db, 'version', config.version);
      writeMeta(db, 'server', JSON.stringify(config.server));
      if (config.llm) {
        writeMeta(db, 'llm', JSON.stringify(config.llm));
      } else {
        db.prepare('DELETE FROM meta WHERE key = ?').run('llm');
      }

      // Clear and re-insert services
      db.prepare('DELETE FROM services').run();
      const insertService = db.prepare('INSERT INTO services (name, config) VALUES (?, ?)');
      for (const [name, svc] of Object.entries(config.services)) {
        const encrypted = encryptServiceAuth(svc, config.masterKey);
        insertService.run(name, JSON.stringify(encrypted));
      }

      // Clear and re-insert capabilities
      db.prepare('DELETE FROM capabilities').run();
      const insertCap = db.prepare('INSERT INTO capabilities (name, config) VALUES (?, ?)');
      for (const [name, cap] of Object.entries(config.capabilities)) {
        insertCap.run(name, JSON.stringify(cap));
      }
    });

    save();
  } finally {
    db.close();
  }
}

/** @deprecated Use saveConfig() */
export const saveYAMLConfig = saveConfig;

/**
 * Initialize a fresh config store.
 */
export function initConfig(): JaneeConfig {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
  }

  // Check if DB already exists with data
  if (fs.existsSync(getDbPath())) {
    const db = openDb();
    try {
      ensureSchema(db);
      if (readMeta(db, 'master_key')) {
        throw new Error('Config already exists');
      }
    } finally {
      db.close();
    }
  }

  // Check for YAML to migrate
  if (fs.existsSync(getYamlPath())) {
    throw new Error('Config already exists (YAML). Run any command to trigger migration.');
  }

  const config: JaneeConfig = {
    version: '0.2.0',
    masterKey: generateMasterKey(),
    server: {
      port: 9119,
      host: 'localhost',
      strictDecryption: true,
    },
    services: {},
    capabilities: {},
  };

  saveConfig(config);
  return config;
}

/** @deprecated Use initConfig() */
export const initYAMLConfig = initConfig;

/**
 * Add a service
 */
export function addService(
  name: string,
  baseUrl: string,
  auth: AuthConfig
): void {
  const config = loadConfig();
  if (config.services[name]) {
    throw new Error(`Service "${name}" already exists`);
  }
  config.services[name] = {
    baseUrl,
    auth,
    ownership: cliCreatedOwnership(),
  };
  saveConfig(config);
}

/** @deprecated Use addService() */
export const addServiceYAML = addService;

/**
 * Add a capability
 */
export function addCapability(
  name: string,
  capConfig: CapabilityConfig
): void {
  const config = loadConfig();
  if (config.capabilities[name]) {
    throw new Error(`Capability "${name}" already exists`);
  }
  config.capabilities[name] = capConfig;
  saveConfig(config);
}

/** @deprecated Use addCapabilityYAML() */
export const addCapabilityYAML = addCapability;

/**
 * Persist service ownership
 */
export function persistServiceOwnership(serviceName: string, ownership: CredentialOwnership): void {
  const config = loadConfig();
  if (!config.services[serviceName]) {
    throw new Error(`Service "${serviceName}" not found in config`);
  }
  config.services[serviceName].ownership = ownership;
  saveConfig(config);
}

/**
 * Auto-assign ownership when a service is created via MCP.
 */
export function createServiceWithOwnership(
  config: JaneeConfig,
  serviceName: string,
  service: ServiceConfig,
  creatingAgentId?: string
): JaneeConfig {
  if (creatingAgentId) {
    service.ownership = agentCreatedOwnership(creatingAgentId);
  }
  config.services[serviceName] = service;
  return config;
}

/**
 * Migrate from JSON config to SQLite (if an old JSON config exists).
 * This handles the legacy JSON format that predated YAML.
 */
export function migrateToSQLite(): void {
  const db = openDb();
  try {
    ensureSchema(db);
    migrateFromYAML(db);
  } finally {
    db.close();
  }
}

/** @deprecated Use migrateToSQLite() */
export const migrateToYAML = migrateToSQLite;

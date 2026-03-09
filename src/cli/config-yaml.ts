/**
 * YAML configuration for Janee
 *
 * Config is split across two files:
 *   config.yaml        — human-readable policy (services metadata, capabilities, server settings)
 *   credentials.json   — encrypted secrets + master key (never hand-edited)
 *
 * Old v0.2.0 configs with inline masterKey + encrypted blobs are auto-migrated on first load.
 */

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

export interface AuthConfig {
  type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account' | 'github-app' | 'oauth1a-twitter';
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
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
}

export interface ServiceConfig {
  baseUrl: string;
  auth: AuthConfig;
  /** Auth-required GET path used by `janee test` to verify credentials (e.g. "/v1/balance") */
  testPath?: string;
  /** Ownership metadata for agent-scoped credential access control */
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

export interface JaneeYAMLConfig {
  version: string;
  masterKey: string;
  server: ServerConfig;
  llm?: LLMConfig;
  services: Record<string, ServiceConfig>;
  capabilities: Record<string, CapabilityConfig>;
}

/** Shape of secrets stored per service in credentials.json */
type ServiceSecrets = Record<string, string | Record<string, string>>;

interface CredentialsFile {
  masterKey: string;
  secrets: Record<string, ServiceSecrets>;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function getConfigDir(): string {
  return process.env.JANEE_HOME || path.join(os.homedir(), '.janee');
}

function getConfigFileYAML(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

function getCredentialsFile(): string {
  return path.join(getConfigDir(), 'credentials.json');
}

function getConfigFileJSON(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function getAuditDir(): string {
  return path.join(getConfigDir(), 'logs');
}

export function hasYAMLConfig(): boolean {
  return fs.existsSync(getConfigFileYAML());
}

// ---------------------------------------------------------------------------
// Credentials file I/O (atomic writes)
// ---------------------------------------------------------------------------

function loadCredentials(): CredentialsFile {
  const credPath = getCredentialsFile();
  if (!fs.existsSync(credPath)) {
    throw new Error('No credentials file found. Run `janee init` to create one.');
  }
  return JSON.parse(fs.readFileSync(credPath, 'utf8'));
}

function saveCredentials(creds: CredentialsFile): void {
  const credPath = getCredentialsFile();
  const tmpPath = credPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(creds, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, credPath);
}

// ---------------------------------------------------------------------------
// Secret extraction / injection
//
// These functions move secret fields between ServiceConfig.auth and the
// credentials.json secrets map, so the YAML file stays human-readable.
// ---------------------------------------------------------------------------

/** Extract secret fields from a service's auth config, returning them separately. */
function extractSecrets(auth: AuthConfig): ServiceSecrets {
  const secrets: ServiceSecrets = {};
  if (auth.type === 'bearer' && auth.key) {
    secrets.key = auth.key;
  } else if (auth.type === 'hmac-mexc' || auth.type === 'hmac-bybit' || auth.type === 'hmac-okx') {
    if (auth.apiKey) secrets.apiKey = auth.apiKey;
    if (auth.apiSecret) secrets.apiSecret = auth.apiSecret;
    if (auth.passphrase) secrets.passphrase = auth.passphrase;
  } else if (auth.type === 'headers' && auth.headers) {
    secrets.headers = { ...auth.headers };
  } else if (auth.type === 'service-account' && auth.credentials) {
    secrets.credentials = auth.credentials;
  } else if (auth.type === 'github-app' && auth.privateKey) {
    secrets.privateKey = auth.privateKey;
  } else if (auth.type === 'oauth1a-twitter') {
    if (auth.consumerKey) secrets.consumerKey = auth.consumerKey;
    if (auth.consumerSecret) secrets.consumerSecret = auth.consumerSecret;
    if (auth.accessToken) secrets.accessToken = auth.accessToken;
    if (auth.accessTokenSecret) secrets.accessTokenSecret = auth.accessTokenSecret;
  }
  return secrets;
}

/** Remove secret fields from an auth config (for writing clean YAML). */
function stripSecrets(auth: AuthConfig): AuthConfig {
  const clean = { ...auth };
  delete clean.key;
  delete clean.apiKey;
  delete clean.apiSecret;
  delete clean.passphrase;
  delete clean.privateKey;
  delete clean.credentials;
  delete clean.headers;
  delete clean.consumerKey;
  delete clean.consumerSecret;
  delete clean.accessToken;
  delete clean.accessTokenSecret;
  return clean;
}

/** Merge secrets back into a service's auth config. */
function injectSecrets(auth: AuthConfig, secrets: ServiceSecrets): void {
  if (auth.type === 'bearer' && typeof secrets.key === 'string') {
    auth.key = secrets.key;
  } else if (auth.type === 'hmac-mexc' || auth.type === 'hmac-bybit' || auth.type === 'hmac-okx') {
    if (typeof secrets.apiKey === 'string') auth.apiKey = secrets.apiKey;
    if (typeof secrets.apiSecret === 'string') auth.apiSecret = secrets.apiSecret;
    if (typeof secrets.passphrase === 'string') auth.passphrase = secrets.passphrase;
  } else if (auth.type === 'headers' && typeof secrets.headers === 'object') {
    auth.headers = secrets.headers as Record<string, string>;
  } else if (auth.type === 'service-account' && typeof secrets.credentials === 'string') {
    auth.credentials = secrets.credentials;
  } else if (auth.type === 'github-app' && typeof secrets.privateKey === 'string') {
    auth.privateKey = secrets.privateKey;
  } else if (auth.type === 'oauth1a-twitter') {
    if (typeof secrets.consumerKey === 'string') auth.consumerKey = secrets.consumerKey;
    if (typeof secrets.consumerSecret === 'string') auth.consumerSecret = secrets.consumerSecret;
    if (typeof secrets.accessToken === 'string') auth.accessToken = secrets.accessToken;
    if (typeof secrets.accessTokenSecret === 'string') auth.accessTokenSecret = secrets.accessTokenSecret;
  }
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt helpers
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
        `To allow plaintext values (not recommended), set server.strictDecryption: false in config.yaml`
      );
    }
    return encrypted;
  }
}

function decryptServiceSecrets(
  name: string,
  secrets: ServiceSecrets,
  masterKey: string,
  strict: boolean
): ServiceSecrets {
  const decrypted: ServiceSecrets = {};
  for (const [field, value] of Object.entries(secrets)) {
    if (field === 'headers' && typeof value === 'object') {
      const hdrs: Record<string, string> = {};
      for (const [hdr, enc] of Object.entries(value)) {
        hdrs[hdr] = tryDecrypt(enc, masterKey, strict, `header "${hdr}" for service "${name}"`);
      }
      decrypted.headers = hdrs;
    } else if (typeof value === 'string') {
      decrypted[field] = tryDecrypt(value, masterKey, strict, `${field} for service "${name}"`);
    }
  }
  return decrypted;
}

function encryptServiceSecrets(secrets: ServiceSecrets, masterKey: string): ServiceSecrets {
  const encrypted: ServiceSecrets = {};
  for (const [field, value] of Object.entries(secrets)) {
    if (field === 'headers' && typeof value === 'object') {
      const hdrs: Record<string, string> = {};
      for (const [hdr, plain] of Object.entries(value)) {
        hdrs[hdr] = encryptSecret(plain, masterKey);
      }
      encrypted.headers = hdrs;
    } else if (typeof value === 'string') {
      encrypted[field] = encryptSecret(value, masterKey);
    }
  }
  return encrypted;
}

// ---------------------------------------------------------------------------
// Migration: v0.2.0 (inline secrets) → v0.3.0 (split credentials.json)
// ---------------------------------------------------------------------------

function isLegacyFormat(rawConfig: any): boolean {
  return typeof rawConfig.masterKey === 'string' && rawConfig.masterKey.length > 0;
}

function migrateLegacyConfig(): void {
  const yamlPath = getConfigFileYAML();
  const content = fs.readFileSync(yamlPath, 'utf8');
  const raw = yaml.load(content) as any;

  if (!isLegacyFormat(raw)) return;

  const masterKey: string = raw.masterKey;
  const services: Record<string, any> = raw.services || {};

  // Build credentials file from inline encrypted values
  const creds: CredentialsFile = { masterKey, secrets: {} };
  for (const [name, svc] of Object.entries(services)) {
    const auth = (svc as any).auth;
    if (!auth) continue;
    const secrets = extractSecrets(auth as AuthConfig);
    if (Object.keys(secrets).length > 0) {
      creds.secrets[name] = secrets;
    }
  }

  // Write credentials.json atomically
  saveCredentials(creds);

  // Rewrite config.yaml without masterKey and without secret fields
  delete raw.masterKey;
  raw.version = '0.3.0';
  for (const [name, svc] of Object.entries(services)) {
    const auth = (svc as any).auth;
    if (!auth) continue;
    (svc as any).auth = stripSecrets(auth as AuthConfig);
  }

  const cleanYaml = yaml.dump(raw, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(yamlPath, cleanYaml, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load config from disk. Automatically migrates v0.2.0 legacy format on first load.
 * Returns the full config with secrets decrypted in memory.
 */
export function loadYAMLConfig(): JaneeYAMLConfig {
  if (!fs.existsSync(getConfigFileYAML())) {
    throw new Error('No YAML config found. Run migration or init.');
  }

  // Auto-migrate legacy inline-secrets format
  const rawContent = fs.readFileSync(getConfigFileYAML(), 'utf8');
  const rawConfig = yaml.load(rawContent) as any;
  if (isLegacyFormat(rawConfig)) {
    migrateLegacyConfig();
  }

  // Read the (possibly freshly migrated) YAML
  const content = fs.readFileSync(getConfigFileYAML(), 'utf8');
  const config = yaml.load(content) as JaneeYAMLConfig;
  config.services = config.services || {};
  config.capabilities = config.capabilities || {};

  // Load credentials
  const creds = loadCredentials();
  config.masterKey = creds.masterKey;

  const strictDecryption = config.server?.strictDecryption ?? true;

  // Decrypt and inject secrets into each service
  for (const [name, svc] of Object.entries(config.services)) {
    const encSecrets = creds.secrets[name];
    if (encSecrets) {
      const decSecrets = decryptServiceSecrets(name, encSecrets, creds.masterKey, strictDecryption);
      injectSecrets(svc.auth, decSecrets);
    }
  }

  return config;
}

/**
 * Save config to disk. Send SIGHUP to a running Janee process to reload.
 *
 * Splits the config: secrets go to credentials.json (encrypted, atomic write),
 * everything else goes to config.yaml (human-readable).
 */
export function saveYAMLConfig(config: JaneeYAMLConfig): void {
  const configCopy: any = JSON.parse(JSON.stringify(config));

  // Build credentials from the decrypted in-memory config
  const creds: CredentialsFile = { masterKey: config.masterKey, secrets: {} };

  for (const [name, service] of Object.entries(configCopy.services as Record<string, ServiceConfig>)) {
    const plainSecrets = extractSecrets(service.auth);
    if (Object.keys(plainSecrets).length > 0) {
      creds.secrets[name] = encryptServiceSecrets(plainSecrets, config.masterKey);
    }
    // Strip secrets from YAML copy
    configCopy.services[name].auth = stripSecrets(service.auth);
  }

  // Remove masterKey from YAML (lives in credentials.json now)
  delete configCopy.masterKey;
  configCopy.version = '0.3.0';

  // Write credentials atomically, then YAML
  saveCredentials(creds);

  const yamlContent = yaml.dump(configCopy, { indent: 2, lineWidth: 120 });
  fs.writeFileSync(getConfigFileYAML(), yamlContent, { mode: 0o600 });
}

/**
 * Persist a single service's ownership metadata to the YAML config file.
 * Called after grant/revoke operations to ensure changes survive restarts.
 */
export function persistServiceOwnership(serviceName: string, ownership: CredentialOwnership): void {
  const config = loadYAMLConfig();
  if (!config.services[serviceName]) {
    throw new Error(`Service "${serviceName}" not found in config`);
  }
  config.services[serviceName].ownership = ownership;
  saveYAMLConfig(config);
}

/**
 * Auto-assign ownership when a service is created via MCP (agent-initiated).
 * This ensures agent-created credentials default to "agent-only" access.
 */
export function createServiceWithOwnership(
  config: JaneeYAMLConfig,
  serviceName: string,
  service: ServiceConfig,
  creatingAgentId?: string
): JaneeYAMLConfig {
  if (creatingAgentId) {
    service.ownership = agentCreatedOwnership(creatingAgentId);
  }
  config.services[serviceName] = service;
  return config;
}

/**
 * Initialize new YAML config
 */
export function initYAMLConfig(): JaneeYAMLConfig {
  if (!fs.existsSync(getConfigDir())) {
    fs.mkdirSync(getConfigDir(), { mode: 0o700, recursive: true });
  }

  if (fs.existsSync(getConfigFileYAML())) {
    throw new Error('Config already exists');
  }

  const config: JaneeYAMLConfig = {
    version: '0.3.0',
    masterKey: generateMasterKey(),
    server: {
      port: 9119,
      host: 'localhost',
      strictDecryption: true,
    },
    services: {},
    capabilities: {},
  };

  saveYAMLConfig(config);
  return config;
}

/**
 * Add a service to config
 */
export function addServiceYAML(
  name: string,
  baseUrl: string,
  auth: AuthConfig
): void {
  const config = loadYAMLConfig();

  if (config.services[name]) {
    throw new Error(`Service "${name}" already exists`);
  }

  config.services[name] = {
    baseUrl,
    auth,
    ownership: cliCreatedOwnership()
  };

  saveYAMLConfig(config);
}

/**
 * Add a capability to config
 */
export function addCapabilityYAML(
  name: string,
  capConfig: CapabilityConfig
): void {
  const config = loadYAMLConfig();

  if (config.capabilities[name]) {
    throw new Error(`Capability "${name}" already exists`);
  }

  if (!config.services[capConfig.service]) {
    throw new Error(`Service "${capConfig.service}" not found`);
  }

  config.capabilities[name] = capConfig;
  saveYAMLConfig(config);
}

/**
 * Migrate from JSON to YAML config
 */
export function migrateToYAML(): void {
  if (!fs.existsSync(getConfigFileJSON())) {
    throw new Error('No JSON config to migrate');
  }

  if (fs.existsSync(getConfigFileYAML())) {
    throw new Error('YAML config already exists');
  }

  // Load old JSON config
  const oldConfig = JSON.parse(fs.readFileSync(getConfigFileJSON(), 'utf8'));

  // Create new YAML config
  const newConfig: JaneeYAMLConfig = {
    version: '0.2.0',
    masterKey: oldConfig.masterKey,
    server: {
      port: oldConfig.settings?.port || 9119,
      host: 'localhost'
    },
    services: {},
    capabilities: {}
  };

  // Migrate services
  if (oldConfig.services) {
    for (const service of oldConfig.services) {
      newConfig.services[service.name] = {
        baseUrl: service.baseUrl,
        auth: {
          type: 'bearer',
          key: service.encryptedKey  // Already encrypted
        }
      };

      // Create default capability for each service
      newConfig.capabilities[service.name] = {
        service: service.name,
        ttl: '1h',
        autoApprove: true
      };
    }
  }

  // Save (will re-encrypt with YAML format)
  const yamlContent = yaml.dump(newConfig, {
    indent: 2,
    lineWidth: 120
  });

  fs.writeFileSync(getConfigFileYAML(), yamlContent, { mode: 0o600 });

  console.log('✅ Migrated to YAML config');
  console.log(`Old config backed up at: ${getConfigFileJSON()}.bak`);
  
  // Backup old config
  fs.renameSync(getConfigFileJSON(), `${getConfigFileJSON()}.bak`);
}

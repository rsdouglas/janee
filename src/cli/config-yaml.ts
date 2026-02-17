/**
 * YAML configuration for Janee (new format)
 * Supports capabilities + services model
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { encryptSecret, decryptSecret, generateMasterKey } from '../core/crypto';

export interface AuthConfig {
  type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account';
  key?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;  // For OKX
  headers?: Record<string, string>;
  credentials?: string;  // For service-account: encrypted JSON blob
  scopes?: string[];     // For service-account: OAuth scopes
}

export interface ServiceConfig {
  baseUrl: string;
  auth: AuthConfig;
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
  // Exec mode fields (RFC 0001)
  mode?: 'proxy' | 'exec';  // Default: 'proxy' (HTTP proxy mode)
  allowCommands?: string[];  // Whitelist of allowed executables
  env?: Record<string, string>;  // Env var mapping with {{credential}} placeholders
  workDir?: string;  // Working directory for command execution
  timeout?: number;  // Max execution time in ms (default: 30000)
}

export interface LLMConfig {
  provider?: 'openai' | 'anthropic';
  apiKey?: string;
  model?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  logBodies?: boolean;  // Log request bodies in audit trail (default: true)
  strictDecryption?: boolean;  // Fail hard on decryption errors (default: true)
}

export interface JaneeYAMLConfig {
  version: string;
  masterKey: string;
  server: ServerConfig;
  llm?: LLMConfig;
  services: Record<string, ServiceConfig>;
  capabilities: Record<string, CapabilityConfig>;
}

/**
 * Get config directory path (dynamically computed for testability)
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), '.janee');
}

/**
 * Get YAML config file path
 */
function getConfigFileYAML(): string {
  return path.join(getConfigDir(), 'config.yaml');
}

/**
 * Get JSON config file path
 */
function getConfigFileJSON(): string {
  return path.join(getConfigDir(), 'config.json');
}

/**
 * Get audit directory path
 */
export function getAuditDir(): string {
  return path.join(getConfigDir(), 'logs');
}

/**
 * Check if using YAML config
 */
export function hasYAMLConfig(): boolean {
  return fs.existsSync(getConfigFileYAML());
}

/**
 * Helper to decrypt a secret with strict/lenient mode
 */
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
    // Lenient mode: assume plaintext
    return encrypted;
  }
}

/**
 * Load YAML configuration
 */
export function loadYAMLConfig(): JaneeYAMLConfig {
  if (!fs.existsSync(getConfigFileYAML())) {
    throw new Error('No YAML config found. Run migration or init.');
  }

  const content = fs.readFileSync(getConfigFileYAML(), 'utf8');
  const config = yaml.load(content) as JaneeYAMLConfig;

  // Ensure services and capabilities are objects (YAML parses empty sections as null)
  config.services = config.services || {};
  config.capabilities = config.capabilities || {};

  // Strict decryption mode (default: true)
  const strictDecryption = config.server?.strictDecryption ?? true;

  // Decrypt service auth keys
  for (const [name, service] of Object.entries(config.services)) {
    const svc = service as ServiceConfig;
    
    if (svc.auth.type === 'bearer' && svc.auth.key) {
      svc.auth.key = tryDecrypt(
        svc.auth.key,
        config.masterKey,
        strictDecryption,
        `bearer token for service "${name}"`
      );
    } else if (svc.auth.type === 'hmac-mexc' || svc.auth.type === 'hmac-bybit' || svc.auth.type === 'hmac-okx') {
      if (svc.auth.apiKey) {
        svc.auth.apiKey = tryDecrypt(
          svc.auth.apiKey,
          config.masterKey,
          strictDecryption,
          `API key for service "${name}"`
        );
      }
      if (svc.auth.apiSecret) {
        svc.auth.apiSecret = tryDecrypt(
          svc.auth.apiSecret,
          config.masterKey,
          strictDecryption,
          `API secret for service "${name}"`
        );
      }
      if (svc.auth.passphrase) {
        svc.auth.passphrase = tryDecrypt(
          svc.auth.passphrase,
          config.masterKey,
          strictDecryption,
          `passphrase for service "${name}"`
        );
      }
    } else if (svc.auth.type === 'headers' && svc.auth.headers) {
      // Decrypt each header value
      for (const [headerName, headerValue] of Object.entries(svc.auth.headers)) {
        svc.auth.headers[headerName] = tryDecrypt(
          headerValue,
          config.masterKey,
          strictDecryption,
          `header "${headerName}" for service "${name}"`
        );
      }
    } else if (svc.auth.type === 'service-account' && svc.auth.credentials) {
      svc.auth.credentials = tryDecrypt(
        svc.auth.credentials,
        config.masterKey,
        strictDecryption,
        `service account credentials for service "${name}"`
      );
    }
  }

  return config;
}

/**
 * Save YAML configuration
 */
export function saveYAMLConfig(config: JaneeYAMLConfig): void {
  // Encrypt service auth keys before saving
  const configCopy = JSON.parse(JSON.stringify(config));

  for (const [name, service] of Object.entries(configCopy.services)) {
    const svc = service as ServiceConfig;
    if (svc.auth.type === 'bearer' && svc.auth.key) {
      svc.auth.key = encryptSecret(svc.auth.key, config.masterKey);
    } else if (svc.auth.type === 'hmac-mexc' || svc.auth.type === 'hmac-bybit' || svc.auth.type === 'hmac-okx') {
      if (svc.auth.apiKey) {
        svc.auth.apiKey = encryptSecret(svc.auth.apiKey, config.masterKey);
      }
      if (svc.auth.apiSecret) {
        svc.auth.apiSecret = encryptSecret(svc.auth.apiSecret, config.masterKey);
      }
      if (svc.auth.passphrase) {
        svc.auth.passphrase = encryptSecret(svc.auth.passphrase, config.masterKey);
      }
    } else if (svc.auth.type === 'headers' && svc.auth.headers) {
      // Encrypt each header value
      for (const headerName of Object.keys(svc.auth.headers)) {
        svc.auth.headers[headerName] = encryptSecret(svc.auth.headers[headerName], config.masterKey);
      }
    } else if (svc.auth.type === 'service-account' && svc.auth.credentials) {
      svc.auth.credentials = encryptSecret(svc.auth.credentials, config.masterKey);
    }
  }

  const yamlContent = yaml.dump(configCopy, {
    indent: 2,
    lineWidth: 120
  });

  fs.writeFileSync(getConfigFileYAML(), yamlContent, { mode: 0o600 });
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
    version: '0.2.0',
    masterKey: generateMasterKey(),
    server: {
      port: 9119,
      host: 'localhost',
      strictDecryption: true  // Fail hard on decryption errors (recommended)
    },
    services: {},
    capabilities: {}
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
    auth
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

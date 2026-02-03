/**
 * Configuration management for Janee CLI
 * Stores config in ~/.janee/
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { encryptSecret, decryptSecret, generateMasterKey } from '../core/crypto';

export interface Service {
  name: string;
  baseUrl: string;
  encryptedKey: string;
  description?: string;
  createdAt: string;
}

export interface JaneeConfig {
  version: string;
  masterKey: string;
  services: Service[];
  settings: {
    port: number;
    llmProvider?: 'openai' | 'anthropic';
    llmApiKey?: string;
    llmEnabled: boolean;
  };
}

const CONFIG_DIR = path.join(os.homedir(), '.janee');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const AUDIT_DIR = path.join(CONFIG_DIR, 'logs');

/**
 * Ensure config directory exists
 */
export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
  }
  
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { mode: 0o700, recursive: true });
  }
}

/**
 * Initialize a new Janee configuration
 */
export function initConfig(): JaneeConfig {
  ensureConfigDir();

  if (fs.existsSync(CONFIG_FILE)) {
    throw new Error('Config already exists. Use `janee add` to add services.');
  }

  const config: JaneeConfig = {
    version: '0.1.0',
    masterKey: generateMasterKey(),
    services: [],
    settings: {
      port: 9119,
      llmEnabled: false
    }
  };

  saveConfig(config);
  return config;
}

/**
 * Load existing configuration
 */
export function loadConfig(): JaneeConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error('No config found. Run `janee init` first.');
  }

  const data = fs.readFileSync(CONFIG_FILE, 'utf8');
  return JSON.parse(data) as JaneeConfig;
}

/**
 * Save configuration
 */
export function saveConfig(config: JaneeConfig): void {
  ensureConfigDir();
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(config, null, 2),
    { mode: 0o600 } // Only owner can read/write
  );
}

/**
 * Add a service to config
 */
export function addService(
  name: string,
  baseUrl: string,
  apiKey: string,
  description?: string
): void {
  const config = loadConfig();

  // Check if service already exists
  if (config.services.find(s => s.name === name)) {
    throw new Error(`Service "${name}" already exists`);
  }

  // Encrypt the API key
  const encryptedKey = encryptSecret(apiKey, config.masterKey);

  // Add service
  config.services.push({
    name,
    baseUrl,
    encryptedKey,
    description,
    createdAt: new Date().toISOString()
  });

  saveConfig(config);
}

/**
 * Get a service by name
 */
export function getService(name: string): Service | undefined {
  const config = loadConfig();
  return config.services.find(s => s.name === name);
}

/**
 * Get decrypted API key for a service
 */
export function getServiceKey(name: string): string {
  const config = loadConfig();
  const service = config.services.find(s => s.name === name);

  if (!service) {
    throw new Error(`Service "${name}" not found`);
  }

  return decryptSecret(service.encryptedKey, config.masterKey);
}

/**
 * List all services
 */
export function listServices(): Service[] {
  const config = loadConfig();
  return config.services;
}

/**
 * Remove a service
 */
export function removeService(name: string): void {
  const config = loadConfig();
  const index = config.services.findIndex(s => s.name === name);

  if (index === -1) {
    throw new Error(`Service "${name}" not found`);
  }

  config.services.splice(index, 1);
  saveConfig(config);
}

/**
 * Get config directory path
 */
export function getConfigDir(): string {
  return CONFIG_DIR;
}

/**
 * Get audit logs directory
 */
export function getAuditDir(): string {
  return AUDIT_DIR;
}

/**
 * Filesystem Secrets Provider
 * 
 * Wraps Janee's existing AES-256-GCM encrypted local storage.
 * This is the default provider -- backward compatible with existing configs.
 */

import fs from 'fs';
import path from 'path';
import { SecretsProvider, HealthCheckResult, ProviderConfig, SecretError, SecretErrorCode, validateSecretPath } from './types';
import { encryptSecret, decryptSecret } from '../core/crypto';

interface FilesystemConfig {
  /** Path to secrets storage directory (default: ~/.janee/credentials) */
  path?: string;
  /** Master encryption key (base64) */
  masterKey: string;
}

export class FilesystemProvider implements SecretsProvider {
  readonly name: string;
  readonly type = 'filesystem';
  
  private secretsDir: string;
  private masterKey: string;
  private initialized = false;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    const fsConfig = config.config as unknown as FilesystemConfig;
    
    if (!fsConfig.masterKey) {
      throw new SecretError(
        SecretErrorCode.CONFIG_ERROR,
        `FilesystemProvider "${config.name}": masterKey is required`,
        { provider: config.name }
      );
    }
    
    this.masterKey = fsConfig.masterKey;
    this.secretsDir = path.resolve(fsConfig.path || path.join(
      process.env.HOME || process.env.USERPROFILE || '/tmp',
      '.janee',
      'credentials'
    ));
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.secretsDir)) {
      fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    }
    this.initialized = true;
  }

  async getSecret(secretPath: string): Promise<string | null> {
    this.ensureInitialized();
    
    const filePath = this.resolvePath(secretPath);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      const encrypted = fs.readFileSync(filePath, 'utf8').trim();
      return decryptSecret(encrypted, this.masterKey);
    } catch (err) {
      throw new SecretError(
        SecretErrorCode.CRYPTO_ERROR,
        `FilesystemProvider "${this.name}": failed to decrypt "${secretPath}": ${(err as Error).message}`,
        { provider: this.name, secretPath, cause: err as Error }
      );
    }
  }

  async setSecret(secretPath: string, value: string): Promise<void> {
    this.ensureInitialized();
    
    const filePath = this.resolvePath(secretPath);
    const dir = path.dirname(filePath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    
    const encrypted = encryptSecret(value, this.masterKey);
    fs.writeFileSync(filePath, encrypted, { mode: 0o600 });
  }

  async deleteSecret(secretPath: string): Promise<void> {
    this.ensureInitialized();
    
    const filePath = this.resolvePath(secretPath);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    this.ensureInitialized();
    
    const searchDir = prefix 
      ? path.join(this.secretsDir, prefix)
      : this.secretsDir;
    
    if (!fs.existsSync(searchDir)) {
      return [];
    }
    
    return this.walkDir(searchDir).map(
      filePath => path.relative(this.secretsDir, filePath)
    );
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    
    try {
      // Check directory exists and is writable
      if (!fs.existsSync(this.secretsDir)) {
        return { healthy: false, error: `Directory not found: ${this.secretsDir}` };
      }
      
      fs.accessSync(this.secretsDir, fs.constants.R_OK | fs.constants.W_OK);
      
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { 
        healthy: false, 
        error: `Cannot access ${this.secretsDir}: ${(err as Error).message}`,
        latencyMs: Date.now() - start
      };
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new SecretError(
        SecretErrorCode.NOT_INITIALIZED,
        `FilesystemProvider "${this.name}": not initialized. Call initialize() first.`,
        { provider: this.name }
      );
    }
  }

  /**
   * Securely resolve a secret path to a filesystem path.
   * 
   * Security: Uses path.resolve + prefix check to guarantee the resolved
   * path is contained within secretsDir. Rejects absolute paths and
   * traversal attempts via validateSecretPath() and a post-resolution
   * containment check.
   */
  private resolvePath(secretPath: string): string {
    // Validate path structure (rejects .., absolute paths, etc.)
    validateSecretPath(secretPath);

    // Resolve to absolute path
    const resolved = path.resolve(this.secretsDir, secretPath);

    // Containment check: resolved path MUST be inside secretsDir
    const secretsDirWithSep = this.secretsDir.endsWith(path.sep)
      ? this.secretsDir
      : this.secretsDir + path.sep;
    
    if (!resolved.startsWith(secretsDirWithSep) && resolved !== this.secretsDir) {
      throw new SecretError(
        SecretErrorCode.INVALID_PATH,
        `Path "${secretPath}" resolves outside secrets directory`,
        { provider: this.name, secretPath }
      );
    }

    return resolved;
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
    
    return results;
  }
}

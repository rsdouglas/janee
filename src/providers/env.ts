/**
 * Environment Variable Secrets Provider
 * 
 * The simplest external provider: reads secrets from environment variables.
 * Useful for CI/CD, Docker, Kubernetes, and simple deployments.
 * 
 * Usage in config:
 *   key: env://STRIPE_API_KEY
 * 
 * This reads from process.env.STRIPE_API_KEY at runtime.
 */

import { SecretsProvider, HealthCheckResult, ProviderConfig, SecretError, SecretErrorCode } from './types';

interface EnvConfig {
  /** Optional prefix added to all lookups (e.g., "JANEE_" makes path "FOO" -> "JANEE_FOO") */
  prefix?: string;
  /** If true, throw on missing vars instead of returning null (default: false) */
  required?: boolean;
}

export class EnvProvider implements SecretsProvider {
  readonly name: string;
  readonly type = 'env';
  
  private prefix: string;
  private required: boolean;
  private initialized = false;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    const envConfig = config.config as unknown as EnvConfig;
    this.prefix = envConfig.prefix || '';
    this.required = envConfig.required || false;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async getSecret(varPath: string): Promise<string | null> {
    this.ensureInitialized();
    
    const envVar = this.prefix + varPath;
    const value = process.env[envVar];
    
    if (value === undefined) {
      if (this.required) {
        throw new SecretError(
          SecretErrorCode.NOT_FOUND,
          `EnvProvider "${this.name}": required environment variable "${envVar}" is not set`,
          { provider: this.name, secretPath: varPath }
        );
      }
      return null;
    }
    
    return value;
  }

  async listSecrets(prefix?: string): Promise<string[]> {
    this.ensureInitialized();
    
    const fullPrefix = this.prefix + (prefix || '');
    
    return Object.keys(process.env)
      .filter(key => key.startsWith(fullPrefix))
      .map(key => key.slice(this.prefix.length));
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    // Environment variables are always available
    return { healthy: true, latencyMs: 0 };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new SecretError(
        SecretErrorCode.NOT_INITIALIZED,
        `EnvProvider "${this.name}": not initialized. Call initialize() first.`,
        { provider: this.name }
      );
    }
  }
}

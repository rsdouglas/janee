/**
 * Provider Registry
 * 
 * Central registry for secrets provider factories.
 * Resolves provider URIs and manages provider lifecycle.
 */

import { SecretsProvider, ProviderConfig, ProviderFactory, SecretError, SecretErrorCode, parseProviderURI } from './types';
import { FilesystemProvider } from './filesystem';
import { EnvProvider } from './env';

/**
 * Registry of provider factories by type name.
 */
const factories = new Map<string, ProviderFactory>();

/**
 * Active provider instances by name.
 */
const instances = new Map<string, SecretsProvider>();

/**
 * Register a built-in provider factory.
 */
export function registerProviderType(type: string, factory: ProviderFactory): void {
  if (factories.has(type)) {
    throw new SecretError(
      SecretErrorCode.CONFIG_ERROR,
      `Provider type "${type}" is already registered`
    );
  }
  factories.set(type, factory);
}

/**
 * Create and register a provider instance from config.
 */
export async function createProvider(config: ProviderConfig): Promise<SecretsProvider> {
  const factory = factories.get(config.type);
  if (!factory) {
    const available = Array.from(factories.keys()).join(', ');
    throw new SecretError(
      SecretErrorCode.CONFIG_ERROR,
      `Unknown provider type "${config.type}". Available types: ${available}`,
      { provider: config.name }
    );
  }

  const provider = factory(config);
  await provider.initialize();
  instances.set(config.name, provider);
  return provider;
}

/**
 * Get a registered provider instance by name.
 */
export function getProvider(name: string): SecretsProvider | undefined {
  return instances.get(name);
}

/**
 * Resolve a secret value from a URI like "vault://path/to/secret"
 * or a plain path (uses the default provider).
 * 
 * @param uri - Provider URI or plain secret path
 * @param defaultProvider - Provider name to use when no scheme is specified
 */
export async function resolveSecret(
  uri: string, 
  defaultProvider: string = 'local'
): Promise<string | null> {
  const { provider: providerName, path } = parseProviderURI(uri);
  const name = providerName || defaultProvider;
  
  const provider = instances.get(name);
  if (!provider) {
    const available = Array.from(instances.keys()).join(', ');
    throw new SecretError(
      SecretErrorCode.CONFIG_ERROR,
      `Provider "${name}" not found. Registered providers: ${available}`,
      { provider: name, secretPath: path }
    );
  }
  
  return provider.getSecret(path);
}

/**
 * Run health checks on all registered providers.
 */
export async function healthCheckAll(): Promise<Map<string, { healthy: boolean; error?: string }>> {
  const results = new Map<string, { healthy: boolean; error?: string }>();
  
  for (const [name, provider] of instances) {
    try {
      results.set(name, await provider.healthCheck());
    } catch (err) {
      results.set(name, { healthy: false, error: (err as Error).message });
    }
  }
  
  return results;
}

/**
 * Dispose all provider instances and clear registries.
 */
export async function disposeAll(): Promise<void> {
  const errors: Error[] = [];
  
  for (const [name, provider] of instances) {
    try {
      await provider.dispose();
    } catch (err) {
      errors.push(err as Error);
    }
  }
  
  instances.clear();
  factories.clear();
  
  if (errors.length > 0) {
    throw new SecretError(
      SecretErrorCode.INTERNAL,
      `Failed to dispose ${errors.length} provider(s): ${errors.map(e => e.message).join('; ')}`
    );
  }
}

// Re-export parseProviderURI from types
export { parseProviderURI } from './types';

// Register built-in provider types
registerProviderType('filesystem', (config) => new FilesystemProvider(config));
registerProviderType('env', (config) => new EnvProvider(config));

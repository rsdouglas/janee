/**
 * Janee Secrets Provider System
 * 
 * Plugin architecture for multiple secrets backends.
 * See RFC 0005: docs/rfcs/0005-plugin-architecture.md
 * 
 * Built-in providers:
 *   - filesystem: AES-256-GCM encrypted local storage (default)
 *   - env: Environment variables
 * 
 * Usage:
 *   import { createProvider, resolveSecret } from './providers';
 *   
 *   await createProvider({ name: 'local', type: 'filesystem', config: { masterKey: '...' } });
 *   await createProvider({ name: 'ci', type: 'env', config: { prefix: 'JANEE_' } });
 *   
 *   const key = await resolveSecret('local://stripe/api-key');
 *   const token = await resolveSecret('ci://GITHUB_TOKEN');
 */

export {
  createProvider,
  getProvider,
  resolveSecret,
  healthCheckAll,
  disposeAll,
  registerProviderType,
  parseProviderURI,
} from './registry';

export type {
  SecretsProvider,
  ProviderConfig,
  ProviderFactory,
  HealthCheckResult,
} from './types';

export {
  SecretError,
  SecretErrorCode,
  validateSecretPath,
} from './types';

export { FilesystemProvider } from './filesystem';
export { EnvProvider } from './env';

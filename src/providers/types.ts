/**
 * Secrets Provider Plugin Interface
 * 
 * Defines the contract all secrets providers must implement.
 * See RFC 0005 for full design: docs/rfcs/0005-plugin-architecture.md
 */

// --- Error Taxonomy --------------------------------------

/**
 * Error codes for categorizing secrets operation failures.
 * Enables callers to handle errors programmatically without message matching.
 */
export enum SecretErrorCode {
  /** Provider is not initialized (call initialize() first) */
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  /** Secret was not found (normal -- not an error for most callers) */
  NOT_FOUND = 'NOT_FOUND',
  /** Authentication failure (bad credentials, expired token) */
  AUTH_FAILED = 'AUTH_FAILED',
  /** Permission denied (authenticated but not authorized) */
  ACCESS_DENIED = 'ACCESS_DENIED',
  /** Provider unreachable (network error, timeout) */
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  /** Secret path is invalid (traversal attempt, bad characters) */
  INVALID_PATH = 'INVALID_PATH',
  /** URI format is invalid */
  INVALID_URI = 'INVALID_URI',
  /** Encryption/decryption failure */
  CRYPTO_ERROR = 'CRYPTO_ERROR',
  /** Provider-specific configuration error */
  CONFIG_ERROR = 'CONFIG_ERROR',
  /** Generic internal error */
  INTERNAL = 'INTERNAL',
}

/**
 * Typed error for secrets operations.
 * Enables programmatic error handling without message parsing.
 */
export class SecretError extends Error {
  readonly code: SecretErrorCode;
  readonly provider?: string;
  readonly secretPath?: string;

  constructor(
    code: SecretErrorCode,
    message: string,
    options?: { provider?: string; secretPath?: string; cause?: Error }
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'SecretError';
    this.code = code;
    this.provider = options?.provider;
    this.secretPath = options?.secretPath;
  }
}

// --- Core Interface --------------------------------------

/**
 * Core interface that all secrets providers must implement.
 */
export interface SecretsProvider {
  /** Human-readable provider name (e.g., "my-vault") */
  readonly name: string;
  
  /** Provider type identifier (e.g., "hashicorp-vault", "aws-secrets-manager") */
  readonly type: string;

  /**
   * Initialize the provider (connect, authenticate, validate config).
   * Called once before any secret operations.
   * @throws SecretError if provider cannot be initialized
   */
  initialize(): Promise<void>;

  /**
   * Retrieve a secret by path.
   * @param path - Provider-specific path (e.g., "mcp/agents/stripe/api-key")
   * @returns The secret value, or null if not found
   * @throws SecretError on connection/auth errors (NOT on missing secrets)
   */
  getSecret(path: string): Promise<string | null>;

  /**
   * Store a secret. Optional -- not all providers support writes.
   * @param path - Provider-specific path
   * @param value - Secret value to store
   */
  setSecret?(path: string, value: string): Promise<void>;

  /**
   * Delete a secret. Optional.
   */
  deleteSecret?(path: string): Promise<void>;

  /**
   * List available secret paths. Optional -- useful for CLI tooling.
   */
  listSecrets?(prefix?: string): Promise<string[]>;

  /**
   * Clean up resources (close connections, etc.).
   */
  dispose(): Promise<void>;

  /**
   * Health check -- is the provider accessible and authenticated?
   */
  healthCheck(): Promise<HealthCheckResult>;
}

export interface HealthCheckResult {
  healthy: boolean;
  error?: string;
  /** Optional latency in milliseconds */
  latencyMs?: number;
}

/**
 * Configuration for a provider instance.
 * The `config` field is provider-type-specific.
 */
export interface ProviderConfig {
  /** Instance name (referenced in service configs) */
  name: string;
  /** Provider type (determines which class to instantiate) */
  type: string;
  /** Type-specific configuration */
  config: Record<string, unknown>;
}

/**
 * Factory function type for creating provider instances.
 */
export type ProviderFactory = (config: ProviderConfig) => SecretsProvider;

// --- URI Parsing -----------------------------------------

/** Maximum length of a provider name */
const MAX_PROVIDER_NAME_LENGTH = 64;
/** Maximum length of a secret path */
const MAX_SECRET_PATH_LENGTH = 1024;
/** Valid provider name: lowercase alphanumeric, hyphens, underscores, 1-64 chars */
const PROVIDER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

/**
 * Parse a provider URI like "vault://mcp/stripe/api-key"
 * Returns { provider: "vault", path: "mcp/stripe/api-key" }
 * If no scheme, returns { provider: null, path: original }
 * 
 * Enforces:
 *   - Provider names normalized to lowercase, 1-64 chars
 *   - Percent-decoding of path components
 *   - Rejection of ".." path segments (traversal prevention)
 *   - Max path length of 1024 characters
 * 
 * @throws SecretError with INVALID_URI code on validation failure
 */
export function parseProviderURI(uri: string): { provider: string | null; path: string } {
  if (!uri || typeof uri !== 'string') {
    throw new SecretError(SecretErrorCode.INVALID_URI, 'URI must be a non-empty string');
  }

  const match = uri.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\/\/(.+)$/);
  if (!match) {
    // Plain path -- validate and return
    validateSecretPath(uri);
    return { provider: null, path: uri };
  }

  const rawProvider = match[1];
  const rawPath = match[2];

  // Normalize provider name to lowercase
  const provider = rawProvider.toLowerCase();

  // Validate provider name length
  if (provider.length > MAX_PROVIDER_NAME_LENGTH) {
    throw new SecretError(
      SecretErrorCode.INVALID_URI,
      `Provider name exceeds maximum length of ${MAX_PROVIDER_NAME_LENGTH} characters: "${provider}"`
    );
  }

  // Validate provider name format
  if (!PROVIDER_NAME_PATTERN.test(provider)) {
    throw new SecretError(
      SecretErrorCode.INVALID_URI,
      `Invalid provider name "${provider}": must be lowercase alphanumeric with hyphens/underscores, starting with a letter`
    );
  }

  // Percent-decode the path
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new SecretError(
      SecretErrorCode.INVALID_URI,
      `Invalid percent-encoding in URI path: "${rawPath}"`
    );
  }

  validateSecretPath(decodedPath);

  return { provider, path: decodedPath };
}

/**
 * Validate a secret path for safety.
 * Rejects traversal attempts, overly long paths, and empty paths.
 * 
 * @throws SecretError with INVALID_PATH code on validation failure
 */
export function validateSecretPath(secretPath: string): void {
  if (!secretPath || secretPath.length === 0) {
    throw new SecretError(SecretErrorCode.INVALID_PATH, 'Secret path must not be empty');
  }

  if (secretPath.length > MAX_SECRET_PATH_LENGTH) {
    throw new SecretError(
      SecretErrorCode.INVALID_PATH,
      `Secret path exceeds maximum length of ${MAX_SECRET_PATH_LENGTH} characters`
    );
  }

  // Reject absolute paths
  if (secretPath.startsWith('/') || /^[A-Za-z]:/.test(secretPath)) {
    throw new SecretError(
      SecretErrorCode.INVALID_PATH,
      `Secret path must be relative, got: "${secretPath}"`
    );
  }

  // Reject ".." segments (path traversal)
  const segments = secretPath.split(/[/\\]/);
  for (const segment of segments) {
    if (segment === '..') {
      throw new SecretError(
        SecretErrorCode.INVALID_PATH,
        `Secret path must not contain ".." segments: "${secretPath}"`
      );
    }
  }
}

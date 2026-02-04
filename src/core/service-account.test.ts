/**
 * Tests for Google Service Account Authentication
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateServiceAccountCredentials,
  createServiceAccountJWT,
  getAccessToken,
  clearCachedToken,
  ServiceAccountCredentials,
  exchangeJWTForToken
} from './service-account';
import jwt from 'jsonwebtoken';

describe('validateServiceAccountCredentials', () => {
  it('should accept valid credentials', () => {
    const valid = {
      type: 'service_account',
      project_id: 'test-project',
      private_key_id: 'key123',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      client_email: 'test@test-project.iam.gserviceaccount.com',
      client_id: '123456',
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    const result = validateServiceAccountCredentials(valid);
    expect(result).toEqual(valid);
  });

  it('should reject null/undefined', () => {
    expect(() => validateServiceAccountCredentials(null as any))
      .toThrow('Invalid credentials: must be an object');
    
    expect(() => validateServiceAccountCredentials(undefined as any))
      .toThrow('Invalid credentials: must be an object');
  });

  it('should reject non-object', () => {
    expect(() => validateServiceAccountCredentials('string' as any))
      .toThrow('Invalid credentials: must be an object');
    
    expect(() => validateServiceAccountCredentials(123 as any))
      .toThrow('Invalid credentials: must be an object');
  });

  it('should reject missing private_key', () => {
    const missing = {
      client_email: 'test@test.com',
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    expect(() => validateServiceAccountCredentials(missing))
      .toThrow('Invalid credentials: missing or invalid private_key');
  });

  it('should reject invalid private_key type', () => {
    const invalid = {
      private_key: 123,
      client_email: 'test@test.com',
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    expect(() => validateServiceAccountCredentials(invalid))
      .toThrow('Invalid credentials: missing or invalid private_key');
  });

  it('should reject missing client_email', () => {
    const missing = {
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    expect(() => validateServiceAccountCredentials(missing))
      .toThrow('Invalid credentials: missing or invalid client_email');
  });

  it('should reject invalid client_email type', () => {
    const invalid = {
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      client_email: 123,
      token_uri: 'https://oauth2.googleapis.com/token'
    };

    expect(() => validateServiceAccountCredentials(invalid))
      .toThrow('Invalid credentials: missing or invalid client_email');
  });

  it('should reject missing token_uri', () => {
    const missing = {
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      client_email: 'test@test.com'
    };

    expect(() => validateServiceAccountCredentials(missing))
      .toThrow('Invalid credentials: missing or invalid token_uri');
  });

  it('should reject invalid token_uri type', () => {
    const invalid = {
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
      client_email: 'test@test.com',
      token_uri: 123
    };

    expect(() => validateServiceAccountCredentials(invalid))
      .toThrow('Invalid credentials: missing or invalid token_uri');
  });
});

describe('createServiceAccountJWT', () => {
  // Generate a test RSA key pair for JWT signing
  const crypto = require('crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const testCredentials: ServiceAccountCredentials = {
    type: 'service_account',
    private_key: privateKey,
    client_email: 'test@test-project.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  };

  it('should create a valid JWT with correct structure', () => {
    const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
    const token = createServiceAccountJWT(testCredentials, scopes);

    // Decode without verification (we just want to check structure)
    const decoded = jwt.decode(token) as any;

    expect(decoded).toBeTruthy();
    expect(decoded.iss).toBe(testCredentials.client_email);
    expect(decoded.scope).toBe(scopes.join(' '));
    expect(decoded.aud).toBe(testCredentials.token_uri);
    expect(decoded.iat).toBeTypeOf('number');
    expect(decoded.exp).toBeTypeOf('number');
  });

  it('should set expiration to 1 hour from iat', () => {
    const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
    const token = createServiceAccountJWT(testCredentials, scopes);

    const decoded = jwt.decode(token) as any;
    expect(decoded.exp - decoded.iat).toBe(3600);
  });

  it('should join multiple scopes with space', () => {
    const scopes = [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/analytics'
    ];
    const token = createServiceAccountJWT(testCredentials, scopes);

    const decoded = jwt.decode(token) as any;
    expect(decoded.scope).toBe(scopes.join(' '));
  });

  it('should use RS256 algorithm', () => {
    const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
    const token = createServiceAccountJWT(testCredentials, scopes);

    // Decode header to check algorithm
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.alg).toBe('RS256');
  });

  it('should create token with iat close to current time', () => {
    const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
    const beforeCreation = Math.floor(Date.now() / 1000);
    const token = createServiceAccountJWT(testCredentials, scopes);
    const afterCreation = Math.floor(Date.now() / 1000);

    const decoded = jwt.decode(token) as any;
    expect(decoded.iat).toBeGreaterThanOrEqual(beforeCreation);
    expect(decoded.iat).toBeLessThanOrEqual(afterCreation);
  });
});

describe('exchangeJWTForToken', () => {
  beforeEach(() => {
    // Mock global fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully exchange JWT for access token', async () => {
    const mockResponse = {
      access_token: 'ya29.test_access_token',
      expires_in: 3600,
      token_type: 'Bearer'
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockResponse
    });

    const result = await exchangeJWTForToken(
      'test.jwt.token',
      'https://oauth2.googleapis.com/token'
    );

    expect(result.access_token).toBe('ya29.test_access_token');
    expect(result.token_type).toBe('Bearer');
    expect(result.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    
    // Verify fetch was called correctly
    expect(global.fetch).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
    );
  });

  it('should throw on HTTP error response', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Bad Request'
    });

    await expect(
      exchangeJWTForToken('test.jwt.token', 'https://oauth2.googleapis.com/token')
    ).rejects.toThrow('Token exchange failed: 400 Bad Request');
  });

  it('should throw if response missing access_token', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ expires_in: 3600 })
    });

    await expect(
      exchangeJWTForToken('test.jwt.token', 'https://oauth2.googleapis.com/token')
    ).rejects.toThrow('Invalid token response: missing access_token or expires_in');
  });

  it('should throw if response missing expires_in', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'test_token' })
    });

    await expect(
      exchangeJWTForToken('test.jwt.token', 'https://oauth2.googleapis.com/token')
    ).rejects.toThrow('Invalid token response: missing access_token or expires_in');
  });

  it('should default token_type to Bearer if not provided', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test_token',
        expires_in: 3600
      })
    });

    const result = await exchangeJWTForToken(
      'test.jwt.token',
      'https://oauth2.googleapis.com/token'
    );

    expect(result.token_type).toBe('Bearer');
  });
});

describe('getAccessToken - caching behavior', () => {
  const crypto = require('crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const testCredentials: ServiceAccountCredentials = {
    type: 'service_account',
    private_key: privateKey,
    client_email: 'test@test-project.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  };

  const testScopes = ['https://www.googleapis.com/auth/analytics.readonly'];

  beforeEach(() => {
    global.fetch = vi.fn();
    // Clear cache before each test
    clearCachedToken('test-service', testScopes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fetch new token when cache is empty', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    const token = await getAccessToken('test-service', testCredentials, testScopes);

    expect(token).toBe('new_token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should return cached token when >10 minutes remaining', async () => {
    // First call - populate cache
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'cached_token',
        expires_in: 3600, // 60 minutes
        token_type: 'Bearer'
      })
    });

    const token1 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token1).toBe('cached_token');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call - should use cache
    const token2 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token2).toBe('cached_token');
    expect(global.fetch).toHaveBeenCalledTimes(1); // No additional fetch
  });

  it('should fetch new token when <10 minutes remaining', async () => {
    // First call - token expiring soon
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'expiring_token',
        expires_in: 500, // 8.3 minutes - less than 10
        token_type: 'Bearer'
      })
    });

    const token1 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token1).toBe('expiring_token');

    // Second call - should refresh
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'refreshed_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    const token2 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token2).toBe('refreshed_token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should cache tokens per service + scopes combination', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    // Different service
    await getAccessToken('service-1', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await getAccessToken('service-2', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(2); // New service = new fetch

    // Different scopes
    await getAccessToken('service-1', testCredentials, ['scope1']);
    expect(global.fetch).toHaveBeenCalledTimes(3); // New scopes = new fetch

    // Same service + scopes
    await getAccessToken('service-1', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(3); // Uses cache
  });
});

describe('clearCachedToken', () => {
  const crypto = require('crypto');
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const testCredentials: ServiceAccountCredentials = {
    type: 'service_account',
    private_key: privateKey,
    client_email: 'test@test-project.iam.gserviceaccount.com',
    token_uri: 'https://oauth2.googleapis.com/token'
  };

  const testScopes = ['https://www.googleapis.com/auth/analytics.readonly'];

  beforeEach(() => {
    global.fetch = vi.fn();
    // Clear all cached tokens
    clearCachedToken('service-1', testScopes);
    clearCachedToken('service-2', testScopes);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should clear cached token and force refresh', async () => {
    // First call - populate cache
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'original_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    const token1 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token1).toBe('original_token');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Clear cache
    clearCachedToken('test-service', testScopes);

    // Next call should fetch new token
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'new_token_after_clear',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    const token2 = await getAccessToken('test-service', testCredentials, testScopes);
    expect(token2).toBe('new_token_after_clear');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('should not affect other cached tokens', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'test_token',
        expires_in: 3600,
        token_type: 'Bearer'
      })
    });

    // Cache tokens for two services
    await getAccessToken('service-1', testCredentials, testScopes);
    await getAccessToken('service-2', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Clear one
    clearCachedToken('service-1', testScopes);

    // Service-1 should fetch new, service-2 should use cache
    await getAccessToken('service-1', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(3);

    await getAccessToken('service-2', testCredentials, testScopes);
    expect(global.fetch).toHaveBeenCalledTimes(3); // Still cached
  });
});

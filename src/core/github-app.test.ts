import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateGitHubAppCredentials,
  createGitHubAppJWT,
  getInstallationToken,
  clearCachedInstallationToken,
  mintInstallationToken,
} from './github-app';
import jwt from 'jsonwebtoken';

const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const validCreds = {
  appId: '123456',
  privateKey,
  installationId: '789',
};

describe('validateGitHubAppCredentials', () => {
  it('should accept valid credentials', () => {
    const result = validateGitHubAppCredentials(validCreds);
    expect(result).toEqual(validCreds);
  });

  it('should reject null/undefined', () => {
    expect(() => validateGitHubAppCredentials(null)).toThrow('must be an object');
    expect(() => validateGitHubAppCredentials(undefined)).toThrow('must be an object');
  });

  it('should reject missing appId', () => {
    expect(() => validateGitHubAppCredentials({ privateKey: 'x', installationId: '1' }))
      .toThrow('missing or invalid appId');
  });

  it('should reject missing privateKey', () => {
    expect(() => validateGitHubAppCredentials({ appId: '1', installationId: '1' }))
      .toThrow('missing or invalid privateKey');
  });

  it('should reject missing installationId', () => {
    expect(() => validateGitHubAppCredentials({ appId: '1', privateKey: 'x' }))
      .toThrow('missing or invalid installationId');
  });
});

describe('createGitHubAppJWT', () => {
  it('should create a valid JWT with correct claims', () => {
    const token = createGitHubAppJWT(validCreds.appId, validCreds.privateKey);
    const decoded = jwt.decode(token) as any;

    expect(decoded).toBeTruthy();
    expect(decoded.iss).toBe(validCreds.appId);
    expect(decoded.iat).toBeTypeOf('number');
    expect(decoded.exp).toBeTypeOf('number');
  });

  it('should set iat 60s in the past and exp 10min in the future', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = createGitHubAppJWT(validCreds.appId, validCreds.privateKey);
    const decoded = jwt.decode(token) as any;

    expect(decoded.iat).toBeLessThanOrEqual(before);
    expect(decoded.exp - decoded.iat).toBe(11 * 60); // iat is -60s, exp is +10min
  });

  it('should use RS256 algorithm', () => {
    const token = createGitHubAppJWT(validCreds.appId, validCreds.privateKey);
    const header = jwt.decode(token, { complete: true })?.header;
    expect(header?.alg).toBe('RS256');
  });
});

describe('mintInstallationToken', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should exchange JWT for installation token', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ghs_test123',
        expires_at: '2026-02-19T12:00:00Z',
      }),
    });

    const result = await mintInstallationToken('jwt.token.here', '789');

    expect(result.token).toBe('ghs_test123');
    expect(result.expires_at).toBeTypeOf('number');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.github.com/app/installations/789/access_tokens',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should throw on HTTP error', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(mintInstallationToken('bad.jwt', '789'))
      .rejects.toThrow('GitHub token mint failed: 401');
  });

  it('should throw if response missing token', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ expires_at: '2026-02-19T12:00:00Z' }),
    });

    await expect(mintInstallationToken('jwt', '789'))
      .rejects.toThrow('missing token or expires_at');
  });
});

describe('getInstallationToken - caching', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    clearCachedInstallationToken('test-svc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockTokenResponse = (token: string) => ({
    ok: true,
    json: async () => ({
      token,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    }),
  });

  it('should fetch new token when cache is empty', async () => {
    (global.fetch as any).mockResolvedValue(mockTokenResponse('ghs_fresh'));

    const token = await getInstallationToken('test-svc', validCreds);
    expect(token).toBe('ghs_fresh');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should return cached token when >10min remaining', async () => {
    (global.fetch as any).mockResolvedValue(mockTokenResponse('ghs_cached'));

    await getInstallationToken('test-svc', validCreds);
    const token2 = await getInstallationToken('test-svc', validCreds);

    expect(token2).toBe('ghs_cached');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should refresh when <10min remaining', async () => {
    // First: token expiring soon
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        token: 'ghs_expiring',
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
      }),
    });

    await getInstallationToken('test-svc', validCreds);

    // Second: should re-fetch
    (global.fetch as any).mockResolvedValueOnce(mockTokenResponse('ghs_refreshed'));
    const token2 = await getInstallationToken('test-svc', validCreds);

    expect(token2).toBe('ghs_refreshed');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('clearCachedInstallationToken', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    clearCachedInstallationToken('test-svc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should force refresh after clearing cache', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ghs_original',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    });

    await getInstallationToken('test-svc', validCreds);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    clearCachedInstallationToken('test-svc');

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ghs_after_clear',
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      }),
    });

    const token = await getInstallationToken('test-svc', validCreds);
    expect(token).toBe('ghs_after_clear');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

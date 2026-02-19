/**
 * GitHub App Authentication
 *
 * Handles JWT-based authentication for GitHub Apps, minting short-lived
 * installation tokens that are cached and auto-refreshed.
 */

import jwt from 'jsonwebtoken';

export interface GitHubAppCredentials {
  appId: string;
  privateKey: string;
  installationId: string;
}

export interface InstallationToken {
  token: string;
  expires_at: number; // Unix timestamp in seconds
}

const tokenCache: Map<string, InstallationToken> = new Map();

export function validateGitHubAppCredentials(credentials: any): GitHubAppCredentials {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Invalid credentials: must be an object');
  }

  if (!credentials.appId || typeof credentials.appId !== 'string') {
    throw new Error('Invalid credentials: missing or invalid appId');
  }

  if (!credentials.privateKey || typeof credentials.privateKey !== 'string') {
    throw new Error('Invalid credentials: missing or invalid privateKey');
  }

  if (!credentials.installationId || typeof credentials.installationId !== 'string') {
    throw new Error('Invalid credentials: missing or invalid installationId');
  }

  return credentials as GitHubAppCredentials;
}

export function createGitHubAppJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 10 * 60,
      iss: appId,
    },
    privateKey,
    { algorithm: 'RS256' }
  );
}

/**
 * Exchange a GitHub App JWT for an installation access token.
 */
export async function mintInstallationToken(
  appJwt: string,
  installationId: string
): Promise<InstallationToken> {
  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${appJwt}`,
        'User-Agent': 'janee',
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub token mint failed: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as any;

  if (!data.token || !data.expires_at) {
    throw new Error('Invalid token response: missing token or expires_at');
  }

  return {
    token: data.token as string,
    expires_at: Math.floor(new Date(data.expires_at as string).getTime() / 1000),
  };
}

/**
 * Get a cached installation token or mint a fresh one.
 * Refreshes when <10 minutes remaining (tokens last 1 hour).
 */
export async function getInstallationToken(
  serviceName: string,
  credentials: GitHubAppCredentials
): Promise<string> {
  const cached = tokenCache.get(serviceName);
  if (cached) {
    const timeRemaining = cached.expires_at - Math.floor(Date.now() / 1000);
    if (timeRemaining > 600) {
      return cached.token;
    }
  }

  const appJwt = createGitHubAppJWT(credentials.appId, credentials.privateKey);
  const token = await mintInstallationToken(appJwt, credentials.installationId);
  tokenCache.set(serviceName, token);
  return token.token;
}

export function clearCachedInstallationToken(serviceName: string): void {
  tokenCache.delete(serviceName);
}

/**
 * Validate credentials by signing a JWT and listing installations.
 */
export async function testGitHubAppAuth(credentials: GitHubAppCredentials): Promise<void> {
  const appJwt = createGitHubAppJWT(credentials.appId, credentials.privateKey);

  const response = await fetch('https://api.github.com/app', {
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${appJwt}`,
      'User-Agent': 'janee',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub App auth test failed: ${response.status} ${errorText}`);
  }
}

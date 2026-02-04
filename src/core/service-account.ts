/**
 * Google Service Account Authentication
 * 
 * Handles JWT-based OAuth2 authentication for Google APIs using service account credentials.
 */

import jwt from 'jsonwebtoken';

export interface ServiceAccountCredentials {
  type: string;
  project_id?: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  auth_uri?: string;
  token_uri: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
}

export interface AccessToken {
  access_token: string;
  expires_at: number;  // Unix timestamp in seconds
  token_type: string;
}

// In-memory token cache
const tokenCache: Map<string, AccessToken> = new Map();

/**
 * Validate service account credentials
 */
export function validateServiceAccountCredentials(credentials: any): ServiceAccountCredentials {
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Invalid credentials: must be an object');
  }

  if (!credentials.private_key || typeof credentials.private_key !== 'string') {
    throw new Error('Invalid credentials: missing or invalid private_key');
  }

  if (!credentials.client_email || typeof credentials.client_email !== 'string') {
    throw new Error('Invalid credentials: missing or invalid client_email');
  }

  if (!credentials.token_uri || typeof credentials.token_uri !== 'string') {
    throw new Error('Invalid credentials: missing or invalid token_uri');
  }

  return credentials as ServiceAccountCredentials;
}

/**
 * Create a signed JWT for service account authentication
 */
export function createServiceAccountJWT(
  credentials: ServiceAccountCredentials,
  scopes: string[]
): string {
  const now = Math.floor(Date.now() / 1000);
  
  const payload = {
    iss: credentials.client_email,
    scope: scopes.join(' '),
    aud: credentials.token_uri,
    iat: now,
    exp: now + 3600  // 1 hour
  };

  return jwt.sign(payload, credentials.private_key, {
    algorithm: 'RS256'
  });
}

/**
 * Exchange JWT for access token
 */
export async function exchangeJWTForToken(
  jwt: string,
  tokenUri: string
): Promise<AccessToken> {
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as any;
  
  if (!data.access_token || !data.expires_in) {
    throw new Error('Invalid token response: missing access_token or expires_in');
  }

  return {
    access_token: data.access_token as string,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in as number),
    token_type: (data.token_type as string) || 'Bearer'
  };
}

/**
 * Get cached token or fetch a new one
 * 
 * @param serviceName - Service name (for cache key)
 * @param credentials - Service account credentials
 * @param scopes - OAuth scopes to request
 * @returns Access token
 */
export async function getAccessToken(
  serviceName: string,
  credentials: ServiceAccountCredentials,
  scopes: string[]
): Promise<string> {
  const cacheKey = `${serviceName}:${scopes.join(',')}`;
  
  // Check cache
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = cached.expires_at - now;
    
    // If more than 10 minutes remaining, use cached token
    if (timeRemaining > 600) {
      return cached.access_token;
    }
  }

  // Create JWT
  const signedJWT = createServiceAccountJWT(credentials, scopes);
  
  // Exchange for access token
  const token = await exchangeJWTForToken(signedJWT, credentials.token_uri);
  
  // Cache token
  tokenCache.set(cacheKey, token);
  
  return token.access_token;
}

/**
 * Clear cached token for a service (useful after 401)
 */
export function clearCachedToken(serviceName: string, scopes: string[]): void {
  const cacheKey = `${serviceName}:${scopes.join(',')}`;
  tokenCache.delete(cacheKey);
}

/**
 * Test service account authentication
 * 
 * Attempts to get an access token to validate credentials
 */
export async function testServiceAccountAuth(
  credentials: ServiceAccountCredentials,
  scopes: string[]
): Promise<void> {
  const signedJWT = createServiceAccountJWT(credentials, scopes);
  await exchangeJWTForToken(signedJWT, credentials.token_uri);
}

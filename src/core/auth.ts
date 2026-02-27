/**
 * Shared auth header injection for all Janee interfaces.
 * Extracted from serve-mcp.ts so CLI test, MCP tools, and REST endpoints
 * all build auth headers the same way.
 */

import { URL } from 'url';

import { ServiceConfig } from './mcp-server.js';
import { SigningResult } from './signing.js';

export interface AuthHeadersContext {
  method: string;
  targetUrl: URL;
  body?: string;
}

export interface AuthHeadersResult {
  headers: Record<string, string>;
  /** HMAC-MEXC appends signature params to the URL */
  urlParams?: Record<string, string>;
}

/**
 * Build auth headers for a service request.
 * Handles all auth types: bearer, headers, hmac-*, service-account, github-app.
 *
 * Async because service-account and github-app need to fetch tokens.
 */
export async function buildAuthHeaders(
  serviceName: string,
  serviceConfig: ServiceConfig,
  ctx: AuthHeadersContext
): Promise<AuthHeadersResult> {
  const headers: Record<string, string> = {};
  let urlParams: Record<string, string> | undefined;

  if (serviceConfig.auth.type === 'bearer' && serviceConfig.auth.key) {
    headers['Authorization'] = `Bearer ${serviceConfig.auth.key}`;

  } else if (serviceConfig.auth.type === 'headers' && serviceConfig.auth.headers) {
    Object.assign(headers, serviceConfig.auth.headers);

  } else if (serviceConfig.auth.type === 'hmac-mexc' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
    const { signMEXC } = await import('./signing.js');
    const result: SigningResult = signMEXC({
      apiKey: serviceConfig.auth.apiKey,
      apiSecret: serviceConfig.auth.apiSecret,
      queryString: ctx.targetUrl.searchParams.toString()
    });
    Object.assign(headers, result.headers);
    if (result.urlParams) urlParams = result.urlParams;

  } else if (serviceConfig.auth.type === 'hmac-bybit' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret) {
    const { signBybit } = await import('./signing.js');
    const result: SigningResult = signBybit({
      apiKey: serviceConfig.auth.apiKey,
      apiSecret: serviceConfig.auth.apiSecret,
      method: ctx.method,
      queryString: ctx.targetUrl.searchParams.toString(),
      body: ctx.body
    });
    Object.assign(headers, result.headers);

  } else if (serviceConfig.auth.type === 'hmac-okx' && serviceConfig.auth.apiKey && serviceConfig.auth.apiSecret && serviceConfig.auth.passphrase) {
    const { signOKX } = await import('./signing.js');
    const reqPath = ctx.targetUrl.pathname + (ctx.targetUrl.search || '');
    const result: SigningResult = signOKX({
      apiKey: serviceConfig.auth.apiKey,
      apiSecret: serviceConfig.auth.apiSecret,
      passphrase: serviceConfig.auth.passphrase,
      method: ctx.method,
      requestPath: reqPath,
      body: ctx.body
    });
    Object.assign(headers, result.headers);

  } else if (serviceConfig.auth.type === 'service-account' && serviceConfig.auth.credentials && serviceConfig.auth.scopes) {
    const { getAccessToken, validateServiceAccountCredentials, clearCachedToken } = await import('./service-account.js');
    type SAC = import('./service-account.js').ServiceAccountCredentials;
    try {
      const credentials = JSON.parse(serviceConfig.auth.credentials) as SAC;
      validateServiceAccountCredentials(credentials);
      const accessToken = await getAccessToken(serviceName, credentials, serviceConfig.auth.scopes!);
      headers['Authorization'] = `Bearer ${accessToken}`;
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        clearCachedToken(serviceName, serviceConfig.auth.scopes!);
        const credentials = JSON.parse(serviceConfig.auth.credentials) as SAC;
        const accessToken = await getAccessToken(serviceName, credentials, serviceConfig.auth.scopes!);
        headers['Authorization'] = `Bearer ${accessToken}`;
      } else {
        throw error;
      }
    }

  } else if (serviceConfig.auth.type === 'github-app' && serviceConfig.auth.appId && serviceConfig.auth.privateKey && serviceConfig.auth.installationId) {
    const { getInstallationToken, clearCachedInstallationToken } = await import('./github-app.js');
    type GHC = import('./github-app.js').GitHubAppCredentials;
    const ghCreds: GHC = {
      appId: serviceConfig.auth.appId,
      privateKey: serviceConfig.auth.privateKey,
      installationId: serviceConfig.auth.installationId,
    };
    try {
      const installationToken = await getInstallationToken(serviceName, ghCreds);
      headers['Authorization'] = `Bearer ${installationToken}`;
    } catch (error) {
      if (error instanceof Error && error.message.includes('401')) {
        clearCachedInstallationToken(serviceName);
        const installationToken = await getInstallationToken(serviceName, ghCreds);
        headers['Authorization'] = `Bearer ${installationToken}`;
      } else {
        throw error;
      }
    }
  }

  return { headers, urlParams };
}

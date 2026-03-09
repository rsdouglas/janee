import { URL } from 'url';
import {
  describe,
  expect,
  it,
} from 'vitest';

import { buildAuthHeaders } from './auth';
import type { ServiceConfig } from './mcp-server';

describe('buildAuthHeaders — oauth1a-twitter', () => {
  const service: ServiceConfig = {
    baseUrl: 'https://api.x.com',
    auth: {
      type: 'oauth1a-twitter',
      consumerKey: 'my-consumer-key',
      consumerSecret: 'my-consumer-secret',
      accessToken: 'my-access-token',
      accessTokenSecret: 'my-access-token-secret',
    },
  };

  it('should produce an OAuth Authorization header for POST /2/tweets', async () => {
    const result = await buildAuthHeaders('twitter', service, {
      method: 'POST',
      targetUrl: new URL('https://api.x.com/2/tweets'),
      body: '{"text":"hello"}',
    });

    expect(result.headers['Authorization']).toBeDefined();
    expect(result.headers['Authorization']).toMatch(/^OAuth /);
    expect(result.headers['Authorization']).toContain('oauth_consumer_key="my-consumer-key"');
    expect(result.headers['Authorization']).toContain('oauth_token="my-access-token"');
    expect(result.headers['Authorization']).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(result.headers['Authorization']).toContain('oauth_signature=');
    expect(result.urlParams).toBeUndefined();
  });

  it('should produce an OAuth header for GET /2/users/me', async () => {
    const result = await buildAuthHeaders('twitter', service, {
      method: 'GET',
      targetUrl: new URL('https://api.x.com/2/users/me'),
    });

    expect(result.headers['Authorization']).toMatch(/^OAuth /);
    expect(result.headers['Authorization']).toContain('oauth_consumer_key="my-consumer-key"');
  });

  it('should not include query params in the base URL for signing', async () => {
    const result = await buildAuthHeaders('twitter', service, {
      method: 'GET',
      targetUrl: new URL('https://api.x.com/2/users/me?user.fields=name,description'),
    });

    expect(result.headers['Authorization']).toMatch(/^OAuth /);
    // Query params should not appear in the OAuth header params
    expect(result.headers['Authorization']).not.toContain('user.fields');
  });
});

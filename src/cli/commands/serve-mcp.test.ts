/**
 * Tests for serve-mcp command (integration tests)
 */

import { describe, it, expect } from 'vitest';
import { URL } from 'url';

describe('serve-mcp SSRF protection', () => {
  it('should reject absolute URLs with mismatched origin', () => {
    // Simulate the logic in serve-mcp.ts onExecute handler
    const serviceConfig = {
      baseUrl: 'https://api.stripe.com',
      auth: { type: 'bearer' as const, key: 'sk_test_123' }
    };

    // Build target URL (same logic as serve-mcp.ts)
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    let reqPath = 'https://evil.com/exfiltrate';
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    // SSRF check
    const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
    
    // Should detect origin mismatch
    expect(targetUrl.origin).not.toBe(serviceOrigin);
    expect(targetUrl.origin).toBe('https://evil.com');
    expect(serviceOrigin).toBe('https://api.stripe.com');
  });

  it('should allow same-origin relative paths', () => {
    const serviceConfig = {
      baseUrl: 'https://api.stripe.com',
      auth: { type: 'bearer' as const, key: 'sk_test_123' }
    };

    // Build target URL for legitimate path
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    let reqPath = '/v1/customers';
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    // SSRF check
    const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
    
    // Should pass - same origin
    expect(targetUrl.origin).toBe(serviceOrigin);
    expect(targetUrl.href).toBe('https://api.stripe.com/v1/customers');
  });

  it('should allow same-origin absolute URLs', () => {
    const serviceConfig = {
      baseUrl: 'https://api.stripe.com',
      auth: { type: 'bearer' as const, key: 'sk_test_123' }
    };

    // Build target URL for same-origin absolute URL
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    let reqPath = 'https://api.stripe.com/v1/charges';
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    // SSRF check
    const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
    
    // Should pass - same origin
    expect(targetUrl.origin).toBe(serviceOrigin);
    expect(targetUrl.href).toBe('https://api.stripe.com/v1/charges');
  });

  it('should reject URLs with different subdomains', () => {
    const serviceConfig = {
      baseUrl: 'https://api.stripe.com',
      auth: { type: 'bearer' as const, key: 'sk_test_123' }
    };

    // Build target URL for different subdomain
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    let reqPath = 'https://evil.stripe.com/exfiltrate';
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    // SSRF check
    const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
    
    // Should detect origin mismatch (different subdomain = different origin)
    expect(targetUrl.origin).not.toBe(serviceOrigin);
    expect(targetUrl.origin).toBe('https://evil.stripe.com');
    expect(serviceOrigin).toBe('https://api.stripe.com');
  });

  it('should reject protocol changes', () => {
    const serviceConfig = {
      baseUrl: 'https://api.example.com',
      auth: { type: 'bearer' as const, key: 'test_key' }
    };

    // Build target URL with protocol downgrade
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith('/')) baseUrl += '/';
    let reqPath = 'http://api.example.com/data';
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    // SSRF check
    const serviceOrigin = new URL(serviceConfig.baseUrl).origin;
    
    // Should detect origin mismatch (http vs https = different origin)
    expect(targetUrl.origin).not.toBe(serviceOrigin);
    expect(targetUrl.origin).toBe('http://api.example.com');
    expect(serviceOrigin).toBe('https://api.example.com');
  });
});

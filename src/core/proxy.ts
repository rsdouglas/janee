/**
 * HTTP proxy server for Janee
 * Handles request proxying with key injection
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

export interface ProxyRequest {
  service: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export interface ProxyOptions {
  getServiceKey: (serviceName: string) => string;
  getServiceBaseUrl: (serviceName: string) => string;
  onRequest?: (req: ProxyRequest) => void | Promise<void>;
  onResponse?: (req: ProxyRequest, res: ProxyResponse) => void | Promise<void>;
}

/**
 * Create HTTP proxy server
 */
export function createProxyServer(options: ProxyOptions): http.Server {
  const { getServiceKey, getServiceBaseUrl, onRequest, onResponse } = options;

  return http.createServer(async (req, res) => {
    try {
      // Parse URL: /<service>/<path>
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (pathParts.length < 1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid URL format. Use: /<service>/<path>' }));
        return;
      }

      const serviceName = pathParts[0];
      const servicePath = '/' + pathParts.slice(1).join('/') + url.search;

      // Get service details
      let serviceKey: string;
      let baseUrl: string;

      try {
        serviceKey = getServiceKey(serviceName);
        baseUrl = getServiceBaseUrl(serviceName);
      } catch (error) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: error instanceof Error ? error.message : 'Service not found'
        }));
        return;
      }

      // Read request body if present
      let body = '';
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        for await (const chunk of req) {
          body += chunk;
        }
      }

      // Build proxy request
      const proxyReq: ProxyRequest = {
        service: serviceName,
        path: servicePath,
        method: req.method || 'GET',
        headers: { ...req.headers } as Record<string, string>,
        body: body || undefined
      };

      // Delete hop-by-hop headers
      delete proxyReq.headers['host'];
      delete proxyReq.headers['connection'];
      delete proxyReq.headers['keep-alive'];
      delete proxyReq.headers['proxy-authenticate'];
      delete proxyReq.headers['proxy-authorization'];
      delete proxyReq.headers['te'];
      delete proxyReq.headers['trailer'];
      delete proxyReq.headers['transfer-encoding'];
      delete proxyReq.headers['upgrade'];

      // Inject API key (default: Bearer token in Authorization header)
      // TODO: Support other auth patterns
      proxyReq.headers['Authorization'] = `Bearer ${serviceKey}`;

      // Hook: before proxying
      if (onRequest) {
        await onRequest(proxyReq);
      }

      // Make the proxied request
      const targetUrl = new URL(servicePath, baseUrl);
      const proxyResponse = await makeRequest(targetUrl, proxyReq);

      // Hook: after response
      if (onResponse) {
        await onResponse(proxyReq, proxyResponse);
      }

      // Send response back to client
      res.writeHead(proxyResponse.statusCode, proxyResponse.headers);
      res.end(proxyResponse.body);

    } catch (error) {
      console.error('Proxy error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }));
    }
  });
}

/**
 * Make HTTP/HTTPS request
 */
function makeRequest(
  targetUrl: URL,
  proxyReq: ProxyRequest
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const client = targetUrl.protocol === 'https:' ? https : http;

    const options = {
      method: proxyReq.method,
      headers: proxyReq.headers
    };

    const req = client.request(targetUrl, options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          headers: res.headers as Record<string, string | string[]>,
          body
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (proxyReq.body) {
      req.write(proxyReq.body);
    }

    req.end();
  });
}

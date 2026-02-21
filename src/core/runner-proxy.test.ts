import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import { forwardToolCall, resetAuthoritySession } from './runner-proxy';

describe('runner-proxy', () => {
  let server: http.Server;
  let port: number;
  const calls: { method: string; body: any }[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    app.post('/mcp', (req, res) => {
      calls.push({ method: req.body.method, body: req.body });

      if (req.body.method === 'initialize') {
        const sid = 'test-session-' + Date.now();
        res.setHeader('mcp-session-id', sid);
        return res.json({
          jsonrpc: '2.0',
          id: req.body.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'mock-authority', version: '0.0.1' },
          },
        });
      }

      if (req.body.method === 'tools/call') {
        const { name, arguments: args } = req.body.params;
        return res.json({
          jsonrpc: '2.0',
          id: req.body.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify({ forwarded: name, args }) }],
          },
        });
      }

      res.status(400).json({ error: 'unknown' });
    });

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app);
      s.listen(0, '127.0.0.1', () => resolve(s));
    });

    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('bad address');
    port = addr.port;
  });

  afterAll(async () => {
    resetAuthoritySession();
    await new Promise<void>((r, e) => server.close((err) => err ? e(err) : r()));
  });

  it('forwards a tool call through MCP to a mock authority', async () => {
    resetAuthoritySession();
    const result = await forwardToolCall(
      `http://127.0.0.1:${port}`,
      'test-runner',
      'list_services',
      {},
    );

    expect(result).toBeDefined();
    const content = (result as any).content[0].text;
    const parsed = JSON.parse(content);
    expect(parsed.forwarded).toBe('list_services');
  });

  it('reuses session across calls', async () => {
    const before = calls.length;

    await forwardToolCall(`http://127.0.0.1:${port}`, 'test-runner', 'execute', { capability: 'test' });

    // Should not have sent another initialize
    const initCalls = calls.slice(before).filter(c => c.method === 'initialize');
    expect(initCalls.length).toBe(0);
  });
});

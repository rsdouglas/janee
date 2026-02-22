import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import express from "express";
import { forwardToolCall, resetAuthoritySession } from "./runner-proxy";

describe("runner-proxy", () => {
  let server: http.Server;
  let port: number;
  const calls: { method: string; body: any }[] = [];

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    app.post("/mcp", (req, res) => {
      calls.push({ method: req.body.method, body: req.body });

      if (req.body.method === "initialize") {
        const sid = "test-session-" + Date.now();
        res.setHeader("mcp-session-id", sid);
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "mock-authority", version: "0.0.1" },
          },
        });
      }

      if (req.body.method === "tools/call") {
        const { name, arguments: args } = req.body.params;
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            content: [
              { type: "text", text: JSON.stringify({ forwarded: name, args }) },
            ],
          },
        });
      }

      res.status(400).json({ error: "unknown" });
    });

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });

    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bad address");
    port = addr.port;
  });

  afterAll(async () => {
    resetAuthoritySession();
    await new Promise<void>((r, e) =>
      server.close((err) => (err ? e(err) : r())),
    );
  });

  beforeEach(() => {
    resetAuthoritySession();
  });

  it("forwards a tool call through MCP to a mock authority", async () => {
    const result = await forwardToolCall(
      `http://127.0.0.1:${port}`,
      "test-runner",
      "list_services",
      {},
    );

    expect(result).toBeDefined();
    const content = (result as any).content[0].text;
    const parsed = JSON.parse(content);
    expect(parsed.forwarded).toBe("list_services");
  });

  it("reuses session across calls", async () => {
    await forwardToolCall(
      `http://127.0.0.1:${port}`,
      "test-runner",
      "execute",
      { capability: "first" },
    );
    const before = calls.length;

    await forwardToolCall(
      `http://127.0.0.1:${port}`,
      "test-runner",
      "execute",
      { capability: "second" },
    );

    // Should not have sent another initialize
    const initCalls = calls
      .slice(before)
      .filter((c) => c.method === "initialize");
    expect(initCalls.length).toBe(0);
  });

  it("passes tool arguments through correctly", async () => {
    const before = calls.length;
    await forwardToolCall(
      `http://127.0.0.1:${port}`,
      "test-runner",
      "execute",
      { capability: "github", method: "GET", path: "/repos" },
    );

    const toolCall = calls.slice(before).find((c) => c.method === "tools/call");
    expect(toolCall).toBeDefined();
    expect(toolCall!.body.params.name).toBe("execute");
    expect(toolCall!.body.params.arguments).toEqual({
      capability: "github",
      method: "GET",
      path: "/repos",
    });
  });

  it("sends correct MCP headers", async () => {
    // Use a separate server that captures headers
    const headers: Record<string, string | string[] | undefined>[] = [];
    const headerApp = express();
    headerApp.use(express.json());
    headerApp.post("/mcp", (req, res) => {
      headers.push({ ...req.headers });
      if (req.body.method === "initialize") {
        res.setHeader("mcp-session-id", "header-test-session");
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.1" },
          },
        });
      }
      return res.json({
        jsonrpc: "2.0",
        id: req.body.id,
        result: { content: [{ type: "text", text: "ok" }] },
      });
    });

    const headerServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(headerApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const hPort = (headerServer.address() as any).port;

    try {
      resetAuthoritySession();
      // First call: initialize
      await forwardToolCall(
        `http://127.0.0.1:${hPort}`,
        "header-runner",
        "test_tool",
        {},
      );

      // initialize request should have content-type and accept
      expect(headers[0]["content-type"]).toBe("application/json");
      expect(headers[0]["accept"]).toContain("application/json");

      // tool call should include session ID
      expect(headers[1]["mcp-session-id"]).toBe("header-test-session");
    } finally {
      await new Promise<void>((r, e) =>
        headerServer.close((err) => (err ? e(err) : r())),
      );
    }
  });
});

describe("runner-proxy session retry", () => {
  it("retries on 400 by resetting session and re-initializing", async () => {
    let callCount = 0;
    const retryApp = express();
    retryApp.use(express.json());
    retryApp.post("/mcp", (req, res) => {
      callCount++;
      if (req.body.method === "initialize") {
        res.setHeader("mcp-session-id", "retry-session-" + callCount);
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.1" },
          },
        });
      }
      // First tool call returns 400, second succeeds
      if (callCount <= 3) {
        return res.status(400).json({ error: "bad session" });
      }
      return res.json({
        jsonrpc: "2.0",
        id: req.body.id,
        result: { content: [{ type: "text", text: "recovered" }] },
      });
    });

    const retryServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(retryApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const rPort = (retryServer.address() as any).port;

    try {
      resetAuthoritySession();
      const result = await forwardToolCall(
        `http://127.0.0.1:${rPort}`,
        "retry-runner",
        "test_tool",
        {},
      );
      const text = (result as any).content[0].text;
      expect(text).toBe("recovered");
      // Should have called initialize twice (original + retry)
      expect(callCount).toBeGreaterThan(3);
    } finally {
      await new Promise<void>((r, e) =>
        retryServer.close((err) => (err ? e(err) : r())),
      );
    }
  });

  it("retries on JSON-level session error", async () => {
    let callCount = 0;
    const sessionErrApp = express();
    sessionErrApp.use(express.json());
    sessionErrApp.post("/mcp", (req, res) => {
      callCount++;
      if (req.body.method === "initialize") {
        res.setHeader("mcp-session-id", "sess-err-" + callCount);
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.1" },
          },
        });
      }
      // First tool call returns session error, second succeeds
      if (callCount <= 3) {
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          error: { code: -1, message: "invalid session" },
        });
      }
      return res.json({
        jsonrpc: "2.0",
        id: req.body.id,
        result: { content: [{ type: "text", text: "ok-after-retry" }] },
      });
    });

    const errServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(sessionErrApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const ePort = (errServer.address() as any).port;

    try {
      resetAuthoritySession();
      const result = await forwardToolCall(
        `http://127.0.0.1:${ePort}`,
        "err-runner",
        "test_tool",
        {},
      );
      const text = (result as any).content[0].text;
      expect(text).toBe("ok-after-retry");
    } finally {
      await new Promise<void>((r, e) =>
        errServer.close((err) => (err ? e(err) : r())),
      );
    }
  });

  it("throws on persistent HTTP error after retry", async () => {
    const failApp = express();
    failApp.use(express.json());
    failApp.post("/mcp", (req, res) => {
      if (req.body.method === "initialize") {
        res.setHeader("mcp-session-id", "fail-sess");
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.1" },
          },
        });
      }
      // Always return 500 — not retryable
      return res.status(500).json({ error: "internal" });
    });

    const failServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(failApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const fPort = (failServer.address() as any).port;

    try {
      resetAuthoritySession();
      await expect(
        forwardToolCall(
          `http://127.0.0.1:${fPort}`,
          "fail-runner",
          "test_tool",
          {},
        ),
      ).rejects.toThrow("Authority HTTP 500");
    } finally {
      await new Promise<void>((r, e) =>
        failServer.close((err) => (err ? e(err) : r())),
      );
    }
  });

  it("handles SSE-formatted responses", async () => {
    const sseApp = express();
    sseApp.use(express.json());
    sseApp.post("/mcp", (req, res) => {
      if (req.body.method === "initialize") {
        res.setHeader("mcp-session-id", "sse-sess");
        // Return as SSE format
        res.setHeader("content-type", "text/event-stream");
        return res.send(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "sse-test", version: "0.0.1" } } })}\n\n`,
        );
      }
      res.setHeader("content-type", "text/event-stream");
      return res.send(
        `data: ${JSON.stringify({ jsonrpc: "2.0", id: req.body.id, result: { content: [{ type: "text", text: "sse-response" }] } })}\n\n`,
      );
    });

    const sseServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(sseApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const sPort = (sseServer.address() as any).port;

    try {
      resetAuthoritySession();
      const result = await forwardToolCall(
        `http://127.0.0.1:${sPort}`,
        "sse-runner",
        "test_tool",
        {},
      );
      const text = (result as any).content[0].text;
      expect(text).toBe("sse-response");
    } finally {
      await new Promise<void>((r, e) =>
        sseServer.close((err) => (err ? e(err) : r())),
      );
    }
  });

  it("recovers session from initialize error with sessionId in data", async () => {
    let initCount = 0;
    const recoverApp = express();
    recoverApp.use(express.json());
    recoverApp.post("/mcp", (req, res) => {
      if (req.body.method === "initialize") {
        initCount++;
        if (initCount === 1) {
          // First init: return error with session ID embedded
          return res.json({
            jsonrpc: "2.0",
            id: req.body.id,
            error: {
              code: -1,
              message: "already initialized",
              data: { sessionId: "recovered-session-id" },
            },
          });
        }
        // Second init: normal
        res.setHeader("mcp-session-id", "normal-session");
        return res.json({
          jsonrpc: "2.0",
          id: req.body.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            serverInfo: { name: "test", version: "0.0.1" },
          },
        });
      }
      // Tool call uses the recovered session
      return res.json({
        jsonrpc: "2.0",
        id: req.body.id,
        result: { content: [{ type: "text", text: "with-recovered-session" }] },
      });
    });

    const recoverServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(recoverApp);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const rcPort = (recoverServer.address() as any).port;

    try {
      resetAuthoritySession();
      const result = await forwardToolCall(
        `http://127.0.0.1:${rcPort}`,
        "recover-runner",
        "test_tool",
        {},
      );
      const text = (result as any).content[0].text;
      expect(text).toBe("with-recovered-session");
    } finally {
      await new Promise<void>((r, e) =>
        recoverServer.close((err) => (err ? e(err) : r())),
      );
    }
  });
});

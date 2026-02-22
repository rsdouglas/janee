import { describe, expect, it } from "vitest";
import {
  createAuthorityApp,
  authorityAuthorizeExec,
  authorityCompleteExec,
  buildAuthorityHooks,
} from "./authority";
import http from "http";

function startApp(
  app: ReturnType<typeof createAuthorityApp>,
): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string")
        throw new Error("Expected inet addr");
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function stopServer(server: http.Server): Promise<void> {
  return new Promise((r, e) => server.close((err) => (err ? e(err) : r())));
}

describe("authority API authentication", () => {
  it("rejects wrong runner key with timing-safe compare", async () => {
    const app = createAuthorityApp("correct-key", {
      authorizeExec: async () => {
        throw new Error("should not be called");
      },
      completeExec: async () => {},
    });

    const { server, baseUrl } = await startApp(app);

    // Wrong key
    const res = await fetch(`${baseUrl}/v1/exec/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-janee-runner-key": "wrong-key!!",
      },
      body: JSON.stringify({
        runner: { runnerId: "x" },
        command: ["echo"],
        capabilityId: "test",
      }),
    });
    expect(res.status).toBe(401);

    // Health endpoint is unauthenticated
    const healthRes = await fetch(`${baseUrl}/v1/health`);
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json();
    expect(healthBody.ok).toBe(true);
    expect(healthBody.mode).toBe("authority");

    await stopServer(server);
  });

  it("rejects missing runner key", async () => {
    const app = createAuthorityApp("test-key-12345", {
      authorizeExec: async () => {
        throw new Error("should not be called");
      },
      completeExec: async () => {},
    });
    const { server, baseUrl } = await startApp(app);

    const res = await fetch(`${baseUrl}/v1/exec/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runner: { runnerId: "x" },
        command: ["echo"],
        capabilityId: "test",
      }),
    });
    expect(res.status).toBe(401);

    await stopServer(server);
  });
});

describe("authority API request validation", () => {
  const hooks = {
    authorizeExec: async () => ({
      grantId: "g1",
      grantExpiresAt: new Date().toISOString(),
      effectiveTimeoutMs: 1000,
      envInjections: {},
      scrubValues: [],
      constraints: { policyHash: "x", executable: "echo", command: ["echo"] },
    }),
    completeExec: async () => {},
  };

  it("rejects authorize request without runnerId", async () => {
    const app = createAuthorityApp("key123456789", hooks);
    const { server, baseUrl } = await startApp(app);

    const res = await fetch(`${baseUrl}/v1/exec/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-janee-runner-key": "key123456789",
      },
      body: JSON.stringify({
        runner: {},
        command: ["echo"],
        capabilityId: "test",
      }),
    });
    expect(res.status).toBe(400);

    await stopServer(server);
  });

  it("rejects authorize request without command", async () => {
    const app = createAuthorityApp("key123456789", hooks);
    const { server, baseUrl } = await startApp(app);

    const res = await fetch(`${baseUrl}/v1/exec/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-janee-runner-key": "key123456789",
      },
      body: JSON.stringify({
        runner: { runnerId: "r1" },
        command: [],
        capabilityId: "test",
      }),
    });
    expect(res.status).toBe(400);

    await stopServer(server);
  });

  it("rejects authorize request without capabilityId", async () => {
    const app = createAuthorityApp("key123456789", hooks);
    const { server, baseUrl } = await startApp(app);

    const res = await fetch(`${baseUrl}/v1/exec/authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-janee-runner-key": "key123456789",
      },
      body: JSON.stringify({ runner: { runnerId: "r1" }, command: ["echo"] }),
    });
    expect(res.status).toBe(400);

    await stopServer(server);
  });

  it("rejects complete request without grantId", async () => {
    const app = createAuthorityApp("key123456789", hooks);
    const { server, baseUrl } = await startApp(app);

    const res = await fetch(`${baseUrl}/v1/exec/complete`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-janee-runner-key": "key123456789",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("grantId");

    await stopServer(server);
  });
});

describe("buildAuthorityHooks", () => {
  it("creates working hooks from config with bearer auth", async () => {
    const logs: any[] = [];
    const hooks = buildAuthorityHooks(
      {
        services: {
          "test-svc": {
            auth: { type: "bearer", key: "secret-tok-12345678" },
            baseUrl: "https://example.com",
          },
        },
        capabilities: [
          {
            name: "test-cap",
            service: "test-svc",
            mode: "exec",
            allowCommands: ["echo"],
            env: { TOKEN: "{{credential}}" },
            timeout: 5000,
          },
        ],
      },
      { log: (...a: any[]) => logs.push(a) },
    );

    const grant = await hooks.authorizeExec({
      runner: { runnerId: "r-1" },
      capabilityId: "test-cap",
      command: ["echo", "hi"],
    });

    expect(grant.grantId).toBeTruthy();
    expect(grant.envInjections.TOKEN).toBe("secret-tok-12345678");
    expect(grant.scrubValues).toContain("secret-tok-12345678");
    expect(grant.effectiveTimeoutMs).toBe(5000);

    await hooks.completeExec({
      grantId: grant.grantId,
      exitCode: 0,
      startedAt: new Date().toISOString(),
      durationMs: 10,
      stdoutBytes: 5,
      stderrBytes: 0,
      scrubbedStdoutHits: 0,
      scrubbedStderrHits: 0,
    });
    expect(logs.length).toBeGreaterThan(0);
  });

  it("uses minimum of request timeout and capability timeout", async () => {
    const hooks = buildAuthorityHooks(
      {
        services: {
          svc: {
            auth: { type: "bearer", key: "key12345678901" },
            baseUrl: "https://example.com",
          },
        },
        capabilities: [
          {
            name: "slow-cap",
            service: "svc",
            mode: "exec",
            allowCommands: ["echo"],
            env: {},
            timeout: 10000,
          },
        ],
      },
      { log: () => {} },
    );

    // Request timeout smaller than cap timeout
    const grant1 = await hooks.authorizeExec({
      runner: { runnerId: "r-1" },
      capabilityId: "slow-cap",
      command: ["echo"],
      timeoutMs: 3000,
    });
    expect(grant1.effectiveTimeoutMs).toBe(3000);

    // Request timeout larger than cap timeout
    const grant2 = await hooks.authorizeExec({
      runner: { runnerId: "r-1" },
      capabilityId: "slow-cap",
      command: ["echo"],
      timeoutMs: 60000,
    });
    expect(grant2.effectiveTimeoutMs).toBe(10000);
  });

  it("rejects unknown capability", async () => {
    const hooks = buildAuthorityHooks(
      {
        services: {},
        capabilities: [],
      },
      { log: () => {} },
    );

    await expect(
      hooks.authorizeExec({
        runner: { runnerId: "r-1" },
        capabilityId: "nonexistent-cap",
        command: ["echo"],
      }),
    ).rejects.toThrow(/unknown ca/i);
  });

  it("handles HMAC auth type with multiple credentials", async () => {
    const hooks = buildAuthorityHooks(
      {
        services: {
          "exchange-svc": {
            auth: {
              type: "hmac-bybit",
              apiKey: "bybit-key-12345678",
              apiSecret: "bybit-secret-12345",
              passphrase: "my-passphrase-123",
            },
            baseUrl: "https://api.bybit.com",
          },
        },
        capabilities: [
          {
            name: "trade-cap",
            service: "exchange-svc",
            mode: "exec",
            allowCommands: ["python3"],
            env: { API_KEY: "{{credential}}" },
          },
        ],
      },
      { log: () => {} },
    );

    const grant = await hooks.authorizeExec({
      runner: { runnerId: "r-1" },
      capabilityId: "trade-cap",
      command: ["python3", "trade.py"],
    });

    // All sensitive values should be scrubbed
    expect(grant.scrubValues).toContain("bybit-key-12345678");
    expect(grant.scrubValues).toContain("bybit-secret-12345");
    expect(grant.scrubValues).toContain("my-passphrase-123");
  });

  it("generates unique grant IDs", async () => {
    const hooks = buildAuthorityHooks(
      {
        services: {
          svc: {
            auth: { type: "bearer", key: "key12345678901" },
            baseUrl: "https://example.com",
          },
        },
        capabilities: [
          {
            name: "cap",
            service: "svc",
            mode: "exec",
            allowCommands: ["echo"],
            env: {},
          },
        ],
      },
      { log: () => {} },
    );

    const grants = await Promise.all(
      Array.from({ length: 10 }, () =>
        hooks.authorizeExec({
          runner: { runnerId: "r-1" },
          capabilityId: "cap",
          command: ["echo"],
        }),
      ),
    );

    const ids = new Set(grants.map((g) => g.grantId));
    expect(ids.size).toBe(10);
  });
});

describe("authority end-to-end lifecycle", () => {
  it("authorizes and completes an execution lifecycle via HTTP", async () => {
    const calls: string[] = [];
    const app = createAuthorityApp("runner-secret", {
      authorizeExec: async (req) => {
        calls.push(`authorize:${req.capabilityId}`);
        return {
          grantId: "grant-1",
          grantExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          effectiveTimeoutMs: 1000,
          envInjections: { GH_TOKEN: "abc123456789" },
          scrubValues: ["abc123456789"],
          constraints: {
            cwd: "/tmp/work",
            policyHash: "policy-123",
            executable: req.command[0],
            command: req.command,
          },
        };
      },
      completeExec: async (req) => {
        calls.push(`complete:${req.grantId}:${req.exitCode}`);
      },
    });

    const { server, baseUrl } = await startApp(app);

    const grant = await authorityAuthorizeExec(baseUrl, "runner-secret", {
      runner: { runnerId: "runner-1", environment: "test" },
      capabilityId: "github-api",
      command: [
        "curl",
        "-H",
        "Authorization: Bearer $GH_TOKEN",
        "https://api.github.com/user",
      ],
    });

    expect(grant.grantId).toBe("grant-1");
    expect(grant.envInjections.GH_TOKEN).toBe("abc123456789");
    expect(grant.constraints.executable).toBe("curl");

    await authorityCompleteExec(baseUrl, "runner-secret", {
      grantId: "grant-1",
      exitCode: 0,
      startedAt: new Date().toISOString(),
      durationMs: 250,
      stdoutBytes: 1024,
      stderrBytes: 0,
      scrubbedStdoutHits: 1,
      scrubbedStderrHits: 0,
    });

    expect(calls).toEqual(["authorize:github-api", "complete:grant-1:0"]);

    await stopServer(server);
  });

  it("returns 403 when hook throws", async () => {
    const app = createAuthorityApp("key123456789", {
      authorizeExec: async () => {
        throw new Error("Policy violation: command not allowed");
      },
      completeExec: async () => {},
    });

    const { server, baseUrl } = await startApp(app);

    await expect(
      authorityAuthorizeExec(baseUrl, "key123456789", {
        runner: { runnerId: "r1" },
        capabilityId: "restricted",
        command: ["rm", "-rf", "/"],
      }),
    ).rejects.toThrow(/403/);

    await stopServer(server);
  });

  it("returns 500 when completeExec hook throws", async () => {
    const app = createAuthorityApp("key123456789", {
      authorizeExec: async () => ({
        grantId: "g1",
        grantExpiresAt: new Date().toISOString(),
        effectiveTimeoutMs: 1000,
        envInjections: {},
        scrubValues: [],
        constraints: { policyHash: "x", executable: "echo", command: ["echo"] },
      }),
      completeExec: async () => {
        throw new Error("audit log write failed");
      },
    });

    const { server, baseUrl } = await startApp(app);

    await expect(
      authorityCompleteExec(baseUrl, "key123456789", {
        grantId: "g1",
        exitCode: 0,
        startedAt: new Date().toISOString(),
        durationMs: 10,
        stdoutBytes: 0,
        stderrBytes: 0,
        scrubbedStdoutHits: 0,
        scrubbedStderrHits: 0,
      }),
    ).rejects.toThrow(/500/);

    await stopServer(server);
  });
});

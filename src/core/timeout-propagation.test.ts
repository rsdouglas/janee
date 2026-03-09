import { describe, it, expect, vi, beforeEach } from "vitest";
import http from "http";

import {
  createAuthorityApp,
  buildAuthorityHooks,
  AuthorityExecHooks,
} from "./authority";

// Mock health module to capture timeout
vi.mock("./health.js", () => ({
  testServiceConnection: vi.fn(
    async (name: string, config: any, options?: { timeout?: number }) => ({
      service: name,
      reachable: true,
      authOk: true,
      statusCode: 200,
      latencyMs: 42,
      authType: "bearer",
      testUrl: `${config.baseUrl || "http://localhost"}/test`,
      timeout: options?.timeout,
    }),
  ),
}));

import { testServiceConnection } from "./health";

const API_KEY = "test-runner-key-12345678";

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

describe("timeout propagation through authority REST endpoint", () => {
  let capturedTimeout: number | undefined;

  function makeHooks(): AuthorityExecHooks {
    return {
      authorizeExec: vi.fn() as any,
      completeExec: vi.fn() as any,
      testService: async (
        serviceName?: string,
        options?: { timeout?: number },
      ) => {
        capturedTimeout = options?.timeout;
        const config = { baseUrl: "https://api.example.com" };
        return (testServiceConnection as any)(
          serviceName || "default",
          config,
          options || {},
        );
      },
    };
  }

  it("forwards timeout from POST /v1/test body to testService hook", async () => {
    capturedTimeout = undefined;
    const app = createAuthorityApp(API_KEY, makeHooks());
    const { server, baseUrl } = await startApp(app);

    try {
      const res = await fetch(`${baseUrl}/v1/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-janee-runner-key": API_KEY,
        },
        body: JSON.stringify({ service: "myapi", timeout: 3000 }),
      });

      expect(res.status).toBe(200);
      expect(capturedTimeout).toBe(3000);
    } finally {
      server.close();
    }
  });

  it("works without timeout (backwards compatible)", async () => {
    capturedTimeout = undefined;
    const app = createAuthorityApp(API_KEY, makeHooks());
    const { server, baseUrl } = await startApp(app);

    try {
      const res = await fetch(`${baseUrl}/v1/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-janee-runner-key": API_KEY,
        },
        body: JSON.stringify({ service: "myapi" }),
      });

      expect(res.status).toBe(200);
      expect(capturedTimeout).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

describe("buildAuthorityHooks forwards timeout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes timeout to testServiceConnection for single service", async () => {
    const config = {
      services: {
        github: {
          baseUrl: "https://api.github.com",
          auth: { type: "bearer" as const, envKey: "GH_TOKEN" },
        },
      },
      capabilities: [],
    };
    const auditLogger = { log: vi.fn() };
    const hooks = buildAuthorityHooks(config, auditLogger);

    await hooks.testService!("github", { timeout: 5000 });

    expect(testServiceConnection).toHaveBeenCalledWith(
      "github",
      config.services.github,
      { timeout: 5000 },
    );
  });

  it("passes timeout to testServiceConnection for all services", async () => {
    const config = {
      services: {
        a: {
          baseUrl: "https://a.com",
          auth: { type: "bearer" as const, envKey: "A" },
        },
        b: {
          baseUrl: "https://b.com",
          auth: { type: "bearer" as const, envKey: "B" },
        },
      },
      capabilities: [],
    };
    const auditLogger = { log: vi.fn() };
    const hooks = buildAuthorityHooks(config, auditLogger);

    await hooks.testService!(undefined, { timeout: 2000 });

    expect(testServiceConnection).toHaveBeenCalledTimes(2);
    expect(testServiceConnection).toHaveBeenCalledWith("a", config.services.a, {
      timeout: 2000,
    });
    expect(testServiceConnection).toHaveBeenCalledWith("b", config.services.b, {
      timeout: 2000,
    });
  });
});

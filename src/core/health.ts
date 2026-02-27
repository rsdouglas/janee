/**
 * Health check module for Janee services
 * Provides connectivity and latency checks for configured API backends
 */

import { URL } from "url";

import { buildAuthHeaders } from "./auth.js";
import { getService, serviceDirectory } from "./directory.js";
import { ServiceConfig } from "./mcp-server.js";

export interface HealthCheckResult {
  service: string;
  healthy: boolean;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

export interface HealthCheckOptions {
  timeout?: number;
  fetchFn?: typeof fetch;
}

/**
 * Quick reachability check — unauthenticated HEAD against the base URL.
 * Use for uptime monitoring where you just care "is the endpoint up?"
 * Considers 401/403 as reachable (the server answered, auth is just expected).
 *
 * For verifying credentials actually work, use testServiceConnection() instead.
 */
export async function checkServiceHealth(
  serviceName: string,
  baseUrl: string,
  options: HealthCheckOptions = {},
): Promise<HealthCheckResult> {
  const { timeout = 5000, fetchFn = fetch } = options;
  const checkedAt = new Date().toISOString();

  if (!baseUrl) {
    return {
      service: serviceName,
      healthy: false,
      latencyMs: 0,
      error: "No base URL configured",
      checkedAt,
    };
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetchFn(baseUrl, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    // 2xx = healthy, 401/403 = reachable (auth expected), 4xx = unhealthy, 5xx = unhealthy
    const isReachable =
      response.ok || response.status === 401 || response.status === 403;

    if (isReachable) {
      return {
        service: serviceName,
        healthy: true,
        statusCode: response.status,
        latencyMs,
        checkedAt,
      };
    }

    return {
      service: serviceName,
      healthy: false,
      statusCode: response.status,
      latencyMs,
      error: `HTTP ${response.status} ${response.statusText}`,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    return {
      service: serviceName,
      healthy: false,
      latencyMs,
      error: message,
      checkedAt,
    };
  }
}

/**
 * Check health of multiple services in parallel
 */
export async function checkAllServicesHealth(
  services: Map<string, { baseUrl: string }>,
  options: HealthCheckOptions = {},
): Promise<HealthCheckResult[]> {
  const checks = Array.from(services.entries()).map(([name, config]) =>
    checkServiceHealth(name, config.baseUrl, options),
  );
  return Promise.all(checks);
}

export interface ServiceTestResult {
  service: string;
  baseUrl: string;
  testUrl: string;
  reachable: boolean;
  authOk: boolean;
  statusCode?: number;
  latencyMs: number;
  authType: string;
  error?: string;
  /** Truncated upstream response body on failure — helps agents diagnose issues */
  responseBody?: string;
  checkedAt: string;
}

export interface ServiceTestOptions {
  /** Auth-required endpoint path to test (e.g. "/v1/balance" for Stripe). Falls back to "/" */
  testPath?: string;
  timeout?: number;
  fetchFn?: typeof fetch;
}

/**
 * Resolve the best testPath for a service by matching against the template directory.
 * Returns undefined if no template match is found.
 */
export function resolveTestPath(
  serviceName: string,
  baseUrl: string,
): string | undefined {
  const byName = getService(serviceName);
  if (byName?.testPath) return byName.testPath;

  // Fall back to matching by baseUrl
  const byUrl = serviceDirectory.find(
    (t) => t.testPath && baseUrl.startsWith(t.baseUrl),
  );
  return byUrl?.testPath;
}

/**
 * Full credential test — authenticated GET against an auth-required endpoint.
 * Use when you need to verify that stored credentials are actually valid.
 * Injects auth headers via buildAuthHeaders() (same path as the proxy).
 *
 * For simple reachability without auth, use checkServiceHealth() instead.
 */
export async function testServiceConnection(
  serviceName: string,
  serviceConfig: ServiceConfig,
  options: ServiceTestOptions = {},
): Promise<ServiceTestResult> {
  const { timeout = 10000, fetchFn = fetch } = options;
  const checkedAt = new Date().toISOString();
  const authType = serviceConfig.auth.type;

  if (!serviceConfig.baseUrl) {
    return {
      service: serviceName,
      baseUrl: "",
      testUrl: "",
      reachable: false,
      authOk: false,
      latencyMs: 0,
      authType,
      error: "No base URL configured",
      checkedAt,
    };
  }

  const testPath =
    options.testPath ||
    serviceConfig.testPath ||
    resolveTestPath(serviceName, serviceConfig.baseUrl);
  const start = Date.now();

  try {
    let baseUrl = serviceConfig.baseUrl;
    if (!baseUrl.endsWith("/")) baseUrl += "/";
    let reqPath = testPath || "";
    if (reqPath.startsWith("/")) reqPath = reqPath.slice(1);
    const targetUrl = new URL(reqPath, baseUrl);

    const authResult = await buildAuthHeaders(serviceName, serviceConfig, {
      method: "GET",
      targetUrl,
      body: undefined,
    });

    if (authResult.urlParams) {
      for (const [key, value] of Object.entries(authResult.urlParams)) {
        targetUrl.searchParams.set(key, value);
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetchFn(targetUrl.toString(), {
      method: "GET",
      headers: authResult.headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    const reachable = true;
    const authOk = response.ok;

    // On failure, capture upstream response body so agents can diagnose
    let responseBody: string | undefined;
    if (!authOk) {
      try {
        const raw = await response.text();
        responseBody = raw.length > 512 ? raw.slice(0, 512) + "…" : raw;
      } catch {
        // best-effort
      }
    }

    return {
      service: serviceName,
      baseUrl: serviceConfig.baseUrl,
      testUrl: targetUrl.toString(),
      reachable,
      authOk,
      statusCode: response.status,
      latencyMs,
      authType,
      ...(response.status === 401 && { error: "Authentication failed (401)" }),
      ...(response.status === 403 && {
        error: "Forbidden (403) — credentials may lack required permissions",
      }),
      ...(!response.ok &&
        response.status !== 401 &&
        response.status !== 403 && {
          error: `HTTP ${response.status} ${response.statusText}`,
        }),
      responseBody,
      checkedAt,
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort");

    return {
      service: serviceName,
      baseUrl: serviceConfig.baseUrl,
      testUrl: serviceConfig.baseUrl + (testPath || ""),
      reachable: false,
      authOk: false,
      latencyMs,
      authType,
      error: isTimeout ? `Timeout after ${timeout}ms` : message,
      checkedAt,
    };
  }
}

// --- Exec-mode health checks ---

export interface ExecHealthCheckResult {
  service: string;
  capability: string;
  healthy: boolean;
  checks: {
    binaryExists: boolean;
    binaryPath?: string;
    envResolvable: boolean;
    unresolvedVars?: string[];
  };
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

/**
 * Check if an exec-mode capability is functional:
 * - Binary specified in allowCommands exists and is executable
 * - Credential env vars can be resolved (without leaking values)
 */
export async function checkExecHealth(
  serviceName: string,
  capabilityName: string,
  capability: {
    allowCommands?: string[];
    env?: Record<string, string>;
  },
  credentialAvailable: boolean,
): Promise<ExecHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  const start = Date.now();

  const checks = {
    binaryExists: false,
    binaryPath: undefined as string | undefined,
    envResolvable: false,
    unresolvedVars: undefined as string[] | undefined,
  };

  // Check binary existence for first allowed command
  if (capability.allowCommands && capability.allowCommands.length > 0) {
    const binary = capability.allowCommands[0];
    try {
      const { execSync } = await import("child_process");
      const whichResult = execSync(`command -v ${binary} 2>/dev/null`, {
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      checks.binaryExists = true;
      checks.binaryPath = whichResult;
    } catch {
      checks.binaryExists = false;
    }
  }

  // Check env var template resolution
  if (capability.env) {
    const templateVars = Object.values(capability.env)
      .flatMap((v) => [...v.matchAll(/\{\{(\w+)\}\}/g)])
      .map((m) => m[1]);

    const unresolved: string[] = [];
    for (const varName of templateVars) {
      if (varName === "credential" && !credentialAvailable) {
        unresolved.push("credential");
      }
      if (
        ["apiKey", "apiSecret", "passphrase"].includes(varName) &&
        !credentialAvailable
      ) {
        unresolved.push(varName);
      }
    }

    checks.envResolvable = unresolved.length === 0;
    if (unresolved.length > 0) checks.unresolvedVars = unresolved;
  } else {
    checks.envResolvable = true;
  }

  const latencyMs = Date.now() - start;
  const healthy = checks.binaryExists && checks.envResolvable;

  const errors: string[] = [];
  if (!checks.binaryExists) {
    const binary = capability.allowCommands?.[0] || "unknown";
    errors.push(`Binary '${binary}' not found in PATH`);
  }
  if (!checks.envResolvable && checks.unresolvedVars?.length) {
    errors.push(
      `Unresolved template vars: ${checks.unresolvedVars.join(", ")}`,
    );
  }

  return {
    service: serviceName,
    capability: capabilityName,
    healthy,
    checks,
    latencyMs,
    error: errors.length > 0 ? errors.join("; ") : undefined,
    checkedAt,
  };
}

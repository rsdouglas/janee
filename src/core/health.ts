/**
 * Health check module for Janee services
 * Provides connectivity and latency checks for configured API backends
 */

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
 * Check if a service endpoint is reachable and responding
 */
export async function checkServiceHealth(
  serviceName: string,
  baseUrl: string,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const { timeout = 5000, fetchFn = fetch } = options;
  const checkedAt = new Date().toISOString();

  if (!baseUrl) {
    return {
      service: serviceName,
      healthy: false,
      latencyMs: 0,
      error: 'No base URL configured',
      checkedAt
    };
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetchFn(baseUrl, {
      method: 'HEAD',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const latencyMs = Date.now() - start;

    // 2xx = healthy, 401/403 = reachable (auth expected), 4xx = unhealthy, 5xx = unhealthy
    const isReachable = response.ok || response.status === 401 || response.status === 403;
    
    if (isReachable) {
      return {
        service: serviceName,
        healthy: true,
        statusCode: response.status,
        latencyMs,
        checkedAt
      };
    }

    return {
      service: serviceName,
      healthy: false,
      statusCode: response.status,
      latencyMs,
      error: `HTTP ${response.status} ${response.statusText}`,
      checkedAt
    };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    return {
      service: serviceName,
      healthy: false,
      latencyMs,
      error: message,
      checkedAt
    };
  }
}

/**
 * Check health of multiple services in parallel
 */
export async function checkAllServicesHealth(
  services: Map<string, { baseUrl: string }>,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult[]> {
  const checks = Array.from(services.entries()).map(([name, config]) =>
    checkServiceHealth(name, config.baseUrl, options)
  );
  return Promise.all(checks);
}

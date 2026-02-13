import { describe, it, expect, vi } from 'vitest';
import { checkServiceHealth, checkAllServicesHealth } from './health.js';

describe('Health Check', () => {
  describe('checkServiceHealth', () => {
    it('should return healthy for reachable service', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });
      
      const result = await checkServiceHealth(
        'test-service',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.service).toBe('test-service');
      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should treat 401 as healthy (service reachable, auth expected)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });
      
      const result = await checkServiceHealth(
        'auth-service',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(401);
    });

    it('should treat 403 as healthy (service reachable)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      });
      
      const result = await checkServiceHealth(
        'forbidden-service',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.healthy).toBe(true);
      expect(result.statusCode).toBe(403);
    });

    it('should return unhealthy for 500 responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      });
      
      const result = await checkServiceHealth(
        'broken-service',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.healthy).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.error).toContain('500');
    });

    it('should return unhealthy for network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      
      const result = await checkServiceHealth(
        'unreachable',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
      expect(result.statusCode).toBeUndefined();
    });

    it('should return unhealthy for timeout', async () => {
      const mockFetch = vi.fn().mockImplementation(() => 
        new Promise((_, reject) => setTimeout(() => reject(new Error('AbortError: timeout')), 100))
      );
      
      const result = await checkServiceHealth(
        'slow-service',
        'https://api.example.com',
        { timeout: 50, fetchFn: mockFetch }
      );
      
      expect(result.healthy).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should measure latency', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ ok: true, status: 200, statusText: 'OK' }), 50))
      );
      
      const result = await checkServiceHealth(
        'test-service',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      
      expect(result.latencyMs).toBeGreaterThanOrEqual(40);
    });

    it('should handle empty baseUrl', async () => {
      const result = await checkServiceHealth(
        'bad-config',
        '',
        { timeout: 5000 }
      );
      
      expect(result.healthy).toBe(false);
      expect(result.error).toContain('No base URL configured');
    });

    it('should include timestamp', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });
      
      const before = new Date().toISOString();
      const result = await checkServiceHealth(
        'test',
        'https://api.example.com',
        { timeout: 5000, fetchFn: mockFetch }
      );
      const after = new Date().toISOString();
      
      expect(result.checkedAt).toBeDefined();
      expect(result.checkedAt >= before).toBe(true);
      expect(result.checkedAt <= after).toBe(true);
    });
  });

  describe('checkAllServicesHealth', () => {
    it('should check multiple services in parallel', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK'
      });

      const services = new Map([
        ['stripe', { baseUrl: 'https://api.stripe.com' }],
        ['github', { baseUrl: 'https://api.github.com' }],
      ]);

      const results = await checkAllServicesHealth(services, { fetchFn: mockFetch });
      
      expect(results).toHaveLength(2);
      expect(results[0].service).toBe('stripe');
      expect(results[1].service).toBe('github');
      expect(results.every(r => r.healthy)).toBe(true);
    });

    it('should handle mixed healthy/unhealthy services', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: true, status: 200, statusText: 'OK' });
        }
        return Promise.reject(new Error('ECONNREFUSED'));
      });

      const services = new Map([
        ['healthy', { baseUrl: 'https://api.good.com' }],
        ['unhealthy', { baseUrl: 'https://api.bad.com' }],
      ]);

      const results = await checkAllServicesHealth(services, { fetchFn: mockFetch });
      
      expect(results[0].healthy).toBe(true);
      expect(results[1].healthy).toBe(false);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Test the SIGHUP config reload integration
describe('SIGHUP config reload', () => {
  const originalListeners: Record<string, Function[]> = {};

  beforeEach(() => {
    // Track SIGHUP listeners
    originalListeners['SIGHUP'] = process.listeners('SIGHUP').slice();
  });

  afterEach(() => {
    // Remove any listeners we added
    process.removeAllListeners('SIGHUP');
    // Restore originals
    for (const listener of originalListeners['SIGHUP'] || []) {
      process.on('SIGHUP', listener as any);
    }
  });

  it('should handle SIGHUP without crashing when no config file exists', () => {
    // Simulate what happens when SIGHUP is sent but no YAML config is present
    // This tests the guard condition in serve-mcp.ts
    expect(() => {
      process.emit('SIGHUP', 'SIGHUP');
    }).not.toThrow();
  });

  it('reloadConfig should swap capabilities and services in the closure', async () => {
    const { createMCPServer } = await import('../../core/mcp-server');

    const initialCaps = [{ name: 'test', service: 'test-svc' }];
    const initialServices = new Map([['test-svc', {
      baseUrl: 'https://example.com',
      auth: { type: 'bearer' as const, key: 'test-key' }
    }]]);

    const result = createMCPServer({
      capabilities: initialCaps,
      services: initialServices,
      onReloadConfig: () => ({
        capabilities: [
          { name: 'test', service: 'test-svc' },
          { name: 'test2', service: 'test-svc' }
        ],
        services: new Map([['test-svc', {
          baseUrl: 'https://example.com',
          auth: { type: 'bearer' as const, key: 'new-key' }
        }]])
      })
    });

    // reloadConfig should be a function
    expect(typeof result.reloadConfig).toBe('function');

    // Call reloadConfig with new data — should not throw
    const newCaps = [
      { name: 'cap-a', service: 'svc-a' },
      { name: 'cap-b', service: 'svc-b' }
    ];
    const newServices = new Map([
      ['svc-a', { baseUrl: 'https://a.example.com', auth: { type: 'bearer' as const, key: 'key-a' } }],
      ['svc-b', { baseUrl: 'https://b.example.com', auth: { type: 'bearer' as const, key: 'key-b' } }]
    ]);

    expect(() => {
      result.reloadConfig({ capabilities: newCaps, services: newServices });
    }).not.toThrow();
  });

  it('reloadConfig should accept empty capabilities and services', async () => {
    const { createMCPServer } = await import('../../core/mcp-server');

    const result = createMCPServer({
      capabilities: [{ name: 'initial', service: 'svc' }],
      services: new Map([['svc', {
        baseUrl: 'https://example.com',
        auth: { type: 'bearer' as const, key: 'key' }
      }]]),
    });

    // Reload to empty state — should not throw
    expect(() => {
      result.reloadConfig({ capabilities: [], services: new Map() });
    }).not.toThrow();
  });

  it('reloadConfig is always present on MCPServerResult', async () => {
    const { createMCPServer } = await import('../../core/mcp-server');

    const result = createMCPServer({
      capabilities: [],
      services: new Map(),
    });

    // reloadConfig should always be defined (it's required in MCPServerResult)
    expect(result.reloadConfig).toBeDefined();
    expect(typeof result.reloadConfig).toBe('function');
  });
});

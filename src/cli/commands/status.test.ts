import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the config module
vi.mock('../config-yaml', () => ({
  getConfigDir: vi.fn(() => '/home/testuser/.janee'),
  getAuditDir: vi.fn(() => '/home/testuser/.janee/audit'),
  hasYAMLConfig: vi.fn(() => true),
  loadYAMLConfig: vi.fn(() => ({
    version: '1',
    masterKey: 'test-master-key',
    services: {
      github: { baseUrl: 'https://api.github.com', auth: { type: 'bearer', key: 'enc:xxx' } },
      stripe: { baseUrl: 'https://api.stripe.com', auth: { type: 'bearer', key: 'enc:xxx' } },
    },
    capabilities: {
      'github-read': { service: 'github', ttl: '1h' },
    },
    server: { port: 3000, host: 'localhost' },
  })),
}));

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      if (typeof p === 'string' && p.includes('sessions.json')) return true;
      if (typeof p === 'string' && p.includes('audit')) return true;
      if (typeof p === 'string' && p.includes('package.json')) return actual.existsSync(p);
      return actual.existsSync(p);
    }),
    readFileSync: vi.fn((p: string, encoding?: string) => {
      if (typeof p === 'string' && p.includes('sessions.json')) {
        const futureDate = new Date(Date.now() + 3600000).toISOString();
        const pastDate = new Date(Date.now() - 3600000).toISOString();
        return JSON.stringify([
          { id: 'sess-1', capability: 'github-read', service: 'github', createdAt: '2026-01-01T00:00:00Z', expiresAt: futureDate, revoked: false },
          { id: 'sess-2', capability: 'github-read', service: 'github', createdAt: '2026-01-01T00:00:00Z', expiresAt: pastDate, revoked: false },
          { id: 'sess-3', capability: 'github-read', service: 'github', createdAt: '2026-01-01T00:00:00Z', expiresAt: futureDate, revoked: true },
        ]);
      }
      if (typeof p === 'string' && p.endsWith('.jsonl')) {
        return '{"timestamp":"2026-01-15T10:00:00Z","action":"proxy","service":"github"}\n{"timestamp":"2026-01-15T11:00:00Z","action":"proxy","service":"stripe"}\n';
      }
      return actual.readFileSync(p, encoding as any);
    }),
    readdirSync: vi.fn((p: string) => {
      if (typeof p === 'string' && p.includes('audit')) return ['2026-01.jsonl'];
      return actual.readdirSync(p);
    }),
    statSync: vi.fn((p: string) => {
      if (typeof p === 'string' && p.endsWith('.jsonl')) return { size: 2048 };
      return actual.statSync(p);
    }),
  };
});

describe('status command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('should display status in human-readable format', async () => {
    const { statusCommand } = await import('./status');
    await statusCommand();

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Janee v');
    expect(output).toContain('Services:     2');
    expect(output).toContain('Capabilities: 1');
    expect(output).toContain('1 active');
    expect(output).toContain('🔒 enabled');
  });

  it('should display status in JSON format', async () => {
    const { statusCommand } = await import('./status');
    await statusCommand({ json: true });

    // Find the JSON output call
    const jsonCall = consoleSpy.mock.calls.find(c => {
      try {
        JSON.parse(c[0]);
        return true;
      } catch {
        return false;
      }
    });

    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0]);
    expect(parsed.services).toBe(2);
    expect(parsed.capabilities).toBe(1);
    expect(parsed.activeSessions).toBe(1);
    expect(parsed.totalSessions).toBe(3);
    expect(parsed.encrypted).toBe(true);
    expect(parsed.configExists).toBe(true);
  });

  it('should show not initialized when no config', async () => {
    // Re-import with modified mocks
    vi.resetModules();
    vi.doMock('../config-yaml', () => ({
      getConfigDir: vi.fn(() => '/home/testuser/.janee'),
      getAuditDir: vi.fn(() => '/home/testuser/.janee/audit'),
      hasYAMLConfig: vi.fn(() => false),
      loadYAMLConfig: vi.fn(),
    }));
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        existsSync: vi.fn((p: string) => {
          if (typeof p === 'string' && p.includes('package.json')) return actual.existsSync(p);
          return false;
        }),
        readFileSync: vi.fn((p: string, encoding?: string) => {
          return actual.readFileSync(p, encoding as any);
        }),
        readdirSync: vi.fn((p: string) => {
          return actual.readdirSync(p);
        }),
        statSync: vi.fn((p: string) => {
          return actual.statSync(p);
        }),
      };
    });

    const { statusCommand: freshStatusCommand } = await import('./status');
    await freshStatusCommand();

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Not initialized');
    expect(output).toContain('janee init');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock config-yaml module
vi.mock('../config-yaml', () => ({
  getConfigDir: vi.fn(() => '/tmp/janee-test-sessions'),
}));

import { getConfigDir } from '../config-yaml';
import { sessionsCommand } from './sessions';
import { revokeCommand } from './revoke';

const TEST_DIR = '/tmp/janee-test-sessions';
const SESSIONS_FILE = path.join(TEST_DIR, 'sessions.json');

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: any[]) => logs.push(args.join(' '));
  console.error = (...args: any[]) => errors.push(args.join(' '));
  return {
    logs,
    errors,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    }
  };
}

const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

function createTestSessions(sessions: any[]) {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('sessionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should show no active sessions when file does not exist', async () => {
    const cap = captureConsole();
    await sessionsCommand();
    cap.restore();
    expect(cap.logs.join(' ')).toContain('No active sessions');
  });

  it('should output empty JSON array when no sessions file and --json', async () => {
    const cap = captureConsole();
    await sessionsCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.sessions).toEqual([]);
  });

  it('should show active sessions', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    createTestSessions([{
      id: 'sess-abc123def456ghi789',
      capability: 'stripe_readonly',
      service: 'stripe',
      agentId: 'test-agent',
      reason: 'testing',
      createdAt: new Date().toISOString(),
      expiresAt: future,
      revoked: false,
    }]);
    const cap = captureConsole();
    await sessionsCommand();
    cap.restore();
    const output = cap.logs.join('\n');
    expect(output).toContain('stripe_readonly');
    expect(output).toContain('test-agent');
    expect(output).toContain('1 active session');
  });

  it('should filter out expired sessions', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    createTestSessions([{
      id: 'sess-expired123456789',
      capability: 'stripe_readonly',
      service: 'stripe',
      createdAt: new Date().toISOString(),
      expiresAt: past,
      revoked: false,
    }]);
    const cap = captureConsole();
    await sessionsCommand();
    cap.restore();
    expect(cap.logs.join(' ')).toContain('No active sessions');
  });

  it('should filter out revoked sessions', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    createTestSessions([{
      id: 'sess-revoked123456789',
      capability: 'stripe_readonly',
      service: 'stripe',
      createdAt: new Date().toISOString(),
      expiresAt: future,
      revoked: true,
    }]);
    const cap = captureConsole();
    await sessionsCommand();
    cap.restore();
    expect(cap.logs.join(' ')).toContain('No active sessions');
  });

  it('should output active sessions as JSON', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    createTestSessions([{
      id: 'sess-json123456789abc',
      capability: 'github_access',
      service: 'github',
      agentId: 'claude',
      reason: 'code review',
      createdAt: new Date().toISOString(),
      expiresAt: future,
      revoked: false,
    }]);
    const cap = captureConsole();
    await sessionsCommand({ json: true });
    cap.restore();
    const parsed = JSON.parse(cap.logs.join(''));
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].capability).toBe('github_access');
    expect(parsed.sessions[0].ttlSeconds).toBeGreaterThan(0);
  });

  it('should show multiple active sessions count', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    createTestSessions([
      { id: 'sess-multi1-123456789', capability: 'stripe', service: 'stripe', createdAt: new Date().toISOString(), expiresAt: future, revoked: false },
      { id: 'sess-multi2-123456789', capability: 'github', service: 'github', createdAt: new Date().toISOString(), expiresAt: future, revoked: false },
      { id: 'sess-multi3-123456789', capability: 'openai', service: 'openai', createdAt: new Date().toISOString(), expiresAt: future, revoked: false },
    ]);
    const cap = captureConsole();
    await sessionsCommand();
    cap.restore();
    expect(cap.logs.join(' ')).toContain('3 active sessions');
  });
});

describe('revokeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanupTestDir();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('should exit with error when no sessions file', async () => {
    const cap = captureConsole();
    try {
      await revokeCommand('sess-abc');
    } catch (e) {}
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(cap.errors.join(' ')).toContain('No sessions file');
  });

  it('should exit with error when session not found', async () => {
    createTestSessions([{
      id: 'sess-existing123456789',
      capability: 'stripe',
      service: 'stripe',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      revoked: false,
    }]);
    const cap = captureConsole();
    try {
      await revokeCommand('sess-nonexistent');
    } catch (e) {}
    cap.restore();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(cap.errors.join(' ')).toContain('Session not found');
  });

  it('should revoke session by prefix', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    createTestSessions([{
      id: 'sess-torevoke123456789',
      capability: 'stripe_readonly',
      service: 'stripe',
      agentId: 'test-agent',
      createdAt: new Date().toISOString(),
      expiresAt: future,
      revoked: false,
    }]);
    const cap = captureConsole();
    await revokeCommand('sess-torevoke');
    cap.restore();
    expect(cap.logs.join(' ')).toContain('Session revoked');

    // Verify the file was updated
    const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    expect(data[0].revoked).toBe(true);
  });

  it('should warn when session already revoked', async () => {
    createTestSessions([{
      id: 'sess-alreadyrevoked1234',
      capability: 'stripe',
      service: 'stripe',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      revoked: true,
    }]);
    const cap = captureConsole();
    await revokeCommand('sess-alreadyrevoked');
    cap.restore();
    expect(cap.logs.join(' ')).toContain('already revoked');
  });
});

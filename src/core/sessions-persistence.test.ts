import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionManager } from './sessions';

describe('SessionManager persistence bugs', () => {
  let tmpDir: string;
  let sessionsFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-session-test-'));
    sessionsFile = path.join(tmpDir, 'sessions.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('revokeSession should persist revoked state to file before removing from memory', () => {
    const mgr = new SessionManager(sessionsFile);
    const session = mgr.createSession('read:balance', 'binance', 3600);

    // Verify session was saved
    const beforeRevoke = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    expect(beforeRevoke).toHaveLength(1);
    expect(beforeRevoke[0].id).toBe(session.id);
    expect(beforeRevoke[0].revoked).toBe(false);

    // Revoke it
    const result = mgr.revokeSession(session.id);
    expect(result).toBe(true);

    // The file should show the session as revoked
    // BUG: Previously, revokeSession deleted from map before save(),
    // so the revoked session was never persisted
    const afterRevoke = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    // After revoke, the session should either be marked revoked in file
    // or at minimum, the file should reflect the revocation happened
    const revokedInFile = afterRevoke.find((s: any) => s.id === session.id);
    if (revokedInFile) {
      expect(revokedInFile.revoked).toBe(true);
    }
    // If not found, that means cleanup removed it (also acceptable)
    // But the file should NOT still show revoked: false
    const stillActive = afterRevoke.find((s: any) => s.id === session.id && !s.revoked);
    expect(stillActive).toBeUndefined();
  });

  it('listSessions should persist cleanup of expired sessions to file', () => {
    // Manually write an expired session to file
    const expiredSession = {
      id: 'jnee_sess_expired123',
      capability: 'read:balance',
      service: 'binance',
      createdAt: new Date(Date.now() - 7200000).toISOString(),
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
      revoked: false
    };
    const activeSession = {
      id: 'jnee_sess_active456',
      capability: 'write:orders',
      service: 'bybit',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      revoked: false
    };

    fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
    fs.writeFileSync(sessionsFile, JSON.stringify([expiredSession, activeSession]));

    const mgr = new SessionManager(sessionsFile);
    const active = mgr.listSessions();

    // Should only return active session
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe('jnee_sess_active456');

    // File should be cleaned up too (expired session removed)
    // BUG: Previously, listSessions deleted from map but didn't call save()
    const fileContents = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    expect(fileContents).toHaveLength(1);
    expect(fileContents[0].id).toBe('jnee_sess_active456');
  });

  it('cleanup should persist to file', () => {
    // Write mixed sessions
    const sessions = [
      {
        id: 'jnee_sess_exp1',
        capability: 'read:balance',
        service: 'binance',
        createdAt: new Date(Date.now() - 7200000).toISOString(),
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
        revoked: false
      },
      {
        id: 'jnee_sess_revoked1',
        capability: 'write:orders',
        service: 'bybit',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        revoked: true
      },
      {
        id: 'jnee_sess_active1',
        capability: 'read:positions',
        service: 'okx',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        revoked: false
      }
    ];

    fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions));

    const mgr = new SessionManager(sessionsFile);
    mgr.cleanup();

    // File should only have the active session
    const fileContents = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    expect(fileContents).toHaveLength(1);
    expect(fileContents[0].id).toBe('jnee_sess_active1');
  });

  it('session file survives process restart with correct state', () => {
    // Create a session with first manager
    const mgr1 = new SessionManager(sessionsFile);
    const session = mgr1.createSession('read:balance', 'binance', 3600);

    // Create a second manager (simulates process restart)
    const mgr2 = new SessionManager(sessionsFile);
    const loaded = mgr2.getSession(session.id);
    expect(loaded).toBeDefined();
    expect(loaded!.capability).toBe('read:balance');
    expect(loaded!.service).toBe('binance');

    // Revoke with second manager
    mgr2.revokeSession(session.id);

    // Third manager should not see the revoked session
    const mgr3 = new SessionManager(sessionsFile);
    const afterRevoke = mgr3.getSession(session.id);
    // Session should not be retrievable after revocation
    // It's either gone from file or marked revoked
    expect(afterRevoke).toBeUndefined();
  });
});

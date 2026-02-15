import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from './sessions';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SessionManager', () => {
  let tmpDir: string;
  let persistFile: string;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'janee-sessions-test-'));
    persistFile = path.join(tmpDir, 'sessions.json');
    manager = new SessionManager(persistFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('createSession', () => {
    it('should create a session with correct fields', () => {
      const session = manager.createSession('read', 'stripe', 3600);
      expect(session.id).toMatch(/^jnee_sess_/);
      expect(session.capability).toBe('read');
      expect(session.service).toBe('stripe');
      expect(session.revoked).toBe(false);
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeCloseTo(3600 * 1000, -2);
    });

    it('should accept optional agentId and reason', () => {
      const session = manager.createSession('write', 'github', 60, {
        agentId: 'agent-123',
        reason: 'deploy automation'
      });
      expect(session.agentId).toBe('agent-123');
      expect(session.reason).toBe('deploy automation');
    });

    it('should persist session to file', () => {
      manager.createSession('read', 'stripe', 3600);
      expect(fs.existsSync(persistFile)).toBe(true);
      const data = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
      expect(data).toHaveLength(1);
      expect(data[0].capability).toBe('read');
    });

    it('should generate unique session IDs', () => {
      const s1 = manager.createSession('read', 'stripe', 3600);
      const s2 = manager.createSession('read', 'stripe', 3600);
      expect(s1.id).not.toBe(s2.id);
    });
  });

  describe('getSession', () => {
    it('should retrieve an active session', () => {
      const created = manager.createSession('read', 'stripe', 3600);
      const retrieved = manager.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
    });

    it('should return undefined for non-existent session', () => {
      expect(manager.getSession('nonexistent')).toBeUndefined();
    });

    it('should return undefined for expired session', () => {
      vi.useFakeTimers();
      const session = manager.createSession('read', 'stripe', 10);
      vi.advanceTimersByTime(11000); // 11 seconds
      const retrieved = manager.getSession(session.id);
      expect(retrieved).toBeUndefined();
      vi.useRealTimers();
    });
  });

  describe('revokeSession', () => {
    it('should revoke an active session', () => {
      const session = manager.createSession('read', 'stripe', 3600);
      const result = manager.revokeSession(session.id);
      expect(result).toBe(true);
      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it('should return false for non-existent session', () => {
      expect(manager.revokeSession('nonexistent')).toBe(false);
    });

    it('should persist revocation', () => {
      const session = manager.createSession('read', 'stripe', 3600);
      manager.revokeSession(session.id);
      // Load from file — revoked session is persisted (marked as revoked)
      const data = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
      expect(data).toHaveLength(1);
      expect(data[0].revoked).toBe(true);
    });
  });

  describe('listSessions', () => {
    it('should list all active sessions', () => {
      manager.createSession('read', 'stripe', 3600);
      manager.createSession('write', 'github', 3600);
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should exclude expired sessions', () => {
      vi.useFakeTimers();
      manager.createSession('read', 'stripe', 5);
      manager.createSession('write', 'github', 3600);
      vi.advanceTimersByTime(6000);
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].capability).toBe('write');
      vi.useRealTimers();
    });

    it('should return empty array when no sessions exist', () => {
      expect(manager.listSessions()).toHaveLength(0);
    });
  });

  describe('persistence', () => {
    it('should load sessions from file on construction', () => {
      // Create a session and save
      manager.createSession('read', 'stripe', 3600);
      
      // Create new manager pointing at same file
      const manager2 = new SessionManager(persistFile);
      const sessions = manager2.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].capability).toBe('read');
    });

    it('should handle corrupt persist file gracefully', () => {
      fs.writeFileSync(persistFile, 'not-json!!!');
      // Should not throw
      const mgr = new SessionManager(persistFile);
      expect(mgr.listSessions()).toHaveLength(0);
    });

    it('should create persist directory if it does not exist', () => {
      const deepPath = path.join(tmpDir, 'a', 'b', 'c', 'sessions.json');
      const mgr = new SessionManager(deepPath);
      mgr.createSession('read', 'stripe', 3600);
      expect(fs.existsSync(deepPath)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('should remove expired sessions', () => {
      vi.useFakeTimers();
      manager.createSession('read', 'stripe', 5);
      manager.createSession('write', 'github', 3600);
      vi.advanceTimersByTime(6000);
      manager.cleanup();
      // Only the github session should remain in memory
      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      vi.useRealTimers();
    });
  });
});

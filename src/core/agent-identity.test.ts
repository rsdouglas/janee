import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentityManager } from './agent-identity';
import { verifyAgentSecret, shouldRequireVerification } from './agent-scope';

describe('verifyAgentSecret', () => {
  const registry = new Map<string, string>([
    ['claude-agent', 'secret-123'],
    ['cursor-agent', 'secret-456'],
  ]);

  it('verifies a valid agent secret', () => {
    const result = verifyAgentSecret('claude-agent', 'secret-123', registry);
    expect(result.verified).toBe(true);
    expect(result.agentId).toBe('claude-agent');
    expect(result.error).toBeUndefined();
  });

  it('rejects wrong secret', () => {
    const result = verifyAgentSecret('claude-agent', 'wrong-secret', registry);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('Invalid secret');
  });

  it('rejects unknown agent', () => {
    const result = verifyAgentSecret('unknown-agent', 'secret-123', registry);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('rejects empty secret', () => {
    const result = verifyAgentSecret('claude-agent', '', registry);
    expect(result.verified).toBe(false);
  });
});

describe('shouldRequireVerification', () => {
  it('returns false when policy is false', () => {
    expect(shouldRequireVerification(false, 'http', false, true)).toBe(false);
  });

  it('returns false when capability has no allowedAgents', () => {
    expect(shouldRequireVerification('all', 'http', false, false)).toBe(false);
  });

  it('returns false when already verified', () => {
    expect(shouldRequireVerification('all', 'http', true, true)).toBe(false);
  });

  it('blocks unverified HTTP when policy is http', () => {
    expect(shouldRequireVerification('http', 'http', false, true)).toBe(true);
  });

  it('allows unverified stdio when policy is http', () => {
    expect(shouldRequireVerification('http', 'stdio', false, true)).toBe(false);
  });

  it('blocks unverified stdio when policy is all', () => {
    expect(shouldRequireVerification('all', 'stdio', false, true)).toBe(true);
  });
});

describe('AgentIdentityManager', () => {
  let manager: AgentIdentityManager;
  const secrets = new Map<string, string>([
    ['claude-agent', 'secret-abc'],
    ['cursor-agent', 'secret-def'],
  ]);

  beforeEach(() => {
    manager = new AgentIdentityManager(secrets, 'http');
  });

  describe('verifySession', () => {
    it('verifies and tags session with correct credentials', () => {
      const result = manager.verifySession('sess-1', 'claude-agent', 'secret-abc', 'http');
      expect(result.verified).toBe(true);
      expect(manager.getVerifiedAgentId('sess-1')).toBe('claude-agent');
      expect(manager.isVerified('sess-1')).toBe(true);
    });

    it('rejects and tracks session with wrong credentials', () => {
      const result = manager.verifySession('sess-2', 'claude-agent', 'wrong', 'http');
      expect(result.verified).toBe(false);
      expect(manager.getVerifiedAgentId('sess-2')).toBeUndefined();
      expect(manager.isVerified('sess-2')).toBe(false);
    });
  });

  describe('registerSession', () => {
    it('registers unverified session', () => {
      manager.registerSession('sess-3', 'stdio');
      expect(manager.isVerified('sess-3')).toBe(false);
      expect(manager.getVerifiedAgentId('sess-3')).toBeUndefined();
    });

    it('does not overwrite existing session', () => {
      manager.verifySession('sess-4', 'claude-agent', 'secret-abc', 'http');
      manager.registerSession('sess-4', 'http');
      expect(manager.isVerified('sess-4')).toBe(true);
    });
  });

  describe('checkAccess', () => {
    it('allows verified session for restricted capability', () => {
      manager.verifySession('sess-5', 'claude-agent', 'secret-abc', 'http');
      expect(manager.checkAccess('sess-5', true)).toBeUndefined();
    });

    it('blocks unverified HTTP session for restricted capability', () => {
      manager.registerSession('sess-6', 'http');
      const error = manager.checkAccess('sess-6', true);
      expect(error).toContain('Access denied');
      expect(error).toContain('_auth');
    });

    it('allows unverified session for unrestricted capability', () => {
      manager.registerSession('sess-7', 'http');
      expect(manager.checkAccess('sess-7', false)).toBeUndefined();
    });

    it('allows unverified stdio session when policy is http', () => {
      manager.registerSession('sess-8', 'stdio');
      expect(manager.checkAccess('sess-8', true)).toBeUndefined();
    });

    it('blocks unknown session (defaults to http)', () => {
      const error = manager.checkAccess('unknown-sess', true);
      expect(error).toContain('Access denied');
    });
  });

  describe('removeSession', () => {
    it('cleans up session state', () => {
      manager.verifySession('sess-9', 'claude-agent', 'secret-abc', 'http');
      expect(manager.isVerified('sess-9')).toBe(true);
      manager.removeSession('sess-9');
      expect(manager.isVerified('sess-9')).toBe(false);
    });
  });

  describe('updateRegistry', () => {
    it('uses new registry for subsequent verifications', () => {
      // Old secret works
      expect(manager.verifySession('s1', 'claude-agent', 'secret-abc', 'http').verified).toBe(true);
      
      // Update registry with new secret
      manager.updateRegistry(new Map([['claude-agent', 'new-secret']]));
      
      // Old secret no longer works
      expect(manager.verifySession('s2', 'claude-agent', 'secret-abc', 'http').verified).toBe(false);
      
      // New secret works
      expect(manager.verifySession('s3', 'claude-agent', 'new-secret', 'http').verified).toBe(true);
    });
  });

  describe('updatePolicy', () => {
    it('changes enforcement policy', () => {
      manager.registerSession('sess-10', 'http');
      
      // With 'http' policy, blocked
      expect(manager.checkAccess('sess-10', true)).toContain('Access denied');
      
      // Update to no enforcement
      manager.updatePolicy(false);
      expect(manager.checkAccess('sess-10', true)).toBeUndefined();
    });
  });
});

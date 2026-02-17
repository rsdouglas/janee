import { describe, it, expect } from 'vitest';
import {
  canAgentAccess,
  agentCreatedOwnership,
  cliCreatedOwnership,
  grantAccess,
  revokeAccess,
  CredentialOwnership,
  AccessPolicy
} from './agent-scope';

describe('agent-scope', () => {
  describe('canAgentAccess', () => {
    it('should allow access when no ownership metadata exists (backward compat)', () => {
      expect(canAgentAccess('agent-1', undefined)).toBe(true);
      expect(canAgentAccess(undefined, undefined)).toBe(true);
    });

    it('should allow all agents with "all-agents" policy', () => {
      const ownership = cliCreatedOwnership();
      expect(canAgentAccess('agent-1', ownership)).toBe(true);
      expect(canAgentAccess('agent-2', ownership)).toBe(true);
      expect(canAgentAccess(undefined, ownership)).toBe(true);
    });

    it('should restrict to creator with "agent-only" policy', () => {
      const ownership = agentCreatedOwnership('agent-1');
      expect(canAgentAccess('agent-1', ownership)).toBe(true);
      expect(canAgentAccess('agent-2', ownership)).toBe(false);
      expect(canAgentAccess(undefined, ownership)).toBe(false);
    });

    it('should allow creator and shared agents with "shared" policy', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2', 'agent-3'],
        createdAt: new Date().toISOString()
      };

      expect(canAgentAccess('agent-1', ownership)).toBe(true);  // creator
      expect(canAgentAccess('agent-2', ownership)).toBe(true);  // shared
      expect(canAgentAccess('agent-3', ownership)).toBe(true);  // shared
      expect(canAgentAccess('agent-4', ownership)).toBe(false); // not shared
      expect(canAgentAccess(undefined, ownership)).toBe(false); // no identity
    });

    it('should handle shared policy with empty sharedWith list', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: [],
        createdAt: new Date().toISOString()
      };

      expect(canAgentAccess('agent-1', ownership)).toBe(true);
      expect(canAgentAccess('agent-2', ownership)).toBe(false);
    });

    it('should handle shared policy with undefined sharedWith', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        createdAt: new Date().toISOString()
      };

      expect(canAgentAccess('agent-1', ownership)).toBe(true);
      expect(canAgentAccess('agent-2', ownership)).toBe(false);
    });
  });

  describe('agentCreatedOwnership', () => {
    it('should default to agent-only policy', () => {
      const ownership = agentCreatedOwnership('my-agent');
      expect(ownership.createdBy).toBe('my-agent');
      expect(ownership.accessPolicy).toBe('agent-only');
      expect(ownership.sharedWith).toBeUndefined();
      expect(ownership.createdAt).toBeDefined();
    });
  });

  describe('cliCreatedOwnership', () => {
    it('should default to all-agents policy', () => {
      const ownership = cliCreatedOwnership();
      expect(ownership.createdBy).toBeUndefined();
      expect(ownership.accessPolicy).toBe('all-agents');
      expect(ownership.createdAt).toBeDefined();
    });
  });

  describe('grantAccess', () => {
    it('should upgrade agent-only to shared when granting', () => {
      const ownership = agentCreatedOwnership('agent-1');
      const updated = grantAccess(ownership, 'agent-2');

      expect(updated.accessPolicy).toBe('shared');
      expect(updated.sharedWith).toEqual(['agent-2']);
      expect(updated.createdBy).toBe('agent-1');
    });

    it('should add to sharedWith list for shared policy', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2'],
        createdAt: new Date().toISOString()
      };

      const updated = grantAccess(ownership, 'agent-3');
      expect(updated.sharedWith).toEqual(['agent-2', 'agent-3']);
    });

    it('should not duplicate agent IDs', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2'],
        createdAt: new Date().toISOString()
      };

      const updated = grantAccess(ownership, 'agent-2');
      expect(updated.sharedWith).toEqual(['agent-2']);
    });

    it('should be a no-op for all-agents policy', () => {
      const ownership = cliCreatedOwnership();
      const updated = grantAccess(ownership, 'agent-2');
      expect(updated.accessPolicy).toBe('all-agents');
    });

    it('should not mutate the original ownership object', () => {
      const ownership = agentCreatedOwnership('agent-1');
      const updated = grantAccess(ownership, 'agent-2');
      
      expect(ownership.accessPolicy).toBe('agent-only');
      expect(ownership.sharedWith).toBeUndefined();
      expect(updated.accessPolicy).toBe('shared');
    });
  });

  describe('revokeAccess', () => {
    it('should remove agent from sharedWith list', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2', 'agent-3'],
        createdAt: new Date().toISOString()
      };

      const updated = revokeAccess(ownership, 'agent-2');
      expect(updated.sharedWith).toEqual(['agent-3']);
      expect(updated.accessPolicy).toBe('shared');
    });

    it('should downgrade to agent-only when last shared agent is revoked', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2'],
        createdAt: new Date().toISOString()
      };

      const updated = revokeAccess(ownership, 'agent-2');
      expect(updated.accessPolicy).toBe('agent-only');
      expect(updated.sharedWith).toBeUndefined();
    });

    it('should be a no-op for non-shared policies', () => {
      const ownership = agentCreatedOwnership('agent-1');
      const updated = revokeAccess(ownership, 'agent-2');
      expect(updated.accessPolicy).toBe('agent-only');
    });

    it('should not mutate the original ownership object', () => {
      const ownership: CredentialOwnership = {
        createdBy: 'agent-1',
        accessPolicy: 'shared',
        sharedWith: ['agent-2'],
        createdAt: new Date().toISOString()
      };
      
      const updated = revokeAccess(ownership, 'agent-2');
      expect(ownership.sharedWith).toEqual(['agent-2']);
      expect(ownership.accessPolicy).toBe('shared');
    });
  });
});

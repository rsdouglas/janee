/**
 * Agent-scoped credential management for Janee
 * 
 * When an agent creates a credential via MCP, it is automatically scoped
 * to that agent. Other agents cannot access it unless the owner (or an admin)
 * explicitly grants access.
 * 
 * Access policies:
 * - "agent-only": Only the creating agent can access (default for agent-created creds)
 * - "all-agents": Any agent can access (default for CLI-created creds)  
 * - "shared": Specific agents listed in `sharedWith` can access
 */

export type AccessPolicy = 'agent-only' | 'all-agents' | 'shared';

export interface CredentialOwnership {
  /** Agent ID that created the credential (undefined = created via CLI) */
  createdBy?: string;
  /** Access policy controlling who can use this credential */
  accessPolicy: AccessPolicy;
  /** List of agent IDs that can access (only used when policy is "shared") */
  sharedWith?: string[];
  /** Timestamp when the credential was created */
  createdAt: string;
}

/**
 * Default ownership for credentials created via CLI (human admin)
 */
export function cliCreatedOwnership(): CredentialOwnership {
  return {
    accessPolicy: 'all-agents',
    createdAt: new Date().toISOString()
  };
}

/**
 * Default ownership for credentials created by an agent via MCP
 */
export function agentCreatedOwnership(agentId: string): CredentialOwnership {
  return {
    createdBy: agentId,
    accessPolicy: 'agent-only',
    createdAt: new Date().toISOString()
  };
}

/**
 * Check whether an agent is allowed to access a credential
 * 
 * Rules:
 * 1. If no ownership metadata exists, allow access (backward compat)
 * 2. "all-agents" policy: always allow
 * 3. "agent-only" policy: only the creator
 * 4. "shared" policy: creator + listed agents
 */
export function canAgentAccess(
  agentId: string | undefined,
  ownership: CredentialOwnership | undefined
): boolean {
  // No ownership metadata = legacy credential, allow all
  if (!ownership) return true;

  // All-agents policy = unrestricted
  if (ownership.accessPolicy === 'all-agents') return true;

  // Agent must identify themselves for restricted policies
  if (!agentId) return false;

  // Agent-only: must be the creator
  if (ownership.accessPolicy === 'agent-only') {
    return ownership.createdBy === agentId;
  }

  // Shared: creator or in the shared list
  if (ownership.accessPolicy === 'shared') {
    if (ownership.createdBy === agentId) return true;
    return ownership.sharedWith?.includes(agentId) ?? false;
  }

  return false;
}

/**
 * Grant access to another agent (changes policy to "shared" if needed)
 */
export function grantAccess(
  ownership: CredentialOwnership,
  targetAgentId: string
): CredentialOwnership {
  const updated = { ...ownership };
  
  if (updated.accessPolicy === 'agent-only') {
    updated.accessPolicy = 'shared';
    updated.sharedWith = [targetAgentId];
  } else if (updated.accessPolicy === 'shared') {
    if (!updated.sharedWith) updated.sharedWith = [];
    if (!updated.sharedWith.includes(targetAgentId)) {
      updated.sharedWith.push(targetAgentId);
    }
  }
  // "all-agents" doesn't need grants

  return updated;
}

/**
 * Revoke access from an agent
 */
export function revokeAccess(
  ownership: CredentialOwnership,
  targetAgentId: string
): CredentialOwnership {
  const updated = { ...ownership };

  if (updated.accessPolicy === 'shared' && updated.sharedWith) {
    updated.sharedWith = updated.sharedWith.filter(id => id !== targetAgentId);
    // If no one is shared with, revert to agent-only
    if (updated.sharedWith.length === 0) {
      updated.accessPolicy = 'agent-only';
      delete updated.sharedWith;
    }
  }

  return updated;
}

/**
 * Hardened Agent Identity Module (issue #96)
 * 
 * Provides session-bound verified authentication for MCP agents.
 * Agents prove identity during connection by providing a secret that
 * matches their registered entry in the YAML config.
 * 
 * Flow:
 * 1. Agent sends _auth.agentId + _auth.secret in initialize request
 * 2. Server verifies against agent registry
 * 3. Session is tagged with verifiedAgentId
 * 4. All subsequent tool calls use verifiedAgentId for access control
 */

import { verifyAgentSecret, shouldRequireVerification, type RequireVerifiedIdentity, type AgentVerificationResult } from './agent-scope.js';

/**
 * Per-session identity state.
 * Stored in memory, keyed by MCP session ID.
 */
export interface SessionIdentity {
  /** MCP session ID */
  sessionId: string;
  /** Verified agent ID (undefined if not verified) */
  verifiedAgentId?: string;
  /** Transport type for policy enforcement */
  transportType: 'stdio' | 'http';
  /** Timestamp of verification */
  verifiedAt?: Date;
}

/**
 * Agent Identity Manager
 * 
 * Tracks verified identities per session and enforces verification
 * policies on tool calls.
 */
export class AgentIdentityManager {
  private sessions: Map<string, SessionIdentity> = new Map();
  private agentSecrets: Map<string, string>;
  private policy: RequireVerifiedIdentity;

  constructor(
    agentSecrets: Map<string, string>,
    policy: RequireVerifiedIdentity = false
  ) {
    this.agentSecrets = agentSecrets;
    this.policy = policy;
  }

  /**
   * Attempt to verify an agent's identity for a session.
   * Called during MCP initialize when _auth is present.
   */
  verifySession(
    sessionId: string,
    agentId: string,
    secret: string,
    transportType: 'stdio' | 'http' = 'http'
  ): AgentVerificationResult {
    const result = verifyAgentSecret(agentId, secret, this.agentSecrets);

    if (result.verified) {
      this.sessions.set(sessionId, {
        sessionId,
        verifiedAgentId: agentId,
        transportType,
        verifiedAt: new Date()
      });
    } else {
      // Still track session, just not verified
      this.sessions.set(sessionId, {
        sessionId,
        transportType
      });
    }

    return result;
  }

  /**
   * Register a session without verification (e.g., stdio without _auth).
   */
  registerSession(sessionId: string, transportType: 'stdio' | 'http'): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, { sessionId, transportType });
    }
  }

  /**
   * Get the verified agent ID for a session.
   * Returns undefined if session is not verified.
   */
  getVerifiedAgentId(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.verifiedAgentId;
  }

  /**
   * Check if a session is verified.
   */
  isVerified(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.verifiedAgentId !== undefined;
  }

  /**
   * Check if a tool call should be blocked due to missing verification.
   * 
   * @param sessionId - The MCP session ID
   * @param capabilityHasAllowedAgents - Whether the target capability has allowedAgents restrictions
   * @returns Error message if blocked, undefined if allowed
   */
  checkAccess(sessionId: string, capabilityHasAllowedAgents: boolean): string | undefined {
    const session = this.sessions.get(sessionId);
    const transportType = session?.transportType ?? 'http';
    const isVerified = session?.verifiedAgentId !== undefined;

    if (shouldRequireVerification(this.policy, transportType, isVerified, capabilityHasAllowedAgents)) {
      return `Access denied: this capability requires verified agent identity. ` +
        `Send _auth.agentId and _auth.secret during MCP initialize to authenticate.`;
    }

    return undefined;
  }

  /**
   * Clean up session state.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Update the agent registry (e.g., after config reload).
   */
  updateRegistry(agentSecrets: Map<string, string>): void {
    this.agentSecrets = agentSecrets;
  }

  /**
   * Update the verification policy.
   */
  updatePolicy(policy: RequireVerifiedIdentity): void {
    this.policy = policy;
  }
}

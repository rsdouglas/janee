/**
 * Agent Registry — verified identity for HTTP-connected agents
 *
 * Provides secret-based authentication during MCP initialize handshake.
 * Agents registered here can prove their identity with a shared secret,
 * which gets stored as `verifiedAgentId` (Priority 1) in the session.
 *
 * ## Trust model
 *
 * - stdio clients: trusted by transport (clientInfo.name is sufficient)
 * - HTTP clients: self-reported clientInfo.name is untrusted unless
 *   verified via this registry
 *
 * ## Config format
 *
 * ```yaml
 * agents:
 *   creature:secure:
 *     secret: ENC[aes256gcm,data:...,iv:...,tag:...]
 *   creature:voyager:
 *     secret: ENC[aes256gcm,data:...,iv:...,tag:...]
 *
 * server:
 *   requireVerifiedIdentity: http  # "http" | "all" | false
 * ```
 */

import crypto from 'crypto';
import { decryptSecret } from './crypto.js';

export interface AgentRegistryEntry {
  /** The plaintext shared secret (decrypted at load time) */
  secret: string;
}

export interface AgentRegistry {
  /** Map from agentId to registry entry */
  agents: Map<string, AgentRegistryEntry>;
  /** Enforcement mode */
  requireVerifiedIdentity: 'http' | 'all' | false;
}

/**
 * Parse agent registry from config.yaml agents section.
 *
 * @param agentsConfig - Raw `agents` section from config.yaml
 * @param serverConfig - Raw `server` section from config.yaml
 * @param masterKey - Master encryption key for decrypting secrets
 */
export function loadAgentRegistry(
  agentsConfig: Record<string, { secret: string }> | undefined,
  serverConfig: { requireVerifiedIdentity?: string | boolean } | undefined,
  masterKey: string | undefined
): AgentRegistry {
  const agents = new Map<string, AgentRegistryEntry>();

  if (agentsConfig && masterKey) {
    for (const [agentId, entry] of Object.entries(agentsConfig)) {
      if (!entry.secret) {
        throw new Error(`Agent "${agentId}" is missing a secret in config`);
      }
      // Decrypt the stored secret
      const plainSecret = decryptSecret(entry.secret, masterKey);
      agents.set(agentId, { secret: plainSecret });
    }
  }

  // Parse enforcement mode
  let requireVerifiedIdentity: 'http' | 'all' | false = false;
  if (serverConfig?.requireVerifiedIdentity) {
    const val = serverConfig.requireVerifiedIdentity;
    if (val === 'http' || val === 'all') {
      requireVerifiedIdentity = val;
    } else if (val === true) {
      requireVerifiedIdentity = 'http'; // boolean true defaults to http-only
    }
  }

  return { agents, requireVerifiedIdentity };
}

/**
 * Verify an agent's secret during MCP initialize.
 *
 * @param registry - Loaded agent registry
 * @param claimedAgentId - The clientInfo.name from the initialize handshake
 * @param providedSecret - The secret from params._auth.secret
 * @returns The verified agentId if auth succeeds, undefined otherwise
 */
export function verifyAgentAuth(
  registry: AgentRegistry,
  claimedAgentId: string,
  providedSecret: string | undefined
): { verified: boolean; agentId?: string; error?: string } {
  const entry = registry.agents.get(claimedAgentId);

  // Agent not in registry — no verification possible
  if (!entry) {
    if (registry.requireVerifiedIdentity === 'all' || registry.requireVerifiedIdentity === 'http') {
      // If enforcement is on but no agents are registered, allow through
      // (only enforce when the agent IS registered but fails auth)
      if (registry.agents.size === 0) {
        return { verified: false };
      }
      return { verified: false, error: `Agent "${claimedAgentId}" is not registered` };
    }
    // No enforcement — allow unverified
    return { verified: false };
  }

  // Agent is registered — secret is required
  if (!providedSecret) {
    return { verified: false, error: `Agent "${claimedAgentId}" is registered but no secret provided` };
  }

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(entry.secret, 'utf8');
  const provided = Buffer.from(providedSecret, 'utf8');

  if (expected.length !== provided.length) {
    return { verified: false, error: 'Invalid agent secret' };
  }

  if (!crypto.timingSafeEqual(expected, provided)) {
    return { verified: false, error: 'Invalid agent secret' };
  }

  return { verified: true, agentId: claimedAgentId };
}

/**
 * Generate a random agent secret suitable for registration.
 */
export function generateAgentSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

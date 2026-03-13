/**
 * Tests for agent-registry: verified agent identity
 */

import { describe, it, expect } from 'vitest';
import {
  loadAgentRegistry,
  verifyAgentAuth,
  generateAgentSecret,
  type AgentRegistry,
} from './agent-registry.js';

// We need to test without actual encryption for unit tests
// Create a mock registry directly instead of going through loadAgentRegistry with encryption

function makeRegistry(
  agents: Record<string, string>,
  mode: 'http' | 'all' | false = false
): AgentRegistry {
  const map = new Map<string, { secret: string }>();
  for (const [id, secret] of Object.entries(agents)) {
    map.set(id, { secret });
  }
  return { agents: map, requireVerifiedIdentity: mode };
}

describe('verifyAgentAuth', () => {
  it('verifies a correct secret', () => {
    const registry = makeRegistry({ 'agent:alpha': 'secret123' });
    const result = verifyAgentAuth(registry, 'agent:alpha', 'secret123');
    expect(result.verified).toBe(true);
    expect(result.agentId).toBe('agent:alpha');
    expect(result.error).toBeUndefined();
  });

  it('rejects an incorrect secret', () => {
    const registry = makeRegistry({ 'agent:alpha': 'secret123' });
    const result = verifyAgentAuth(registry, 'agent:alpha', 'wrong');
    expect(result.verified).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects missing secret for registered agent', () => {
    const registry = makeRegistry({ 'agent:alpha': 'secret123' });
    const result = verifyAgentAuth(registry, 'agent:alpha', undefined);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('no secret provided');
  });

  it('allows unregistered agent when no enforcement', () => {
    const registry = makeRegistry({ 'agent:alpha': 'secret123' }, false);
    const result = verifyAgentAuth(registry, 'agent:beta', undefined);
    expect(result.verified).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('rejects unregistered agent when enforcement is on', () => {
    const registry = makeRegistry({ 'agent:alpha': 'secret123' }, 'http');
    const result = verifyAgentAuth(registry, 'agent:beta', undefined);
    expect(result.verified).toBe(false);
    expect(result.error).toContain('not registered');
  });

  it('allows unregistered when enforcement on but no agents registered', () => {
    const registry = makeRegistry({}, 'http');
    const result = verifyAgentAuth(registry, 'agent:beta', undefined);
    expect(result.verified).toBe(false);
    expect(result.error).toBeUndefined();
  });
});

describe('loadAgentRegistry', () => {
  it('parses enforcement mode from server config', () => {
    const reg = loadAgentRegistry(undefined, { requireVerifiedIdentity: 'http' }, undefined);
    expect(reg.requireVerifiedIdentity).toBe('http');
    expect(reg.agents.size).toBe(0);
  });

  it('defaults enforcement to false', () => {
    const reg = loadAgentRegistry(undefined, undefined, undefined);
    expect(reg.requireVerifiedIdentity).toBe(false);
  });

  it('treats boolean true as http mode', () => {
    const reg = loadAgentRegistry(undefined, { requireVerifiedIdentity: true }, undefined);
    expect(reg.requireVerifiedIdentity).toBe('http');
  });
});

describe('generateAgentSecret', () => {
  it('generates a base64url string', () => {
    const secret = generateAgentSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it('generates unique secrets', () => {
    const s1 = generateAgentSecret();
    const s2 = generateAgentSecret();
    expect(s1).not.toBe(s2);
  });
});

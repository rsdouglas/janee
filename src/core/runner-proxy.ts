/**
 * Runner proxy -- MCP client that forwards tool calls to a remote Authority.
 * Uses raw HTTP + SSE parsing to forward MCP tool calls.
 *
 * Maintains per-agent sessions so the Authority sees the real agent identity
 * (e.g. "creature:patch"), not the Runner's own name.
 */

import { DEFAULT_TIMEOUT_MS } from './types.js';

const agentSessions = new Map<string, string>();

function parseSSE(text: string): any {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

/**
 * Get or create an Authority session for the given agent identity.
 * Each unique agentId gets its own MCP session so the Authority can
 * enforce per-agent access control correctly.
 */
async function ensureAuthoritySession(authorityUrl: string, clientName: string): Promise<string> {
  const cached = agentSessions.get(clientName);
  if (cached) return cached;

  const res = await fetch(`${authorityUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: clientName, version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  let sid = res.headers.get('mcp-session-id');
  if (!sid) {
    const text = await res.text();
    const json = parseSSE(text);
    if (json?.error?.message?.includes('already initialized') && json?.error?.data?.sessionId) {
      sid = json.error.data.sessionId;
    }
  }

  if (sid) agentSessions.set(clientName, sid);
  return sid || '';
}

/**
 * Forward an MCP tool call to the Authority and return the result.
 * Uses the agentId to select the right Authority session so access control
 * sees the real agent identity, not the Runner's.
 */
export async function forwardToolCall(
  authorityUrl: string,
  clientName: string,
  toolName: string,
  args: Record<string, unknown>,
  _retry = false,
): Promise<unknown> {
  const sid = await ensureAuthoritySession(authorityUrl, clientName);

  const res = await fetch(`${authorityUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(sid ? { 'Mcp-Session-Id': sid } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!res.ok) {
    if (!_retry && (res.status === 400 || res.status === 404)) {
      agentSessions.delete(clientName);
      return forwardToolCall(authorityUrl, clientName, toolName, args, true);
    }
    const text = await res.text();
    throw new Error(`Authority HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const json = parseSSE(text);
  if (json.error) {
    if (!_retry && json.error.message?.includes('session')) {
      agentSessions.delete(clientName);
      return forwardToolCall(authorityUrl, clientName, toolName, args, true);
    }
    throw new Error(`Authority error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

/** Reset all cached authority sessions (e.g. on config reload). */
export function resetAuthoritySession(): void {
  agentSessions.clear();
}

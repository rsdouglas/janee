/**
 * Runner proxy -- MCP client that forwards tool calls to a remote Authority.
 * Uses raw HTTP + SSE parsing to forward MCP tool calls.
 */

let authoritySessionId: string | null = null;

function parseSSE(text: string): any {
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6));
    }
  }
  return JSON.parse(text);
}

async function ensureAuthoritySession(authorityUrl: string, runnerName: string): Promise<string> {
  if (authoritySessionId) return authoritySessionId;

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
        clientInfo: { name: runnerName, version: '1.0' },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  const sid = res.headers.get('mcp-session-id');
  if (sid) {
    authoritySessionId = sid;
  } else {
    const text = await res.text();
    const json = parseSSE(text);
    if (json?.error?.message?.includes('already initialized') && json?.error?.data?.sessionId) {
      authoritySessionId = json.error.data.sessionId;
    }
  }

  return authoritySessionId || '';
}

/**
 * Forward an MCP tool call to the Authority and return the result.
 * Handles session expiry with one retry.
 */
export async function forwardToolCall(
  authorityUrl: string,
  runnerName: string,
  toolName: string,
  args: Record<string, unknown>,
  _retry = false,
): Promise<unknown> {
  const sid = await ensureAuthoritySession(authorityUrl, runnerName);

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
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    if (!_retry && (res.status === 400 || res.status === 404)) {
      authoritySessionId = null;
      return forwardToolCall(authorityUrl, runnerName, toolName, args, true);
    }
    const text = await res.text();
    throw new Error(`Authority HTTP ${res.status}: ${text}`);
  }

  const text = await res.text();
  const json = parseSSE(text);
  if (json.error) {
    if (!_retry && json.error.message?.includes('session')) {
      authoritySessionId = null;
      return forwardToolCall(authorityUrl, runnerName, toolName, args, true);
    }
    throw new Error(`Authority error: ${json.error.message || JSON.stringify(json.error)}`);
  }
  return json.result;
}

/** Reset the cached authority session (e.g. on config reload). */
export function resetAuthoritySession(): void {
  authoritySessionId = null;
}

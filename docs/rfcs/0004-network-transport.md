# RFC-0004: Network Transport for Containerized Agent Deployments

**Status:** Implemented
**Author:** Janus
**Created:** 2026-02-10
**Implemented:** 2026-02-11
**Tracking Issue:** #28

## Implementation Note

This RFC originally specified SSE (Server-Sent Events) transport. During implementation (2026-02-11), we discovered that `SSEServerTransport` was deprecated in MCP SDK v1.25.3 with the following guidance:

> "@deprecated SSEServerTransport is deprecated. Use StreamableHTTPServerTransport instead."

**What changed:**
- **Server**: Uses `StreamableHTTPServerTransport` (not `SSEServerTransport`)
- **Client**: Uses `StreamableHTTPClientTransport` (not `SSEClientTransport`)
- **CLI flag**: `--transport http` (not `--transport sse`)
- **Protocol**: Streamable HTTP with SSE as one transport method (more flexible)

**Why StreamableHTTP is better:**
- Supports both SSE streaming AND direct HTTP responses
- Better standards compliance and future-proofing
- Recommended by MCP SDK maintainers as the current standard
- Functionally equivalent for our use case (containerized deployments)

The core functionality described in this RFC remains unchanged - agents can connect to Janee over HTTP instead of requiring local installation.

## Summary

Add HTTP network transport support to Janee's MCP server implementation (the `janee serve` command) and the OpenClaw plugin, enabling containerized agents to connect to a host-side Janee instance over the network instead of requiring Janee to be installed inside the container.

**Note:** Original RFC specified SSE transport. Implementation uses StreamableHTTP (see Implementation Note above). Sections below preserve original SSE terminology for historical context.

## Motivation

### The Problem: Containers Break the Current Architecture

**Current architecture (stdio-based):**
```
┌─────────────────────────────────────┐
│  Agent Process (OpenClaw)           │
│  ┌────────────────────────────────┐ │
│  │ janee-openclaw plugin          │ │
│  │ spawns: janee serve (stdio)    │ │
│  └────────────────────────────────┘ │
│                                     │
│  Requires: Janee installed locally  │
│           ~/.janee/config.yaml      │
└─────────────────────────────────────┘
```

This works fine when the agent runs directly on the host, but breaks in containerized deployments:

**Containerized agent:**
```
┌──────────────────────────────────────┐
│  Docker Container (agent)            │
│  - No access to host filesystem      │
│  - No Janee binary                   │
│  - No ~/.janee/config.yaml           │
│                                      │
│  To make it work, you must:          │
│  ✗ Install Janee inside container    │
│  ✗ Mount config (with secrets!) in   │
│  ✗ Defeats Janee's security model    │
└──────────────────────────────────────┘
```

### The Use Case

**User:** @mkoorn running OpenClaw in a hardened Docker container (Sysbox runtime)

**Requirements:**
- Read-only rootfs
- All capabilities dropped
- No host bind mounts (security)
- Agent should never see API keys or master key

**Desired architecture:**
```
┌─────────────────────────┐          ┌──────────────────────────┐
│  Host                   │          │  Docker Container        │
│                         │          │                          │
│  janee serve            │◄─────────┤  Agent (OpenClaw)        │
│  --transport http       │   HTTP   │  janee-openclaw plugin   │
│  --port 9100            │          │  config: {               │
│                         │          │    url: "http://host:9100"│
│  Has:                   │          │  }                       │
│  - Master key           │          │                          │
│  - Encrypted creds      │          │  Has:                    │
│  - ~/.janee/config.yaml │          │  - Nothing! (as intended)│
└─────────────────────────┘          └──────────────────────────┘
```

### Why This Matters

Containerized agent deployments are increasingly common:
- **Security hardening:** Least-privilege containers, no host filesystem access
- **Cloud deployments:** Agents run in Kubernetes pods, ECS tasks, etc.
- **Multi-agent systems:** Multiple agents sharing one Janee instance
- **Compliance:** Separation of secrets from compute (SOC2, PCI-DSS)

Janee's core value prop is "keep secrets out of the agent's environment" — but the current stdio-only transport forces you to put Janee (and thus all secrets) **into** the container.

## Design

### Goals

1. **Preserve stdio as default** — Don't break existing workflows
2. **Support HTTP/SSE transport** — Enable network-based connections for on-host container communication
3. **Minimal API changes** — Leverage MCP SDK built-in transports
4. **Localhost-only by default** — Bind to `localhost` by default; no public IP support

### MCP SDK Transport Support

The MCP SDK (v1.26.0) already includes multiple transport implementations:

**Server transports:**
- `StdioServerTransport` (current)
- `SSEServerTransport` (Server-Sent Events)
- `StreamableHTTPServerTransport` (HTTP streaming)
- `WebSocketServerTransport`

**Client transports:**
- `StdioClientTransport` (current)
- `SSEClientTransport`
- `StreamableHTTPClientTransport`
- `WebSocketClientTransport`

**Recommendation:** Start with **SSE** (Server-Sent Events):
- ✅ Built into MCP SDK
- ✅ Simple HTTP-based protocol
- ✅ Works through firewalls/proxies
- ✅ No websocket infrastructure required
- ✅ Unidirectional (server → client) with HTTP POST for requests

### Protocol Wire Format

**⚠️ Note:** Verify current MCP SDK recommendation before implementation—SSE transport may have been superseded by StreamableHTTP in newer versions.

MCP SSE transport uses:
- **Server→Client**: SSE event stream for server-initiated messages
- **Client→Server**: HTTP POST for client requests
- **Message Format**: JSON-RPC 2.0 messages
- **Endpoint**: Single endpoint (shown as `/mcp` in examples, but SDK-specific path needs confirmation)

The SDK's `SSEServerTransport` constructor typically takes an endpoint path and Express app instance. Implementation details should be verified against current SDK documentation.

**Decision needed before implementation:** Confirm actual endpoint paths and message format used by `SSEServerTransport` in MCP SDK v1.26.0+.

---

## Implementation

### Phase 1: Server-Side (`janee serve`)

#### CLI Changes

Add `--transport` and `--port` flags:

```bash
janee serve                                # stdio (default, unchanged)
janee serve --transport sse --port 9101    # SSE listener on :9101
janee serve --transport stdio              # explicit stdio
```

**Note:** Port 9101 is used as an example. Choose any available port for your deployment.

#### Code Changes

**In `src/cli/commands/serve-mcp.ts`:**

```typescript
import { Command } from 'commander';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import express from 'express';
import { createMCPServer } from '../../core/mcp-server.js';

export function serveMCPCommand(program: Command): void {
  program
    .command('serve')
    .description('Start Janee MCP server')
    .option('-t, --transport <type>', 'Transport type (stdio|sse)', 'stdio')
    .option('-p, --port <number>', 'Port for network transport', '9100')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .action(async (options) => {
      const { transport, port, host } = options;

      // Create MCP server (logic unchanged)
      const mcpServer = createMCPServer({
        capabilities,
        services,
        sessionManager,
        auditLogger,
        onExecute,
        onReloadConfig
      });

      if (transport === 'sse') {
        // SSE transport - HTTP endpoint
        const app = express();
        app.use(express.json());

        const sseTransport = new SSEServerTransport('/mcp', app);
        await mcpServer.connect(sseTransport);

        app.listen(parseInt(port), host, () => {
          console.error(`Janee MCP server listening on http://${host}:${port}/mcp`);
        });
      } else {
        // Default: stdio transport (unchanged)
        const stdioTransport = new StdioServerTransport();
        await mcpServer.connect(stdioTransport);
        console.error('Janee MCP server started (stdio)');
      }
    });
}
```

**Dependencies to add:**
```json
{
  "dependencies": {
    "express": "^4.18.0"
  }
}
```

---

### Phase 2: Client-Side (`janee-openclaw` plugin)

#### Plugin Config Schema

Add optional `url` field:

```json
{
  "id": "janee-openclaw",
  "name": "Janee",
  "configSchema": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "Janee server URL (e.g., http://172.30.0.1:9100/mcp). Omit to use local stdio."
      }
    }
  }
}
```

**Configuration Validation:**
- `url` and `command` are mutually exclusive (if both present, `url` takes precedence)
- Supported URL schemes: `http://` only (localhost/bridge networking, no TLS)
- Connection timeout: 30 seconds (configurable)
- Retry behavior: Exponential backoff with max 3 attempts
- If connection fails after retries, error is propagated to agent (no silent fallback to stdio)

#### Plugin Code Changes

**In `packages/openclaw-plugin/src/index.ts`:**

```typescript
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export async function createJaneeTools(context, config) {
  const { url } = config || {};

  let transport;
  if (url) {
    // Network transport: connect to remote Janee instance
    transport = new SSEClientTransport(new URL(url));
  } else {
    // Local transport: spawn janee serve as subprocess (current behavior)
    transport = new StdioClientTransport({
      command: 'janee',
      args: ['serve']
    });
  }

  const client = new Client({
    name: 'janee-openclaw',
    version: '0.3.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);

  // Rest unchanged: register janee_list_services, janee_execute, etc.
  // ...
}
```

---

## Example Usage

### Setup: Host-Side Janee

```bash
# On the host machine
npm install -g @true-and-useful/janee
janee init
janee add stripe --auth-type bearer --key sk_live_...

# Start Janee in network mode (see security note below before using 0.0.0.0)
janee serve --transport sse --port 9101 --host localhost
# Janee MCP server listening on http://localhost:9101/mcp
```

### Setup: Containerized Agent

**Docker network discovery varies by platform:**

**Linux (Docker bridge network):**
```bash
# Discover bridge gateway IP (often 172.17.0.1)
docker network inspect bridge | grep Gateway

# Start Janee bound to bridge IP or 0.0.0.0 (see security warning)
janee serve --transport sse --port 9101 --host 0.0.0.0

# Container config
url: "http://172.17.0.1:9101/mcp"
```

**macOS (Docker Desktop):**
```bash
# macOS uses VM networking; direct bridge IPs often aren't reachable
# Use special DNS name instead
janee serve --transport sse --port 9101 --host localhost

# Container config
url: "http://host.docker.internal:9101/mcp"
```

**Docker Compose:**
```yaml
# docker-compose.yml
services:
  agent:
    image: my-agent
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - JANEE_URL=http://host.docker.internal:9101/mcp
```

**OpenClaw config example (Linux):**
```yaml
extensions:
  - id: janee-openclaw
    enabled: true
    config:
      url: "http://172.17.0.1:9101/mcp"
```

**Agent workflow:**
```
Agent: "List available services"
→ janee-openclaw calls janee_list_services over HTTP
→ Janee responds with ["stripe"]

Agent: "Get recent Stripe customers"
→ janee-openclaw calls janee_execute(capability: "stripe", path: "/v1/customers")
→ Janee proxies to Stripe API with decrypted key
→ Response returned to agent

Agent never sees the Stripe API key!
```

---

## Security Considerations

### Security Model (Localhost/Bridge Networking Only)

**Default binding: `localhost`**
```bash
janee serve --transport sse  # binds to 127.0.0.1 only
```

**Trust model:**
- Same as current stdio: anyone who can connect is trusted
- Suitable for trusted local connections (container → host on same machine)
- Not suitable for public networks (no auth yet)

**⚠️ WARNING: Network Exposure Risk**

Binding to `0.0.0.0` (via `--host 0.0.0.0`) exposes Janee to **all containers** sharing the Docker bridge network and potentially other machines on your network. Any container can connect and access configured API credentials.

**Only use non-localhost binding when:**
- All containers on the network are trusted, OR
- Docker network ACLs restrict access to specific containers, OR
- Host firewall rules limit connections to specific IPs

**Recommended configuration:**
```bash
# Safe: localhost only (requires platform-specific host access like host.docker.internal)
janee serve --transport sse --port 9101 --host localhost

# Docker Linux: bind to bridge IP only (more restrictive than 0.0.0.0)
janee serve --transport sse --port 9101 --host 172.17.0.1

# Unsafe: all interfaces (only if network is isolated)
janee serve --transport sse --port 9101 --host 0.0.0.0
```

For most use cases, keep `--host localhost` and use platform-specific host access (`host.docker.internal` on macOS, bridge gateway IP on Linux).

### Out of Scope: Public Network Access & Authentication

**Explicitly NOT supported:** Public IP binding and authentication are out of scope for this RFC.

Janee network transport is designed exclusively for **on-host container-to-host communication** using localhost or Docker bridge networking. The use case is:

- Agent container on **same physical machine** as Janee
- Connection via `localhost`, `host.docker.internal`, or bridge gateway IP (172.17.0.1)
- Trust boundary is the physical host

**We will NOT implement:**
- Bearer token authentication
- TLS/HTTPS support
- Public IP exposure scenarios
- Cross-host networking
- Multi-tenant access control

**Rationale:**
- Janee is a **single-user local tool**, not a network service
- Adding authentication increases attack surface and complexity
- Users who need cross-host access should use SSH tunnels, VPNs, or a proper secrets service (HashiCorp Vault)
- Binding to public IPs defeats Janee's security model (keep secrets local)

If remote access is needed, the recommended approach is SSH port forwarding:
```bash
# On remote host
ssh -L 9101:localhost:9101 user@host

# Then connect to localhost:9101
```

### Audit Logging

No changes needed — existing audit logger (`AuditLogger`) logs every request regardless of transport.

---

## Adoption Path

### For Local Users (No Change Required)

```bash
# This continues to work exactly as before
janee serve  # stdio by default
```

OpenClaw plugin with no config still spawns `janee serve` as a subprocess.

### For Container Users (Opt-In)

**Step 1:** Start Janee on host
```bash
janee serve --transport sse --port 9100
```

**Step 2:** Configure plugin to connect over network
```yaml
extensions:
  - id: janee-openclaw
    config:
      url: "http://host.docker.internal:9100/mcp"  # or 172.30.0.1
```

**Step 3:** Agent connects to remote Janee (no secrets in container)

---

## Alternatives Considered

### Option 1: WebSocket Transport

**Pros:**
- Full duplex (bidirectional)
- Lower latency

**Cons:**
- Requires websocket infrastructure (reverse proxies, firewalls)
- Overkill for Janee's request-response pattern
- MCP's SSE transport already handles bidirectional via POST

**Decision:** Start with SSE (simpler), add WebSocket later if needed.

### Option 2: gRPC

**Pros:**
- Efficient binary protocol
- Strong typing

**Cons:**
- Not part of MCP SDK (custom implementation required)
- Adds complexity (protobuf, codegen)
- HTTP/SSE is simpler and sufficient

**Decision:** Stick with MCP SDK built-in transports.

### Option 3: Unix Domain Sockets

**Pros:**
- Fast local IPC
- No network ports

**Cons:**
- Doesn't work for container → host communication (need host bind mount)
- Defeats the purpose (no secrets in container)

**Decision:** Use network transports (HTTP/SSE).

---

## Drawbacks

1. **Increased attack surface**: Network listening exposes Janee to any process that can connect, unlike stdio which only exposes to spawned child processes. Misconfiguration (binding to `0.0.0.0`) can expose API keys to untrusted containers.

2. **Operational complexity**: Users must manage `janee serve` process lifecycle (systemd, Docker Compose health checks, process supervision). Stdio subprocess model handled this automatically.

3. **Network configuration burden**: Docker networking varies significantly by platform (Linux bridge IPs vs macOS `host.docker.internal`), requiring platform-specific documentation and troubleshooting.

4. **Error handling complexity**: Network failures (timeouts, connection drops, DNS issues) are harder to diagnose than stdio pipe failures. Adds retry logic, timeouts, and connection pooling concerns.

---

## Unresolved Questions

1. **Multiple concurrent clients**: Should one `janee serve` instance support multiple concurrent agent connections, or one client at a time?
   - **Impact**: Connection pooling, API rate limiting, session isolation
   - **Proposed**: Start with single-client for simplicity, add multi-client in v0.6.0 if there's demand

2. **Protocol version negotiation**: What happens if client and server have mismatched MCP protocol versions?
   - **Proposed**: Return HTTP 400 with version error on handshake mismatch

3. **Observability**: How do users monitor connection health and debug network issues?
   - **Proposed**: Add `--log-level debug` flag showing connection events, request counts, error details

4. **Graceful shutdown**: How does server notify connected clients it's shutting down?
   - **Proposed**: Send SSE event `{"type": "shutdown"}` before closing connections

5. **Multi-client support details**: If supporting multiple clients, how to handle:
   - Conflicting API rate limits across clients
   - Session isolation (one client shouldn't see another's session state)
   - Fair queuing for slow API endpoints

6. **MCP SDK transport evolution**: When/if MCP SDK deprecates SSE in favor of StreamableHTTP:
   - **Proposed**: Add StreamableHTTP in v0.7.0, deprecate SSE in v1.0.0, remove SSE in v2.0.0

---

## Testing Strategy

### Unit Tests

- Test `janee serve --transport sse` starts HTTP server
- Test `janee serve` defaults to stdio (backward compat)
- Test invalid transport types fail gracefully

### Integration Tests

- Spin up `janee serve --transport sse` in background
- Connect with SSE client
- Call `list_services`, `execute`, `reload_config`
- Verify responses match stdio behavior
- Verify audit logs are identical

### Manual Testing

- Docker container with OpenClaw
- Host-side Janee with network transport
- Agent successfully calls Janee tools over HTTP
- Verify secrets never enter container

---

## Rollout Plan

### v0.5.0 (Experimental)

- Add `--transport sse` support to `janee serve`
- Add `url` config to `janee-openclaw` plugin
- Document setup for Docker users
- Mark as experimental (subject to change)

### v0.6.0 (Stable)

- Gather feedback from container users
- Fix any issues discovered
- Add `--auth-token` support (if needed)
- Mark as stable, recommend for production

### v1.0.0

- Consider making SSE transport default for new installs
- Keep stdio for backward compatibility
- Add WebSocket transport (if demand exists)

---

## Open Questions

1. **Should we support TLS?**
   - Not initially — users can put Janee behind nginx/Caddy
   - Add native TLS if there's demand (`--cert`, `--key` flags)

2. **Should we support multiple transports simultaneously?**
   - E.g., `janee serve --transport stdio,sse --port 9100`
   - Probably overkill — start with one transport at a time

3. **What about HTTP request timeouts?**
   - MCP SDK handles this, but we should document expected latency
   - Long-running API calls (analytics queries, etc.) may hit client timeouts

4. **Should the plugin auto-detect host IP?**
   - Docker: `host.docker.internal` (macOS/Windows), `172.17.0.1` (Linux)
   - Too much magic — require explicit `url` config

---

## Success Metrics

- **Adoption:** Number of users running `janee serve --transport sse`
- **Container deployments:** GitHub issues mentioning Docker/Kubernetes
- **Security improvements:** Reduction in "secrets in container" support requests
- **Performance:** Request latency comparable to stdio (< 10ms overhead)

---

## Prior Art

- **MCP SDK examples:** [`ssePollingExample.js`](https://github.com/modelcontextprotocol/sdk/blob/main/src/examples/server/ssePollingExample.ts)
- **OpenClaw plugin docs:** Support for network-based MCP servers
- **1Password Connect:** Similar HTTP API for containerized secret access
- **HashiCorp Vault:** Agent mode vs. server mode (we're doing both)

---

## References

- Issue #28: https://github.com/rsdouglas/janee/issues/28
- MCP SDK docs: https://github.com/modelcontextprotocol/sdk
- SSE transport: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- Docker networking: https://docs.docker.com/network/

---

**Next Steps:**
1. Gather feedback from Ross and @mkoorn
2. Prototype SSE server in a branch
3. Test with OpenClaw in Docker
4. Refine based on findings
5. Merge and release as experimental in v0.5.0

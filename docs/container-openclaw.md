# Running Janee with OpenClaw in Containers

This guide covers using Janee with containerized OpenClaw agents via HTTP transport.

## The Problem

When OpenClaw runs inside a container, the default stdio-based setup doesn't work:

```
┌──────────────────────────────────────┐
│  Docker Container (agent)            │
│  - No access to host filesystem      │
│  - No Janee binary                   │
│  - No ~/.janee/config.yaml           │
│                                      │
│  ✗ Can't spawn `janee serve`        │
│  ✗ Can't read encrypted credentials  │
└──────────────────────────────────────┘
```

Mounting secrets into the container defeats Janee's security model — the agent would have direct access to the master key and API credentials.

## The Solution

Janee supports HTTP network transport, enabling this architecture:

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
│  - ~/.janee/config.yaml │          │  - Nothing!              │
└─────────────────────────┘          └──────────────────────────┘
```

The container connects over the network, agent never sees credentials.

## Setup

### Step 1: Install Janee on Host

```bash
npm install -g @true-and-useful/janee
janee init
janee add stripe --auth-type bearer --key sk_live_...
```

### Step 2: Start Janee HTTP Server

**Default (localhost only, recommended):**
```bash
janee serve --transport http --port 9100
# Listening on http://localhost:9100/mcp
```

**Custom host:**
```bash
# Bind to specific interface
janee serve --transport http --port 9100 --host 172.17.0.1

# Bind to all interfaces (see security warning below)
janee serve --transport http --port 9100 --host 0.0.0.0
```

The MCP endpoint is at `/mcp` (e.g., `http://localhost:9100/mcp`).

### Step 3: Configure Container Networking

The container needs to reach the host's `localhost`. This varies by platform:

**macOS / Windows (Docker Desktop):**

Use `host.docker.internal`:

```bash
docker run -it \
  -e JANEE_URL=http://host.docker.internal:9100/mcp \
  my-openclaw-agent
```

**Linux:**

Use `--add-host` to map `host.docker.internal` to the gateway:

```bash
docker run -it \
  --add-host=host.docker.internal:host-gateway \
  -e JANEE_URL=http://host.docker.internal:9100/mcp \
  my-openclaw-agent
```

Or use the bridge gateway IP directly (usually `172.17.0.1`):

```bash
# Find your bridge gateway IP
docker network inspect bridge | grep Gateway

# Start Janee bound to that IP or 0.0.0.0
janee serve --transport http --port 9100 --host 172.17.0.1

docker run -it \
  -e JANEE_URL=http://172.17.0.1:9100/mcp \
  my-openclaw-agent
```

### Step 4: Configure OpenClaw Plugin

Install the plugin in your container's OpenClaw setup:

```bash
openclaw plugins install @true-and-useful/janee-openclaw
```

Configure the plugin with the `url` field in your OpenClaw agent config:

```json5
{
  agents: {
    list: [{
      id: "main",
      tools: { allow: ["janee"] },
      extensions: [{
        id: "janee-openclaw",
        enabled: true,
        config: {
          url: "http://host.docker.internal:9100/mcp"
        }
      }]
    }]
  }
}
```

**Important:** When `url` is set, the plugin connects over HTTP instead of spawning `janee serve` as a subprocess.

## Docker Compose Example

```yaml
version: '3'

services:
  openclaw-agent:
    image: my-openclaw-agent:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - JANEE_URL=http://host.docker.internal:9100/mcp
    # No volume mounts needed!
    # No secrets in container!
```

On the host:

```bash
janee serve --transport http --port 9100
docker-compose up
```

## Verification

Test the connection from inside the container:

```bash
# Enter running container
docker exec -it <container-id> sh

# Test basic connectivity (ping the port)
nc -zv host.docker.internal 9100

# Or on Linux with bridge IP
nc -zv 172.17.0.1 9100
```

If the port is reachable, you should see "succeeded!" or "open". Then try using the OpenClaw agent:

```
Agent: "List available services"
→ janee-openclaw calls janee_list_services over HTTP
→ Janee responds with ["stripe"]

Agent: "Get recent Stripe customers"
→ janee-openclaw calls janee_execute(capability: "stripe", path: "/v1/customers")
→ Janee proxies to Stripe API with decrypted key
→ Response returned to agent
```

## Security Considerations

### Trust Model

**Default binding: `localhost` (127.0.0.1)**

When Janee binds to `localhost`, only processes on the same machine can connect. Containers reach `localhost` via Docker's `host.docker.internal` or bridge gateway IP.

**Trust boundary:** Anyone who can connect is trusted. Same as stdio — there's no authentication yet.

**Suitable for:**
- Trusted local connections (container → host on same machine)
- Development and personal deployments

**Not suitable for:**
- Public networks
- Multi-tenant systems
- Untrusted containers

### Network Exposure Warning

**⚠️ WARNING: Binding to `0.0.0.0`**

When you bind to `0.0.0.0`, Janee is exposed to:
- All containers on the Docker bridge network
- Other machines on your network (if firewall allows)

**Any container that can reach the port can access all configured API credentials.**

**Only bind to `0.0.0.0` when:**
- All containers on the network are trusted, OR
- Docker network ACLs restrict access to specific containers, OR
- Host firewall rules limit connections to specific IPs

**Recommended configuration (most restrictive):**

```bash
# macOS/Windows: localhost only, use host.docker.internal from containers
janee serve --transport http --port 9100 --host localhost

# Linux: bind to bridge IP only (more restrictive than 0.0.0.0)
janee serve --transport http --port 9100 --host 172.17.0.1
```

### Out of Scope

**Janee HTTP transport does NOT support:**
- Bearer token authentication
- TLS/HTTPS
- Public IP exposure
- Cross-host networking
- Multi-tenant access control

**Rationale:** Janee is a single-user local tool, not a network secrets service.

If you need remote access, use SSH port forwarding:

```bash
ssh -L 9100:localhost:9100 user@host
# Then connect to localhost:9100
```

For production multi-host deployments, consider a proper secrets service like HashiCorp Vault.

## Troubleshooting

### ECONNREFUSED

**Error:**
```
Error: connect ECONNREFUSED 172.17.0.1:9100
```

**Fixes:**
1. Verify Janee is running: `ps aux | grep janee`
2. Check port and host: `janee serve --transport http --port 9100 --host 0.0.0.0`
3. Test from container: `docker exec -it <container> nc -zv 172.17.0.1 9100`
4. Check firewall rules: `sudo iptables -L | grep 9100` (Linux)

### host.docker.internal not found (Linux)

**Error:**
```
Could not resolve host: host.docker.internal
```

**Fix:** Add `--add-host` flag:

```bash
docker run --add-host=host.docker.internal:host-gateway ...
```

Or use Docker Compose:

```yaml
services:
  agent:
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

### Connection timeout

**Error:**
```
Error: connect ETIMEDOUT
```

**Fixes:**
1. Verify container can reach host network: `docker exec -it <container> ping 172.17.0.1`
2. Check Docker network: `docker network inspect bridge`
3. Verify Janee is bound to correct interface: `netstat -tuln | grep 9100`
4. Check for conflicting port usage: `lsof -i :9100`

### Plugin still tries to spawn janee serve

**Symptom:** Container logs show `spawn janee ENOENT`

**Cause:** Plugin config doesn't have `url` field set.

**Fix:** Ensure your OpenClaw agent config includes:

```json5
config: {
  url: "http://host.docker.internal:9100"
}
```

### Request works from host but not from container

**Symptom:** Connection to `localhost:9100` works on host, fails from container

**Cause:** Container's `localhost` is its own network namespace, not the host's.

**Fix:** Use `host.docker.internal` (macOS/Windows) or bridge gateway IP (Linux).

## Advanced: Multiple Containers

One Janee instance can serve multiple containers:

```yaml
version: '3'

services:
  agent-1:
    image: openclaw-agent:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - JANEE_URL=http://host.docker.internal:9100

  agent-2:
    image: openclaw-agent:latest
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      - JANEE_URL=http://host.docker.internal:9100
```

All agents share the same API credentials and audit log.

**Security implication:** All containers can access all configured services. Use Docker network ACLs or separate Janee instances if isolation is needed.

## Further Reading

- [RFC-0004: Network Transport](rfcs/0004-network-transport.md) — Technical design document
- [OpenClaw Plugin](https://github.com/openclaw/plugins/tree/main/janee-openclaw) — Plugin source code
- [MCP Specification](https://modelcontextprotocol.io) — Protocol details

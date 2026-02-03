# Janee 🔐

**Secrets management for AI agents via MCP**

---

## The Problem

AI agents need API access to be useful. The current approach is to give them your keys and hope they behave.

- 🔓 Agents have full access to Stripe, Gmail, databases
- 📊 No audit trail of what was accessed or why
- 🚫 No kill switch when things go wrong
- 💉 One prompt injection away from disaster

---

## The Solution

Janee is an [MCP](https://modelcontextprotocol.io) server that manages API secrets for AI agents:

1. **Store your API keys** — encrypted locally in `~/.janee/`
2. **Run `janee serve`** — starts MCP server
3. **Agent requests access** — via `execute` MCP tool
4. **Janee injects the real key** — agent never sees it
5. **Everything is logged** — full audit trail

**Your keys stay on your machine. Agents never see them. You stay in control.**

---

## Quick Start

### Install

```bash
npm install -g janee
```

### Initialize

```bash
janee init
```

This creates `~/.janee/config.yaml` with example services.

### Configure

Edit `~/.janee/config.yaml` and uncomment/add your services:

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx

capabilities:
  stripe:
    service: stripe
    ttl: 1h
    autoApprove: true
```

### Start the MCP server

```bash
janee serve
```

### Use with your agent

Agents that support MCP (Claude Desktop, Cursor, OpenClaw) can now call the `execute` tool to make API requests through Janee:

```typescript
// Agent calls the execute tool
execute({
  service: "stripe",
  method: "GET",
  path: "/v1/balance",
  reason: "User asked for account balance"
})
```

Janee decrypts the key, makes the request, logs everything, and returns the response.

---

## OpenClaw Integration

If you're using [OpenClaw](https://openclaw.ai), install the plugin for native tool support:

```bash
npm install -g janee
janee init
# Edit ~/.janee/config.yaml with your services

# Install the OpenClaw plugin
openclaw plugins install @openclaw/janee
```

Enable in your agent config:

```json5
{
  agents: {
    list: [{
      id: "main",
      tools: { allow: ["janee"] }
    }]
  }
}
```

Your agent now has these tools:

- `janee_list_services` — Discover available APIs
- `janee_execute` — Make API requests through Janee

The plugin spawns `janee serve` automatically. All requests are logged to `~/.janee/logs/`.

**See [docs/OPENCLAW.md](docs/OPENCLAW.md) for full integration guide.**

---

## MCP Tools

Janee exposes two MCP tools:

| Tool | Description |
|------|-------------|
| `list_services` | Discover available APIs and their policies |
| `execute` | Make an API request through Janee |

Agents discover what's available, then call APIs through Janee. Same audit trail, same protection.

---

## Configuration

Config lives in `~/.janee/config.yaml`:

```yaml
server:
  host: localhost

services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx  # encrypted at rest

  github:
    baseUrl: https://api.github.com
    auth:
      type: bearer
      key: ghp_xxx

capabilities:
  stripe:
    service: stripe
    ttl: 1h
    autoApprove: true

  stripe_sensitive:
    service: stripe
    ttl: 5m
    requiresReason: true
```

**Services** = Real APIs with real keys  
**Capabilities** = What agents can request, with policies

---

## CLI Reference

```bash
janee init          # Set up ~/.janee/ with example config
janee list          # List configured services
janee serve         # Start MCP server
janee logs          # View audit log
janee logs -f       # Tail audit log
janee sessions      # List active sessions
janee revoke <id>   # Kill a session
```

Add/edit services by editing `~/.janee/config.yaml` directly.

---

## How It Works

```
┌─────────────┐      ┌──────────┐      ┌─────────┐
│  AI Agent   │─────▶│  Janee   │─────▶│  Stripe │
│             │ MCP  │   MCP    │ HTTP │   API   │
└─────────────┘      └──────────┘      └─────────┘
      │                   │
   No key           Injects key
                    + logs request
```

1. Agent calls `execute` MCP tool with service, method, path
2. Janee looks up service config, decrypts the real key
3. Makes HTTP request to real API with key
4. Logs: timestamp, service, method, path, status
5. Returns response to agent

Agent never touches the real key.

---

## Security

- **Encryption**: Keys stored with AES-256-GCM
- **Local only**: MCP server over stdio (no network exposure)
- **Audit log**: Every request logged to `~/.janee/logs/`
- **Sessions**: Time-limited, revocable
- **Kill switch**: `janee revoke` or delete config

---

## Integrations

Works with any agent that speaks MCP:

- **OpenClaw** — Native plugin (`@openclaw/janee`)
- **Claude Desktop** — MCP client
- **Cursor** — MCP client
- **Any MCP client** — just point at `janee serve`

---

## Roadmap

- [x] MCP server interface
- [x] Encrypted key storage  
- [x] Audit logging
- [x] Session management
- [x] OpenClaw plugin
- [ ] LLM adjudication (evaluate requests with AI)
- [ ] Policy engine (rate limits, allowlists)
- [ ] Cloud version (managed hosting)

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT

---

**Stop giving AI agents your keys. Start controlling access.** 🔐

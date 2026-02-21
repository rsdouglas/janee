# Why Janee? Securing API Keys for AI Agents

## The Problem Every AI Agent Developer Faces

You've built an AI agent that needs to call external APIs — Stripe, GitHub, Slack, OpenAI. The standard approach is to pass API keys directly to the agent via environment variables or tool configurations.

This creates serious problems:

1. **Keys in plaintext** — stored in `.env` files, tool configs, or agent prompts
2. **No access boundaries** — agents get full API access when they only need read access
3. **No audit trail** — you can't see what API calls your agent made
4. **No kill switch** — if an agent misbehaves, you can't revoke access without rotating keys
5. **Prompt injection risk** — a compromised agent can exfiltrate keys

## How Janee Solves This

Janee is a **secrets proxy for AI agents** that sits between your agent and your APIs:

```
Agent → MCP → Janee → API
              ↑
        injects real credentials
        enforces policies
        logs everything
```

Your agent calls `execute` with a service name and request details. Janee injects the real API key, checks the request against your policies, and forwards it. The agent never sees the key.

### Compared to Other Approaches

| Approach | Keys visible to agent? | Access control? | Audit trail? | Kill switch? |
|----------|----------------------|-----------------|--------------|-------------|
| Environment variables | ✅ Yes — agent sees raw keys | ❌ No | ❌ No | ❌ No (must rotate key) |
| Vault/1Password | ✅ Yes — agent fetches key, then uses it | ❌ No | Partial | ❌ No |
| OAuth tokens | ✅ Yes — agent holds token | Scoped | Partial | ✅ Revoke token |
| **Janee** | **❌ No — agent never sees key** | **✅ Per-method, per-path** | **✅ Full** | **✅ Instant** |

The key insight: traditional secrets managers (Vault, 1Password, AWS Secrets Manager) **give the secret to the consumer**. That's fine for trusted server code, but AI agents are unpredictable. Janee never gives the secret away — it proxies the request instead.

### Real Example: Read-Only Stripe Access

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth: { type: bearer, key: sk_live_xxx }

capabilities:
  stripe_readonly:
    service: stripe
    ttl: 30m
    autoApprove: true
    rules:
      - allow: GET /v1/customers*
      - allow: GET /v1/charges*
      - deny: "*"   # block everything else
```

Your agent can read customer and charge data for 30 minutes. It can't create charges, delete customers, or access any other Stripe endpoint. If something goes wrong, access expires automatically.

## Getting Started

```bash
npm install -g @true-and-useful/janee
janee init
janee add stripe --auth bearer --key sk_live_xxx --auto
janee serve
```

Then point any MCP client (Claude Desktop, Cursor, Claude Code) at `janee serve`. See the [full quickstart guide](./quickstart.md) for details.

## When Should You Use Janee?

- You're giving AI agents access to APIs with real data
- You want to enforce least-privilege access (read-only, specific endpoints)
- You need an audit trail of what your agents are doing
- You want a kill switch that doesn't require rotating API keys
- You're running multiple agents and want centralized key management

## Learn More

- [Quickstart Guide](./quickstart.md)
- [Configuration Reference](../README.md#configuration)
- [Multi-Agent Setup](./multi-agent-setup.md)
- [Example Configurations](../examples/README.md)
- [GitHub](https://github.com/rsdouglas/janee)

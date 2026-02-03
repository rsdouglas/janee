# Janee Design: MCP-First Architecture

## Overview

Janee is a secrets proxy for AI agents. It stores API keys, exposes capabilities via MCP, and proxies requests — so agents never see real keys.

**Core principle:** Janee is a dumb pipe with policy enforcement + audit. Not an API abstraction layer.

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   AI Agent      │         │     Janee       │
│  (Claude Code,  │◄──MCP──►│   MCP Server    │
│   Cursor, Kit)  │         │                 │
└─────────────────┘         │  ┌───────────┐  │
                            │  │  Proxy    │  │
        or direct HTTP ────►│  │  Engine   │──┼──► Real APIs
                            │  └───────────┘  │    (Stripe, Gmail, etc.)
                            │                 │
                            │  ┌───────────┐  │
                            │  │  Audit    │  │
                            │  │  Log      │  │
                            │  └───────────┘  │
                            └─────────────────┘
```

**Two ways to use Janee:**
1. **MCP calls** — Agent discovers services, calls `janee.execute(...)`, Janee proxies
2. **HTTP proxy** — Agent gets credentials via MCP, uses curl/HTTP directly

Same policies, same audit trail, either path.

---

## MCP Tools

```
janee.list_services()
  → Returns available capabilities and their policies
  
janee.execute(service, method, path, body?, headers?)
  → Proxies request to real API, returns response
  
janee.get_http_access(service, reason?)
  → Returns { url, headers, expires } for direct HTTP use
```

### Example: list_services response

```json
[
  {
    "name": "stripe",
    "ttl": "1h",
    "autoApprove": true
  },
  {
    "name": "stripe_sensitive",
    "ttl": "5m",
    "requiresReason": true
  },
  {
    "name": "gmail",
    "ttl": "30m",
    "autoApprove": true
  }
]
```

### Example: execute

```json
// Request
{
  "service": "stripe",
  "method": "GET",
  "path": "/v1/customers"
}

// Response
{
  "status": 200,
  "body": { "data": [...], "has_more": false }
}
```

### Example: get_http_access

```json
// Request
{
  "service": "stripe",
  "reason": "checking customer balance for support case"
}

// Response
{
  "url": "http://localhost:9119/stripe",
  "headers": {
    "Authorization": "Bearer jnee_sess_abc123"
  },
  "expires": "2026-02-03T09:00:00Z"
}
```

---

## Config File

`~/.janee/config.yaml`

```yaml
# Server settings
server:
  port: 9119
  host: localhost

# LLM for adjudication (optional)
llm:
  provider: openai  # or anthropic
  apiKey: env:OPENAI_API_KEY
  model: gpt-4o-mini

# Services: the real APIs with real keys
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx  # encrypted at rest

  gmail:
    baseUrl: https://gmail.googleapis.com
    auth:
      type: bearer
      key: ya29.xxx

  bybit:
    baseUrl: https://api.bybit.com
    auth:
      type: hmac  # for APIs that need signature
      apiKey: xxx
      apiSecret: xxx

# Capabilities: what agents can request
capabilities:
  stripe:
    service: stripe
    ttl: 1h
    autoApprove: true

  stripe_sensitive:
    service: stripe
    ttl: 5m
    requiresReason: true

  gmail:
    service: gmail
    ttl: 30m
    autoApprove: true

  bybit:
    service: bybit
    ttl: 15m
    requiresReason: true
```

### Config concepts

**Services** = Real APIs with real keys (encrypted at rest)
- `baseUrl`: Where requests get proxied to
- `auth`: How to authenticate (bearer token, HMAC signature, custom headers)

**Capabilities** = What agents see and can request
- `service`: Which underlying service
- `ttl`: How long a session lasts
- `autoApprove`: Skip approval for low-risk capabilities
- `requiresReason`: Agent must explain why (logged, optionally LLM-evaluated)

### Auth types

```yaml
# Simple bearer token
auth:
  type: bearer
  key: sk_live_xxx

# HMAC signature (Bybit, Binance, etc.)
auth:
  type: hmac
  apiKey: xxx
  apiSecret: xxx

# Custom headers
auth:
  type: headers
  headers:
    X-API-Key: xxx
    X-Custom-Header: yyy
```

---

## Session Flow

1. Agent connects to Janee MCP server
2. Agent calls `list_services()` → sees available capabilities
3. Agent calls `execute("stripe", "GET", "/v1/customers")` or `get_http_access("stripe")`
4. Janee checks:
   - Does this capability exist?
   - Is there an active session, or need to create one?
   - If `requiresReason`, did agent provide one?
   - If LLM approval enabled, does it pass?
5. If approved: proxy request (or return HTTP credentials)
6. Log everything: timestamp, agent, capability, method, path, response status

---

## Audit Log

`~/.janee/logs/audit.jsonl`

```json
{"ts":"2026-02-03T08:15:00Z","capability":"stripe","method":"GET","path":"/v1/customers","status":200,"reason":null}
{"ts":"2026-02-03T08:15:05Z","capability":"stripe_sensitive","method":"POST","path":"/v1/refunds","status":200,"reason":"customer requested refund for order #123"}
{"ts":"2026-02-03T08:16:00Z","capability":"bybit","method":"POST","path":"/v5/order/create","status":403,"reason":"placing test order","denied":"LLM flagged as suspicious"}
```

---

## CLI Commands

```bash
janee init                  # Set up ~/.janee/, generate encryption key
janee serve                 # Start MCP server + HTTP proxy
janee add <service>         # Add a service (prompts for details)
janee list                  # Show configured services + capabilities
janee logs [-f]             # View/tail audit log
janee sessions              # Show active sessions
janee revoke <session>      # Kill a session immediately
```

---

## What Janee Does NOT Do

- **Model specific APIs** — Agent knows how to call Stripe, Janee just proxies
- **Store agent code** — Agent runs elsewhere (Claude Code, Cursor, OpenClaw)
- **Replace API clients** — Existing code works, just change base URL

---

## Implementation Phases

### Phase 1 (current): Basic proxy ✅
- CLI: init, add, serve, list, logs
- HTTP proxy with key injection
- File-based config (encrypted)
- Audit logging

### Phase 2: MCP server
- Implement MCP protocol
- `list_services`, `execute`, `get_http_access` tools
- Session management (TTL, revocation)
- Capability-based access

### Phase 3: Adjudication
- LLM evaluation for `requiresReason` capabilities
- Rules engine for custom policies
- Anomaly detection (unusual patterns)

---

## First Integration: OpenClaw

Kit (OpenClaw agent) is the first user:

```bash
janee add stripe --url https://api.stripe.com --key sk_xxx
janee add gmail --url https://gmail.googleapis.com --key ya29.xxx
janee serve
```

Kit connects via MCP, discovers services, executes requests. Ross sees everything in `janee logs -f`.

See `docs/OPENCLAW.md` for complete integration guide.

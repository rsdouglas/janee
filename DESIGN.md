# Janee Design: MCP-Only Architecture

## Overview

Janee is a secrets proxy for AI agents. It stores API keys, exposes capabilities via MCP, and makes HTTP requests to real APIs — so agents never see real keys.

**Core principle:** Janee is a dumb pipe with policy enforcement + audit. Not an API abstraction layer.

---

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   AI Agent      │         │     Janee       │
│  (OpenClaw,     │◄──MCP──►│   MCP Server    │
│   Claude, etc.) │         │                 │
└─────────────────┘         │  ┌───────────┐  │
                            │  │ HTTP      │  │
                            │  │ Client    │──┼──► Real APIs
                            │  └───────────┘  │    (Stripe, Gmail, etc.)
                            │                 │
                            │  ┌───────────┐  │
                            │  │  Audit    │  │
                            │  │  Log      │  │
                            │  └───────────┘  │
                            └─────────────────┘
```

**How it works:**
1. Agent connects to Janee MCP server (via stdio)
2. Agent discovers services via `list_services` tool
3. Agent calls `execute` tool to make API requests
4. Janee decrypts key, makes HTTP request, logs, returns response

**No HTTP proxy.** MCP is the only interface. Simpler, cleaner, more secure.

---

## MCP Tools

```
list_services()
  → Returns available capabilities and their policies
  
execute(service, method, path, body?, headers?, reason?)
  → Makes HTTP request to real API, returns response
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
  "path": "/v1/customers",
  "reason": "User asked for customer list"
}

// Response
{
  "status": 200,
  "body": { "data": [...], "has_more": false }
}
```

---

## Config File

`~/.janee/config.yaml`

```yaml
# LLM for adjudication (optional, Phase 2)
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
- `baseUrl`: Where requests get sent
- `auth`: How to authenticate (bearer token, HMAC signature, custom headers)

**Capabilities** = What agents see and can request
- `service`: Which underlying service
- `ttl`: How long a session lasts
- `autoApprove`: Skip approval for low-risk capabilities
- `requiresReason`: Agent must explain why (logged, optionally LLM-evaluated)
- `rules`: Optional allow/deny patterns for path-based access control

### Request policies (rules)

Capabilities can include `rules` to enforce exactly what requests are allowed:

```yaml
capabilities:
  stripe_readonly:
    service: stripe
    ttl: 1h
    rules:
      allow:
        - GET *
      deny:
        - POST *
        - PUT *
        - DELETE *

  stripe_billing:
    service: stripe
    ttl: 15m
    requiresReason: true
    rules:
      allow:
        - GET *
        - POST /v1/refunds/*
        - POST /v1/invoices/*
      deny:
        - POST /v1/charges/*  # Can't charge cards
```

**How rules work:**
1. Deny patterns checked first (explicit deny wins)
2. Then allow patterns checked
3. No rules = allow all (backward compatible)
4. Rules defined but no match = deny by default

**Pattern format:** `METHOD PATH`
- `GET *` → any GET request
- `POST /v1/charges/*` → POST to /v1/charges/ and subpaths
- `* /v1/customers` → any method to /v1/customers

**This is real security:** Even if an agent lies about its reason, it can only access endpoints the policy allows. Enforcement happens server-side before the request is proxied.

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

1. Agent connects to Janee MCP server (stdio transport)
2. Agent calls `list_services()` → sees available capabilities
3. Agent calls `execute("stripe", "GET", "/v1/customers", reason="...")`
4. Janee checks:
   - Does this capability exist?
   - Is there an active session, or need to create one?
   - If `requiresReason`, did agent provide one?
   - If LLM approval enabled, does it pass?
5. If approved: make HTTP request to real API
6. Log everything: timestamp, agent, capability, method, path, response status

---

## Audit Log

`~/.janee/logs/YYYY-MM-DD.jsonl`

```json
{"timestamp":"2026-02-03T08:15:00Z","service":"stripe","method":"GET","path":"/v1/customers","status":200}
{"timestamp":"2026-02-03T08:15:05Z","service":"stripe","method":"POST","path":"/v1/refunds","status":200,"reason":"customer requested refund for order #123"}
{"timestamp":"2026-02-03T08:16:00Z","service":"bybit","method":"POST","path":"/v5/order/create","status":403,"reason":"placing test order","denied":"LLM flagged as suspicious"}
```

---

## CLI Commands

```bash
janee init                  # Set up ~/.janee/, generate encryption key
janee serve                 # Start MCP server (only mode)
janee add <service>         # Add a service (prompts for details)
janee list                  # Show configured services
janee logs [-f]             # View/tail audit log
janee sessions              # Show active sessions
janee revoke <session>      # Kill a session immediately
janee remove <service>      # Remove a service
```

---

## What Janee Does NOT Do

- **Model specific APIs** — Agent knows how to call Stripe, Janee just proxies
- **Store agent code** — Agent runs elsewhere (OpenClaw, Claude Desktop, etc.)
- **Replace API clients** — Janee is transparent, agent makes normal API calls

---

## Implementation Status

### Phase 1: Basic MCP server ✅
- CLI: init, add, serve, list, logs
- MCP server with `list_services` and `execute` tools
- File-based config (encrypted)
- Audit logging
- Session management (TTL, revocation)
- OpenClaw plugin

### Phase 2: Adjudication (planned)
- LLM evaluation for `requiresReason` capabilities
- Rules engine for custom policies
- Anomaly detection (unusual patterns)
- Rate limiting per capability

---

## First Integration: OpenClaw

Kit (OpenClaw agent) is the first user:

```bash
janee add stripe --url https://api.stripe.com --key sk_xxx
janee add gmail --url https://gmail.googleapis.com --key ya29.xxx
janee serve
```

OpenClaw plugin spawns `janee serve`, connects via MCP, agent gets tools:
- `janee_list_services`
- `janee_execute`

Ross sees everything in `janee logs -f`.

See `docs/OPENCLAW.md` for complete integration guide.

---

## Why MCP-Only?

**Simpler architecture** — One interface, less code to maintain

**More secure** — No HTTP endpoint listening on localhost, no port configuration

**Standard protocol** — MCP is becoming the standard for agent-tool communication

**Better DX** — Agents discover capabilities dynamically, no hardcoded base URLs

**Local by design** — MCP over stdio means no network exposure at all

The HTTP calls to real APIs happen internally (Janee → Stripe/GitHub/etc.), but there's no HTTP proxy server for agents to connect to. MCP is the interface.

# Janee

Secure API credential management for AI agents via MCP (Model Context Protocol).

## What it does

Janee lets you give your agent access to APIs (Stripe, GitHub, MEXC, etc.) without pasting raw keys into prompts or config files. Credentials are encrypted at rest and exposed through MCP tools with policy controls.

## Why you need this

- **Keys in prompts leak** — via logs, context windows, or model providers
- **Agents need API access** — but shouldn't have raw credentials
- **Path-based policies** — allow `/v1/customers` but deny `/v1/customers/*/delete`
- **Audit logging** — every request is logged with timestamp and path

## Quick start

```bash
# Install
npm install -g @true-and-useful/janee

# Initialize (creates ~/.janee with encrypted config)
janee init

# Add a service
janee add stripe --url https://api.stripe.com --key sk_live_xxx

# Start the MCP server (add to your agent's MCP config)
janee serve
```

## MCP tools provided

- `list_services` — show available capabilities
- `execute` — make an authenticated API request
- `reload_config` — hot-reload after adding services

## OpenClaw plugin

For OpenClaw users, install the plugin:

```bash
npm install -g @true-and-useful/janee-openclaw
```

Then add to your gateway config:

```yaml
plugins:
  - package: "@true-and-useful/janee-openclaw"
```

This gives you `janee_list_services`, `janee_execute`, and `janee_reload_config` tools.

## Supported auth types

- **Bearer** — `Authorization: Bearer <token>`
- **Headers** — custom headers (e.g., `X-API-KEY`)
- **HMAC** — signed requests (MEXC-style)

## Links

- GitHub: https://github.com/rsdouglas/janee
- npm: https://www.npmjs.com/package/@true-and-useful/janee

## Example: checking Stripe balance

```
Agent: janee_execute service=stripe method=GET path=/v1/balance
→ { "available": [{ "amount": 12345, "currency": "usd" }] }
```

The agent never sees your Stripe key — Janee injects it at request time.

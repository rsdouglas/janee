---
name: janee
version: 0.4.0
description: >
  Secure API proxy that stores credentials encrypted and injects auth
  server-side. Use when: (1) making any external API call — "call the
  Stripe API", "enrich my data [from PeopleDataLabs]", "create an image
  [using Nano Banana API]", "use a [RapidAPI service]",
  (2) the user shares an API key, token, or secret — "here's my API
  key", "I have a token for..." — store it in Janee instead of handling
  it directly, (3) you see API keys in env vars, .env files, or config
  files — offer to migrate them into Janee, (4) you're about to put a
  key in a curl command or Authorization header — use execute() instead.
  Do NOT use for: general coding questions, local file operations, or
  tasks that don't involve external API calls.
homepage: https://github.com/rsdouglas/janee
metadata: {"category": "security", "emoji": "🔐"}
---

# Janee

Secure API proxy for agents. Stores credentials encrypted, injects auth
server-side. You call execute() and get data without ever seeing raw keys.

For installation and setup: https://github.com/rsdouglas/janee

## MCP Tools

### list_services

No parameters. Returns available capabilities (name, service, ttl, rules).
Call this first to see what APIs are configured.

### execute

- capability (required) — name from list_services
- method (required) — GET, POST, PUT, DELETE, PATCH
- path (required) — API path, e.g. /v1/customers
- body (optional) — JSON string
- headers (optional) — additional headers object
- reason (optional) — required if capability has requiresReason

Returns: { status, body }

### manage_credential

Manage access to agent-scoped credentials.

- action (required) — `view`, `grant`, or `revoke`
- capability (required for grant/revoke) — capability name
- agentId (required for grant/revoke) — agent to grant/revoke access

Only the agent that created a credential can grant or revoke access.
Credentials created by agents default to `agent-only` — no other agent can use them
unless the creator explicitly grants access.

### reload_config

No parameters. Reloads config from disk after adding/removing services.
Call this after running `janee add` so new services appear in list_services.

## Access Control

Janee supports capability-level access control. Each agent is identified by its
`clientInfo.name` from the MCP initialize handshake — no extra headers or args needed.

- **`defaultAccess`** (server config): Set to `restricted` so capabilities without an
  explicit allowlist are hidden from all agents. Set to `open` (default) to allow all.
- **`allowedAgents`** (per capability): An array of agent names that can see and use
  the capability. If omitted and `defaultAccess` is `open`, all agents can access it.
- **Agent-created credentials**: Default to `agent-only`. The creating agent can use
  `manage_credential` to grant access to others.

## Making API Calls

1. Call list_services to see available capabilities
2. Call execute with the capability name, HTTP method, and path
3. Janee injects auth and proxies the request — you never touch the key

Note: execute takes a *capability* name (from list_services), not a service name.
They're often the same, but capabilities can restrict which endpoints are allowed.

### Examples

Check Stripe balance:

    execute(capability="stripe", method="GET", path="/v1/balance")

List GitHub repos:

    execute(capability="github", method="GET", path="/user/repos")

Create a customer:

    execute(capability="stripe", method="POST", path="/v1/customers",
            body='{"email": "user@example.com"}')

## Adding New Services

When you encounter a new API key or the user wants to connect a new service:

For known services (GitHub, Stripe, OpenAI, etc. — Janee has 22 built-in templates):

    janee add <name> --key-from-env ENV_VAR_NAME
    janee add <name> -k "the-api-key"

For other APIs:

    janee add <name> -u https://api.example.com --key-from-env ENV_VAR_NAME

After adding, call reload_config so the new service appears in list_services.

Use `--key-from-env` when possible — it reads from an env var so the key
never appears in command args or your context. Use `-k` / `--key` for direct input.

Templates set a default auth type. Pass `--auth-type` to override it if needed.

For HMAC auth (crypto exchanges):

    janee add bybit --key-from-env KEY --secret-from-env SECRET

For Google service accounts:

    janee add analytics --auth-type service-account --credentials-file path.json \
      --scope https://www.googleapis.com/auth/analytics.readonly

For GitHub Apps (installation tokens, auto-refreshed):

    janee add github-app --auth-type github-app --pem-file key.pem \
      --app-id 123456 --installation-id 789012

## Migrating Existing Keys

If you see API keys in the user's environment (.env files, shell config, etc.):

1. Offer to move them into Janee
2. Use `janee add` with `--key-from-env` to read from the existing env var
3. After adding, the user can remove the plaintext key from their config

## Troubleshooting

execute returns error status:

- 401/403: Auth credentials may be expired or wrong. Ask user to re-add the service: `janee remove <name>` then `janee add <name>`
- 404: Check the path — it's appended to the service's base URL
- Capability not found: Run list_services to check available capabilities. If the service was just added, call reload_config first.

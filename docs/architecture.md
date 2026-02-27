# Janee Architecture

## Overview

Janee is an MCP server that acts as a **credential proxy** between AI agents and external APIs. Agents interact with APIs through Janee's MCP tools — they describe what they want to do, and Janee injects the real credentials at the last mile. Agents never see or handle raw secrets.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agent (Claude, GPT, etc.)             │
│                                                                 │
│  "Call Stripe API to list customers"                            │
└────────────────────────┬────────────────────────────────────────┘
                         │ MCP Protocol (stdio or HTTP)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Janee MCP Server                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  Tool Router  │  │ Policy Engine│  │  Audit Logger         │ │
│  │              │  │              │  │                       │ │
│  │ execute()    │  │ Allow/deny   │  │ Every request logged  │ │
│  │ exec()       │  │ per service  │  │ with timestamp, path, │ │
│  │ list_services│  │ per method   │  │ method, status        │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────────────────┘ │
│         │                 │                                     │
│  ┌──────▼─────────────────▼──────────────────────────────────┐  │
│  │              Credential Injection Layer                    │  │
│  │                                                           │  │
│  │  Reads encrypted secrets from ~/.janee/config.yaml        │  │
│  │  Injects auth headers (Bearer, Basic, API-Key, Custom)    │  │
│  │  Injects env vars for exec-mode tools                     │  │
│  │  Resolves GitHub App tokens (short-lived)                 │  │
│  └──────┬────────────────────────────────────────────────────┘  │
│         │                                                       │
└─────────┼───────────────────────────────────────────────────────┘
          │ Real HTTP request (with credentials)
          ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌──────────────┐
│  api.stripe.com     │  │  api.github.com     │  │  CLI tools   │
│  (Bearer: sk_live_) │  │  (Bearer: ghp_)     │  │  (env vars)  │
└─────────────────────┘  └─────────────────────┘  └──────────────┘
```

## Request Flow

### API Proxy Mode (`execute` tool)

1. Agent calls `execute` with service name, method, path, and body
2. Janee looks up the service in config
3. Policy engine checks if the request is allowed (method, path patterns)
4. Janee constructs the real HTTP request with injected credentials
5. Request is sent to the external API
6. Response is returned to the agent (with optional field filtering)
7. Full request/response is logged to the audit trail

### Exec Mode (`exec` tool)

1. Agent calls `exec` with a command name and arguments
2. Janee looks up the command in config
3. Janee spawns the process with injected environment variables
4. stdout/stderr is captured and returned to the agent
5. The agent never sees the env var values — only the output

### GitHub App Mode

1. Agent requests a GitHub operation
2. Janee generates a short-lived installation token (expires in 1 hour)
3. Token is injected as a Bearer credential
4. Git HTTPS operations automatically use the token via credential helper
5. No static PATs needed — tokens rotate automatically

## Deployment Modes

### Local (Default)

```
Agent ──stdio──▶ Janee ──HTTPS──▶ APIs
```

The simplest mode. Janee runs as a child process of the MCP client (Claude Desktop, Cursor, etc.) communicating over stdio. Config lives in `~/.janee/`.

### Runner / Authority (Containers)

```
┌──────────────────────────┐     ┌──────────────────────────────┐
│  Container (Agent)       │     │  Host (Authority)            │
│                          │     │                              │
│  Agent ──stdio──▶ Runner │────▶│  Authority ──HTTPS──▶ APIs   │
│                          │REST │                              │
│  Runner has NO secrets   │     │  Authority has ALL secrets   │
└──────────────────────────┘     └──────────────────────────────┘
```

For containerized agents (like those in [OpenSeed](https://github.com/openseed-dev/openseed)), Janee splits into two components:

- **Runner** — runs inside the container alongside the agent. Has no secrets. Forwards requests over REST to the Authority.
- **Authority** — runs on the host. Holds all secrets. Validates requests, injects credentials, enforces policies.

This means even if the agent compromises its container, it cannot access raw credentials.

## Security Model

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Agent reads credentials from config | Config is on host; runner in container has no access |
| Agent intercepts HTTP traffic | Credentials injected at the authority level, outside the container |
| Prompt injection exfiltrates keys | Agent never sees keys — nothing to exfiltrate |
| Agent makes unauthorized API calls | Policy engine restricts methods, paths, and services |
| Credential leak in logs | Audit log records requests but redacts auth headers |
| Stolen GitHub PAT | GitHub App mode uses short-lived tokens (1-hour expiry) |

### Encryption

- Secrets in `config.yaml` are encrypted at rest using a master key
- Master key is stored in the OS keychain (macOS Keychain, Linux Secret Service) or a file with `0600` permissions
- Secrets are decrypted only when needed for request injection

### Audit Trail

Every API call through Janee is logged:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "service": "stripe",
  "method": "GET",
  "path": "/v1/customers",
  "status": 200,
  "duration_ms": 145,
  "agent": "claude-desktop"
}
```

## Comparison with Alternatives

| Feature | Janee | Raw API Keys | Vault/1Password | OAuth Proxy |
|---------|-------|-------------|-----------------|-------------|
| Agent never sees secrets | ✅ | ❌ | ❌¹ | ✅ |
| MCP native | ✅ | N/A | ❌ | ❌ |
| Per-request audit trail | ✅ | ❌ | ❌ | Partial |
| Request policies (method/path) | ✅ | ❌ | ❌ | Partial |
| CLI tool support (exec mode) | ✅ | ❌ | ❌ | ❌ |
| GitHub App integration | ✅ | N/A | ❌ | ❌ |
| Works in containers | ✅ | ✅ | ✅ | ✅ |
| Zero agent code changes | ✅ | ✅ | ❌ | ❌ |
| Local-first (no cloud) | ✅ | ✅ | ❌² | ✅ |
| Session TTLs with revocation | ✅ | ❌ | ✅ | ✅ |
| Install complexity | `npm i -g` | None | High | Medium |

¹ Vault/1Password can manage secrets, but the agent still receives the secret to make the API call.
² HashiCorp Vault can run locally, but is complex to operate. 1Password requires cloud.

### Why not just use environment variables?

Environment variables are the most common way to give agents API access. The problems:

1. **No isolation** — every process in the environment can read them
2. **No audit trail** — you don't know which agent called which API
3. **No policies** — an agent with `STRIPE_KEY` can do anything on Stripe
4. **No revocation** — to revoke, you must restart the process
5. **Prompt injection risk** — an injected prompt can instruct the agent to read `process.env` and exfiltrate keys

Janee solves all of these. The agent calls `execute("stripe", "GET", "/v1/customers")` and gets the response. It never handles the key.

### Why not OAuth?

OAuth is great for user-facing apps, but AI agents aren't users:

- Agents can't complete browser-based OAuth flows
- OAuth tokens still need to be stored somewhere the agent can access
- OAuth doesn't help with CLI tools or non-OAuth APIs
- Most APIs that agents call (Stripe, OpenAI, etc.) use API keys, not OAuth

## Configuration Reference

See the main [README](../README.md) for full configuration details, or the [library usage guide](./library-usage.md) for programmatic access.

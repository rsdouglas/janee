[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/rsdouglas-janee-badge.png)](https://mseep.ai/app/rsdouglas-janee)

# Janee 🔐

**Secrets management for AI agents via MCP**

[![npm version](https://img.shields.io/npm/v/@true-and-useful/janee.svg)](https://www.npmjs.com/package/@true-and-useful/janee)
[![npm downloads](https://img.shields.io/npm/dw/@true-and-useful/janee.svg)](https://www.npmjs.com/package/@true-and-useful/janee)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/rsdouglas/janee.svg?style=social)](https://github.com/rsdouglas/janee)

> Your AI agents need API access to be useful. But they shouldn't have your raw API keys.
> Janee sits between your agents and your APIs — injecting credentials, enforcing policies, and logging everything.


### ✨ Features

| | |
|---|---|
| 🔒 **Zero-knowledge agents** | Agents call APIs without ever seeing keys |
| 📋 **Full audit trail** | Every request logged with timestamp, method, path, status |
| 🛡️ **Request policies** | Allow/deny rules per capability (e.g., read-only Stripe) |
| ⏱️ **Session TTLs** | Time-limited access with instant revocation |
| 🔌 **Works with any MCP client** | Claude Desktop, Cursor, OpenClaw, and more |
| 🏠 **Local-first** | Keys encrypted on your machine, never sent to a cloud |
| 🖥️ **Exec mode** | Run CLI tools with injected credentials — agents never see the keys |
| 🤖 **GitHub App auth** | Short-lived tokens for autonomous agents — no static PATs |
| 🐦 **Twitter/X OAuth 1.0a** | Per-request OAuth signing — 4 secrets stay encrypted |
| ☁️ **AWS SigV4** | Sign AWS API requests server-side — SES, S3, and more |
| 🔧 **Automatic git auth** | `git push/pull` just works when credentials include GitHub tokens |

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

## Configure Once, Use Everywhere

Set up your APIs in Janee once:

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth: { type: bearer, key: sk_live_xxx }
  github:
    baseUrl: https://api.github.com
    auth: { type: bearer, key: ghp_xxx }
  openai:
    baseUrl: https://api.openai.com
    auth: { type: bearer, key: sk-xxx }
```

Now **every agent** that connects to Janee can use them:

- **Claude Desktop** — access your APIs
- **Cursor** — access your APIs  
- **OpenClaw** — access your APIs
- **Any MCP client** — access your APIs

No more copying keys between tools. No more "which agent has which API configured?" Add a new agent? It already has access to everything. Revoke a key? Update it once in Janee.

**One config. Every agent. Full audit trail.**

---

## Quick Start

### Install

```bash
npm install -g @true-and-useful/janee
```

### Initialize

```bash
janee init
```

This creates `~/.janee/config.yaml` with example services.

### Add Services

**Option 1: Interactive (recommended for first-time users)**

```bash
janee add
```

Janee will guide you through adding a service:

```
Service name: stripe
Base URL: https://api.stripe.com
Auth type: bearer
API key: sk_live_xxx

✓ Added service "stripe"

Create a capability for this service? (Y/n): y
Capability name (default: stripe): 
TTL (e.g., 1h, 30m): 1h
Auto-approve? (Y/n): y

✓ Added capability "stripe"

Done! Run 'janee serve' to start.
```

**Using an AI agent?** See [Non-interactive Setup](#non-interactive-setup-for-ai-agents) for flags that skip prompts, or the [agent-specific guides](#integrations) below.

**Option 2: Edit config directly**

Edit `~/.janee/config.yaml`:

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

### Add CLI tools (exec mode)

Some tools need credentials as environment variables, not HTTP headers. Exec mode handles this:

```bash
janee add twitter --exec \
  --key "tvly-xxx" \
  --allow-commands "bird,tweet-cli" \
  --env-map "TWITTER_API_KEY={{credential}}"
```

Now agents can run CLI tools through Janee without ever seeing the API key:

```typescript
// Agent calls janee_exec tool
janee_exec({
  capability: "twitter",
  command: ["bird", "post", "Hello world!"],
  cwd: "/home/agent/project",  // optional working directory
  reason: "User asked to post a tweet"
})
```

Janee spawns the process with `TWITTER_API_KEY` injected, runs the command, and returns stdout/stderr. The credential never enters the agent's context.

**Key flags:**
- `--exec` — configure as exec-mode (CLI wrapper instead of HTTP proxy)
- `--allow-commands` — whitelist of allowed executables (security)
- `--env-map` — map credentials to environment variables
- `--work-dir` — working directory for the subprocess
- `--timeout` — max execution time (default: 30s)


### Git operations (automatic HTTPS auth)

When using exec mode with GitHub credentials, Janee automatically handles git authentication. No extra configuration needed — `git push`, `git pull`, and `git clone` just work:

```yaml
capabilities:
  - name: git-ops
    service: github
    mode: exec
    allowCommands: [git]
    env:
      GH_TOKEN: "{{credential}}"
```

```typescript
// Agent can push code without ever seeing the token
janee_exec({
  capability: "git-ops",
  command: ["git", "push", "origin", "main"],
  cwd: "/workspace/my-repo"
})
```

Janee detects `git` commands with `GH_TOKEN`/`GITHUB_TOKEN` in the environment and creates a temporary askpass script for HTTPS authentication. The script is cleaned up automatically after the command completes.

### Add GitHub App auth (for autonomous agents)

Static tokens are risky for long-running agents. GitHub App auth generates short-lived installation tokens on demand — no long-lived PATs required.

**Option 1: Use create-gh-app (recommended)**

```bash
npx @true-and-useful/create-gh-app create my-agent --owner @me
# Opens browser → creates app → saves credentials locally

# Install the app on your repos
# https://github.com/apps/my-agent/installations/new

# Register with Janee in one command
npx @true-and-useful/create-gh-app janee-add my-agent
```

Done. Your agent now gets short-lived GitHub tokens through Janee's MCP proxy.

**Option 2: Manual setup**

```bash
janee add github-app \
  --auth-type github-app \
  --app-id 123456 \
  --pem-file /path/to/private-key.pem \
  --installation-id 789
```

Or via config:

```yaml
services:
  github:
    baseUrl: https://api.github.com
    auth:
      type: github-app
      appId: "123456"
      pemFile: /path/to/private-key.pem
      installationId: "789"
```

**How it works:** When an agent requests access, Janee signs a JWT with the app's private key, exchanges it for a 1-hour installation token via GitHub's API, and caches the token until expiry. The agent never sees the private key — only the short-lived token reaches the API.

### Start the MCP server

```bash
janee serve
```

### Use with your agent

Agents that support MCP (Claude Desktop, Cursor, OpenClaw) can now call the `execute` tool to make API requests through Janee:

```typescript
// Agent calls the execute tool
execute({
  capability: "stripe",
  method: "GET",
  path: "/v1/balance",
  reason: "User asked for account balance"
})
```

Janee decrypts the key, makes the request, logs everything, and returns the response.

---

## Integrations

Works with any agent that speaks MCP:

- **OpenClaw** — Native plugin (`@true-and-useful/janee-openclaw`)
  - **Containerized agents?** See [Container setup guide](docs/container-openclaw.md)
- **Cursor** — [Setup guide](docs/cursor.md)
- **Claude Code** — [Setup guide](docs/claude-code.md)
- **Codex CLI** — [Setup guide](docs/codex.md)
- **Any MCP client** — just point at `janee serve`

---

## OpenClaw Integration

If you're using [OpenClaw](https://openclaw.ai), install the plugin for native tool support:

```bash
npm install -g @true-and-useful/janee
janee init
# Edit ~/.janee/config.yaml with your services

# Install the OpenClaw plugin
openclaw plugins install @true-and-useful/janee-openclaw
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

---

## MCP Tools

Janee exposes three MCP tools:

| Tool | Description |
|------|-------------|
| `list_services` | Discover available APIs and their policies |
| `execute` | Make an API request through Janee (HTTP proxy mode) |
| `exec` | Run a CLI command with injected credentials (exec mode) |
| `manage_credential` | View, grant, or revoke access to agent-scoped credentials |
| `reload_config` | Reload config from disk after adding/removing services (available when started with `janee serve`) |

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

### Supported auth types

| Type | Description | Example |
|------|-------------|---------|
| `bearer` | Bearer token in Authorization header | Stripe, OpenAI, GitHub |
| `basic` | HTTP Basic Auth (username + password) | Internal APIs |
| `hmac-bybit` | HMAC-SHA256 signing for Bybit | Bybit exchange |
| `hmac-okx` | HMAC-SHA256 + passphrase for OKX | OKX exchange |
| `hmac-mexc` | HMAC-SHA256 signing for MEXC | MEXC exchange |
| `headers` | Custom key-value headers | Non-standard APIs |
| `service-account` | Google service account JSON key | Google Cloud |
| `github-app` | Short-lived GitHub installation tokens | GitHub API |
| `oauth1a-twitter` | OAuth 1.0a per-request signing | Twitter/X API v2 |
| `aws-sigv4` | AWS Signature V4 per-request signing | SES, S3, and other AWS services |

#### Twitter/X OAuth 1.0a

Janee computes OAuth 1.0a signatures (HMAC-SHA1) server-side, so your 4 Twitter secrets stay encrypted at rest and never enter the agent's context:

```yaml
services:
  twitter:
    baseUrl: https://api.x.com
    auth:
      type: oauth1a-twitter
      consumerKey: xxx        # encrypted at rest
      consumerSecret: xxx     # encrypted at rest
      accessToken: xxx        # encrypted at rest
      accessTokenSecret: xxx  # encrypted at rest

capabilities:
  twitter:
    service: twitter
    ttl: 1h
    autoApprove: true
```

Or use the built-in template:

```bash
janee add twitter
```

#### AWS SigV4

Janee computes AWS Signature V4 (HMAC-SHA256) per-request, keeping your access keys encrypted at rest. Non-secret fields (`region`, `awsService`) stay in plain config:

```yaml
services:
  aws-ses:
    baseUrl: https://email.us-east-1.amazonaws.com
    auth:
      type: aws-sigv4
      accessKeyId: AKIA...     # encrypted at rest
      secretAccessKey: xxx     # encrypted at rest
      region: us-east-1
      awsService: ses

capabilities:
  aws-ses:
    service: aws-ses
    ttl: 1h
    autoApprove: true
```

Built-in templates for common AWS services:

```bash
janee add aws-ses    # Amazon SES
janee add aws-s3     # Amazon S3
```

### Access control

Control which agents can use which capabilities:

```yaml
server:
  host: localhost
  defaultAccess: restricted   # capabilities require explicit allowlist

capabilities:
  stripe:
    service: stripe
    ttl: 1h
    allowedAgents: ["agent-a", "agent-b"]   # only these agents can use it

  github:
    service: github
    ttl: 1h
    # no allowedAgents + defaultAccess: restricted → no agent can use this
```

- **`defaultAccess: restricted`** — capabilities without an `allowedAgents` list are hidden from all agents
- **`defaultAccess: open`** (default) — capabilities without an `allowedAgents` list are available to all agents
- **`allowedAgents`** — per-capability list of agent names (matched against `clientInfo.name` from the MCP initialize handshake)

Credentials created by agents at runtime default to `agent-only` access — only the creating agent can use them unless it explicitly grants access via the `manage_credential` tool.

### Exec mode capabilities

```yaml
services:
  twitter:
    auth:
      type: bearer
      key: tvly-xxx

capabilities:
  twitter:
    service: twitter
    mode: exec
    allowCommands: ["bird", "tweet-cli"]
    envMap:
      TWITTER_API_KEY: "{{credential}}"
    ttl: 1h
    autoApprove: true
```

Exec-mode capabilities use `janee_exec` instead of `execute`. The credential is injected as an environment variable — the agent sees only stdout/stderr.

Runner hardening defaults in exec mode:
- isolated minimal environment (no full host env inheritance)
- temporary `HOME` per command
- timeout kills the process group

### Runner/Authority mode (for containers)

When agents run inside Docker containers, `janee_exec` on a remote host cannot access the container filesystem. The Runner/Authority architecture solves this:

- **Authority** runs on the host: holds credentials, enforces policy, proxies API requests
- **Runner** runs inside each container: serves MCP to the agent, forwards non-exec calls to the Authority, runs `janee_exec` locally

```bash
# Host: start Authority (MCP + exec authorization on one port)
janee serve -t http -p 3100 --host 0.0.0.0 --runner-key "$JANEE_RUNNER_KEY"

# Container: start Runner (agent talks to this)
janee serve -t http -p 3200 --host 127.0.0.1 \
  --authority http://host.docker.internal:3100 --runner-key "$JANEE_RUNNER_KEY"
```

The agent only needs `JANEE_URL=http://localhost:3200`.

You can also run the Authority as a standalone process:

```bash
janee authority --runner-key "$JANEE_RUNNER_KEY" --host 127.0.0.1 --port 9120
```

See the [Runner/Authority guide](docs/runner-authority.md) for the full architecture, exec authorization flow, Docker Compose example, and troubleshooting.


---

## Request Policies

Control exactly what requests each capability can make using `rules`:

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
        - DELETE *
```

**How rules work:**

1. **`deny` patterns are checked first** — explicit deny always wins
2. **Then `allow` patterns are checked** — must match to proceed
3. **No rules defined** → allow all (backward compatible)
4. **Rules defined but no match** → denied by default

**Pattern format:** `METHOD PATH`

- `GET *` → any GET request
- `POST /v1/charges/*` → POST to /v1/charges/ and subpaths
- `* /v1/customers` → any method to /v1/customers
- `DELETE /v1/customers/*` → DELETE any customer

**This makes security real:** Even if an agent lies about its "reason", it can only access the endpoints the policy allows. Enforcement happens server-side.

---

## CLI Reference

```bash
janee init                    # Set up ~/.janee/ with example config
janee add                     # Add a service (interactive)
janee add stripe -u https://api.stripe.com -k sk_xxx  # Add with args
janee remove <service>        # Remove a service
janee remove <service> --yes  # Remove without confirmation
janee list                    # List configured services
janee list --json             # Output as JSON (for integrations)
janee search [query]          # Search service directory
janee search stripe --json    # Search with JSON output
janee cap list                # List capabilities
janee cap list --json         # List capabilities as JSON
janee cap add <name> --service <service>  # Add capability
janee cap edit <name>         # Edit capability
janee cap remove <name>       # Remove capability
janee serve                   # Start MCP server (stdio, default)
janee serve --transport http --port 9100  # Start with HTTP transport (for containers)
janee serve --authority https://janee.example.com --runner-key $JANEE_RUNNER_KEY  # Runner mode
janee authority --runner-key $JANEE_RUNNER_KEY  # Start authority API
janee logs                    # View audit log
janee logs -f                 # Tail audit log
janee logs --json             # Output as JSON
janee sessions                # List active sessions
janee sessions --json         # Output as JSON
janee revoke <id>             # Kill a session
```

### Non-interactive Setup (for AI agents)

AI agents can't respond to interactive prompts. Use `--*-from-env` flags to read credentials from environment variables — this keeps secrets out of the agent's context window:

```bash
# Bearer auth (Stripe, OpenAI, etc.)
janee add stripe -u https://api.stripe.com --auth-type bearer --key-from-env STRIPE_KEY

# HMAC auth (Bybit)
janee add bybit --auth-type hmac-bybit --key-from-env BYBIT_KEY --secret-from-env BYBIT_SECRET

# HMAC auth with passphrase (OKX)
janee add okx --auth-type hmac-okx --key-from-env OKX_KEY --secret-from-env OKX_SECRET --passphrase-from-env OKX_PASS

# GitHub App auth (short-lived tokens)
janee add github --auth-type github-app --app-id-from-env GH_APP_ID --pem-from-env GH_PEM --installation-id-from-env GH_INSTALL_ID

# Twitter/X OAuth 1.0a (per-request signing)
janee add twitter --consumer-key $TWITTER_CONSUMER_KEY --consumer-secret $TWITTER_CONSUMER_SECRET \
  --access-token $TWITTER_ACCESS_TOKEN --access-token-secret $TWITTER_ACCESS_TOKEN_SECRET

# AWS SigV4 (SES, S3, etc.)
janee add aws-ses --access-key-id $AWS_ACCESS_KEY_ID --secret-access-key $AWS_SECRET_ACCESS_KEY \
  --region us-east-1 --aws-service ses
```

When all required credentials are provided via flags, Janee:
- Never opens readline (no hanging on stdin)
- Auto-creates a capability with sensible defaults (1h TTL, auto-approve)

You can also edit `~/.janee/config.yaml` directly if you prefer.

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

1. Agent calls `execute` MCP tool with capability, method, path
2. Janee looks up service config, decrypts the real key
3. Makes HTTP request to real API with key
4. Logs: timestamp, service, method, path, status
5. Returns response to agent

Agent never touches the real key.

> 📐 **Deep dive:** See [Architecture & Security Model](docs/architecture.md) for detailed diagrams, threat model, and comparison with alternatives.

---

## Security

- **Encryption**: Keys stored with AES-256-GCM
- **Agent identity**: Derived from `clientInfo.name` in the MCP initialize handshake — no custom headers needed
- **Agent isolation**: Each agent gets its own session with isolated identity (HTTP transport creates a Server+Transport per session)
- **Access control**: Per-capability `allowedAgents` whitelist + server-wide `defaultAccess` policy
- **Credential scoping**: Agent-created credentials default to `agent-only`
- **Audit log**: Every request logged to `~/.janee/logs/`
- **Sessions**: Time-limited, revocable
- **Kill switch**: `janee revoke` or delete config

---


## Docker

Run Janee as a container — no local Node.js required:

```bash
# Build
docker build -t janee .

# Run in HTTP mode
docker run -d -p 3000:3000 \
  -v ~/.janee:/root/.janee:ro \
  janee --transport http --port 3000 --host 0.0.0.0
```

Or use Docker Compose:

```bash
mkdir -p config && cp ~/.janee/config.yaml config/
docker compose up -d
```

For Claude Desktop with Docker, see [Docker docs](docs/docker.md).

---
## Contributing

We welcome contributions! Please read **[CONTRIBUTING.md](docs/CONTRIBUTING.md)** before submitting a PR — it includes the required PR checklist (tests, changelog, version bump, etc.).

---

## License

MIT — Built by [True and Useful LLC](https://trueanduseful.com)

---

**Stop giving AI agents your keys. Start controlling access.** 🔐

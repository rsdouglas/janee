# Janee 🔐

**Secrets management for AI agents — with LLM-adjudicated access control**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/janee.svg)](https://www.npmjs.com/package/janee)

---

## The Problem

AI agents need API access to be useful, but the current model is **"give them all your keys and hope they behave."**

This is terrifying:
- 🔓 Agents have full access to Stripe, AWS, databases
- 📊 No audit trail of *why* something was accessed
- 🚫 No kill switch when things go wrong
- 💉 One prompt injection away from disaster

---

## The Solution

Janee is a **local proxy** that sits between your AI agents and your APIs:

1. 🔒 Store your API keys (encrypted locally in `~/.janee/`)
2. 🤖 Run `janee serve` (local proxy on `localhost:9119`)
3. 🔗 Point your agent to `http://localhost:9119/<service>/...`
4. 🛡️ Janee proxies requests with the real key (agent never sees it)
5. 📋 Everything logged for audit

**Your keys never leave your machine. Agents never see them. You stay in control.**

---

## Quick Start with OpenClaw

**If you're running an OpenClaw agent** (like Kit), add Janee protection in < 10 minutes:

```bash
# 1. Install Janee
npm install -g janee

# 2. Initialize
janee init

# 3. Add your services
janee add gmail --url https://gmail.googleapis.com --key <your-key>
janee add stripe --url https://api.stripe.com --key sk_live_xxx
janee add bybit --url https://api.bybit.com --key <your-key>

# 4. Start proxy
janee serve
```

**5. Update your OpenClaw tools:**

In your OpenClaw workspace, update tool configs to use Janee proxy:

```yaml
# Before:
gmail:
  baseUrl: https://gmail.googleapis.com
  apiKey: <real-key>

# After:
gmail:
  baseUrl: http://localhost:9119/gmail
  apiKey: dummy  # Won't be used, Janee injects real key
```

**That's it!** Now:
- ✅ Your agent never sees real keys
- ✅ All API access logged to `~/.janee/logs/`
- ✅ Keys encrypted at rest
- ✅ You can `janee logs -f` to see what Kit is doing in real-time

---

## Quick Start (General)

### Install

```bash
npm install -g janee
```

### Initialize

```bash
janee init
```

### Add a service

```bash
janee add stripe
# Prompts for base URL and API key
```

Or non-interactively:

```bash
janee add stripe --url https://api.stripe.com --key sk_live_xxx
```

### Start the proxy

```bash
janee serve
```

Output:
```
🔐 Janee proxy server running

   Local:   http://localhost:9119

Services configured:
   • stripe → http://localhost:9119/stripe/...

Press Ctrl+C to stop
```

### Use in your agent

Instead of:
```javascript
const stripe = new Stripe('sk_live_xxx'); // ❌ Agent sees your key
```

Do:
```javascript
const stripe = new Stripe('dummy', {
  host: 'localhost:9119',
  protocol: 'http',
  basePath: '/stripe'
});
// ✅ Agent never sees real key
```

Or with plain HTTP:
```bash
curl http://localhost:9119/stripe/v1/balance
```

---

## Features

### ✅ Local & Secure
- Keys stored encrypted in `~/.janee/` (AES-256-GCM)
- Proxy runs on localhost (no external traffic)
- You control when it runs (`janee serve`)

### 🧠 Optional LLM Adjudication *(coming soon)*
- Rules-first evaluation (fast)
- LLM for ambiguous cases (bring your own OpenAI/Anthropic key)
- Cost-optimized with caching

### 📋 Full Audit Trail
- Every request logged to `~/.janee/logs/`
- JSONL format (one event per line)
- View with `janee logs` or `janee logs -f` (tail)

### 🎯 Policies *(coming soon)*
- Read-only mode
- Endpoint allowlists/blocklists
- Rate limiting

---

## CLI Reference

### `janee init`

Initialize Janee configuration (creates `~/.janee/`)

### `janee add <service>`

Add a service to Janee.

**Options:**
- `-u, --url <url>` — Base URL of the service
- `-k, --key <key>` — API key for the service
- `-d, --description <desc>` — Description

**Example:**
```bash
janee add github \
  --url https://api.github.com \
  --key ghp_xxx \
  --description "GitHub API"
```

### `janee serve`

Start the Janee proxy server.

**Options:**
- `-p, --port <port>` — Port to listen on (default: 9119)
- `--no-llm` — Disable LLM adjudication

**Example:**
```bash
janee serve --port 8080
```

### `janee list`

List all configured services.

### `janee logs`

View audit logs.

**Options:**
- `-f, --follow` — Follow logs in real-time (like `tail -f`)
- `-n, --lines <count>` — Number of recent logs to show (default: 20)
- `-s, --service <name>` — Filter by service

**Examples:**
```bash
janee logs                    # Show last 20 requests
janee logs -n 100             # Show last 100 requests
janee logs -s stripe          # Show only Stripe requests
janee logs -f                 # Follow in real-time
```

### `janee remove <service>`

Remove a service from Janee.

---

## How It Works

```
┌─────────────┐      ┌──────────┐      ┌─────────┐
│ AI Agent    │─────▶│  Janee   │─────▶│  Stripe │
│             │ HTTP │  Proxy   │ key  │   API   │
└─────────────┘      └──────────┘      └─────────┘
      ↓                    ↓
   No key            Real key injected
                     + logged
```

1. Agent makes request to `localhost:9119/stripe/v1/balance`
2. Janee:
   - Looks up `stripe` service config
   - Decrypts the real API key
   - Proxies request to `https://api.stripe.com/v1/balance`
   - Injects `Authorization: Bearer sk_live_xxx` header
   - Logs the request (service, method, path, status)
3. Response returned to agent
4. Agent never sees the real key

---

## Integrations

**Works with any agent that can accept a custom base URL.**

### OpenClaw

**First-class integration** — See [docs/OPENCLAW.md](docs/OPENCLAW.md) for complete guide.

Quick start:
```bash
janee add gmail && janee add stripe && janee serve
# Update OpenClaw tool configs to use localhost:9119/<service>
```

**Kit (Ross's main agent) uses Janee for all API access.**

### Cursor

```json
// .cursorrules or workspace settings
{
  "apiEndpoints": {
    "stripe": "http://localhost:9119/stripe"
  }
}
```

### Claude Desktop

Configure base URLs in MCP server configs to point at Janee proxy.

### LangChain (Python)

```python
# Configure SDK to use Janee proxy
import stripe
stripe.api_base = "http://localhost:9119/stripe"
```

### Any HTTP Client

```bash
# Just change the base URL
curl http://localhost:9119/stripe/v1/balance
curl http://localhost:9119/github/repos/user/repo
```

**The pattern:** Change base URL → that's it!

---

## Design Philosophy

**Frictionless integration is the goal.**

- ✅ No SDK changes needed
- ✅ No code changes in your agent
- ✅ Just reconfigure base URLs
- ✅ Works with any HTTP client
- ✅ < 10 minutes to add to existing agent

If an agent can make HTTP requests with a custom base URL, it can use Janee.

---

## Security

### Key Storage

Keys are encrypted with AES-256-GCM using a master key generated at `janee init`.

**Config file:** `~/.janee/config.json` (permissions: `0600`)

```json
{
  "version": "0.1.0",
  "masterKey": "<base64-encoded-256-bit-key>",
  "services": [
    {
      "name": "stripe",
      "baseUrl": "https://api.stripe.com",
      "encryptedKey": "<base64-iv+tag+ciphertext>",
      "createdAt": "2024-02-02T16:00:00Z"
    }
  ]
}
```

### Network Security

- Proxy listens on `localhost` only (not exposed to network)
- Keys never leave your machine
- No external traffic except proxied API calls

### Audit Logs

All requests logged to `~/.janee/logs/YYYY-MM-DD.jsonl`:

```json
{"id":"abc123","timestamp":"2024-02-02T16:30:45Z","service":"stripe","method":"GET","path":"/v1/balance","statusCode":200}
```

---

## Roadmap

**✅ Phase 1: Core Proxy** (DONE)
- CLI tool (`janee init`, `add`, `serve`)
- Local HTTP proxy
- Encrypted key storage
- Audit logging

**🚧 Phase 2: Intelligence** (IN PROGRESS)
- LLM adjudication (OpenAI/Anthropic)
- Policy engine (read-only, allowlists, blocklists)
- Rate limiting

**📋 Phase 3: Advanced**
- Session tokens (request access with intent)
- Web dashboard (optional, `janee dashboard`)
- Multiple auth patterns (not just Bearer tokens)
- Cloud version (managed hosting)

---

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT License - see [LICENSE](LICENSE)

---

## Team

Built by [Ross Douglas](https://github.com/rsdouglas) and [David Wilson](https://github.com/daviddbwilson)

Previously: Co-founded Cape Networks (acquired by HPE/Aruba)

---

**Stop hoping your AI agents behave. Start controlling them.** 🔐

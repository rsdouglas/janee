# Using Janee with OpenClaw

Native integration between Janee and [OpenClaw](https://openclaw.ai) via MCP plugin.

---

## Why Janee + OpenClaw?

OpenClaw agents often need access to multiple APIs — Gmail, Stripe, trading exchanges, databases, etc. Without Janee, API keys live in config files and agents have unrestricted access.

**With Janee:**
- 🔐 Keys stay encrypted in `~/.janee/` (never in config files)
- 🛠️ Agent uses `janee_*` tools (native OpenClaw integration)
- 📝 Full audit trail of every API call
- 🚦 Future: LLM adjudication for sensitive operations
- 🚨 Kill switch: stop Janee or delete config

---

## Quick Start

### 1. Install Janee CLI

```bash
npm install -g janee
```

### 2. Initialize Janee

```bash
janee init
```

Creates `~/.janee/config.yaml` with example config.

### 3. Add Your API Credentials

Edit `~/.janee/config.yaml` and uncomment/add your services:

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx

  github:
    baseUrl: https://api.github.com
    auth:
      type: bearer
      key: ghp_xxx

  bybit:
    baseUrl: https://api.bybit.com
    auth:
      type: hmac
      apiKey: xxx
      apiSecret: xxx

capabilities:
  stripe:
    service: stripe
    ttl: 1h
    autoApprove: true

  github:
    service: github
    ttl: 30m
    autoApprove: true

  bybit:
    service: bybit
    ttl: 15m
    requiresReason: true
```

### 4. Install OpenClaw Plugin

```bash
openclaw plugins install @openclaw/janee
```

### 5. Enable Plugin in Agent Config

Edit your agent config (usually `~/.openclaw/config.json5`):

```json5
{
  agents: {
    list: [
      {
        id: "main",
        tools: {
          allow: ["janee"]  // Enables janee_* tools
        }
      }
    ]
  }
}
```

Restart OpenClaw:

```bash
openclaw gateway restart
```

---

## How It Works

```
Agent thinks: "I need to check Stripe balance"
    ↓
Agent calls: janee_execute({ service: "stripe", method: "GET", path: "/v1/balance" })
    ↓
OpenClaw Plugin spawns: janee serve (MCP server via stdio)
    ↓
Janee decrypts key, makes HTTP request to api.stripe.com
    ↓
Logs to: ~/.janee/logs/2026-02-03.jsonl
    ↓
Returns response to agent
```

The agent never sees the real API key. Janee handles injection + logging.

---

## Available Tools

The plugin exposes two tools to your agent:

### `janee_list_services`

Lists all configured services:

```typescript
janee_list_services()
// Returns: ["stripe", "github", "bybit", "gmail"]
```

The agent can discover what APIs are available without hardcoding service names.

### `janee_execute`

Makes API requests through Janee:

```typescript
janee_execute({
  service: "stripe",
  method: "GET",
  path: "/v1/balance",
  reason: "User asked for account balance"
})

janee_execute({
  service: "github",
  method: "POST",
  path: "/repos/owner/repo/issues",
  body: JSON.stringify({ title: "Bug report", body: "Details..." }),
  reason: "Creating issue per user request"
})
```

**Parameters:**
- `service` — Service name from `janee_list_services`
- `method` — HTTP method (GET, POST, PUT, DELETE, PATCH)
- `path` — API endpoint path (e.g., `/v1/customers`)
- `body` — (Optional) Request body as JSON string
- `reason` — (Optional) Reason for the request (logged for audit, may be required for sensitive operations)

---

## Real-World Example: Kit Trading Crypto

Kit (Ross's main agent) uses Janee to access trading exchanges:

```typescript
// Check Bybit balance
const balance = await janee_execute({
  service: "bybit",
  method: "GET",
  path: "/v5/account/wallet-balance",
  reason: "User asked for portfolio summary"
});

// Place a limit order
const order = await janee_execute({
  service: "bybit",
  method: "POST",
  path: "/v5/order/create",
  body: JSON.stringify({
    category: "spot",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    qty: "0.001",
    price: "50000"
  }),
  reason: "Executing trade per user approval"
});
```

All requests logged. Ross can review:

```bash
janee logs --service bybit
```

---

## Monitoring

### Watch Live Requests

```bash
janee logs -f
```

Output:
```json
{"timestamp":"2026-02-03T08:15:00.000Z","service":"stripe","method":"GET","path":"/v1/balance","status":200,"duration":123}
{"timestamp":"2026-02-03T08:15:05.000Z","service":"bybit","method":"POST","path":"/v5/order/create","status":200,"duration":456,"reason":"Executing trade per user approval"}
```

### Filter by Service

```bash
janee logs --service stripe
```

### Review Specific Date

```bash
janee logs --date 2026-02-03
```

### Parse Logs with jq

```bash
# Find all failed requests
janee logs | jq 'select(.status >= 400)'

# Count requests per service
janee logs | jq -r '.service' | sort | uniq -c

# Find requests with no reason
janee logs | jq 'select(.reason == null)'
```

---

## Security

### Kill Switch

If your agent goes rogue:

```bash
# Option 1: Remove config (immediate lockdown)
rm ~/.janee/config.json

# Option 2: Remove specific service
janee remove stripe

# Option 3: Kill the MCP server
# (OpenClaw plugin spawns janee serve; killing it stops all access)
pkill -f "janee serve"
```

### Key Storage

- Keys encrypted with AES-256-GCM
- Master key derived from user-specific seed
- Config files locked to user-only (chmod 0600)

### Audit Trail

Every request logged:
- Timestamp
- Service
- Method + path
- Status code
- Duration
- Reason (if provided)

Logs never expire. Review them anytime.

---

## Multiple Agents

If you run multiple OpenClaw agents (e.g., Kit, Kitkat, Olivia), they share the same Janee instance. The plugin spawns `janee serve` per agent session.

For stricter separation:
- Run separate Janee configs on different directories
- Use environment variables to point to different config paths

Example:
```bash
# Agent 1 (Kit)
JANEE_CONFIG_DIR=~/.janee/kit janee serve

# Agent 2 (Kitkat)
JANEE_CONFIG_DIR=~/.janee/kitkat janee serve
```

---

## Phase 2 Features (Coming Soon)

### LLM Adjudication

For sensitive operations (large crypto trades, account changes), Janee can call an LLM to approve/deny:

```yaml
capabilities:
  bybit_sensitive:
    service: bybit
    requiresApproval: true
    llmProvider: openai
    llmModel: gpt-4
```

When the agent tries to place a $10k trade, Janee asks GPT-4: "Should this be allowed?" with context (recent activity, user preferences, risk limits).

### Policy Engine

```yaml
capabilities:
  stripe:
    service: stripe
    allowedEndpoints:
      - /v1/balance
      - /v1/customers
    blockedEndpoints:
      - /v1/charges  # Prevent agent from charging cards
    rateLimit:
      requests: 100
      window: 1h
```

### Session Tokens

For longer-running tasks:

```typescript
// Request access with intent
const session = await janee_request_access({
  service: "stripe",
  reason: "Processing invoices for next hour",
  ttl: 3600
});

// Use session token for multiple requests
await janee_execute({ sessionToken: session.token, ... });
```

---

## Troubleshooting

### Plugin Can't Find Janee

**Error:** `command not found: janee`

**Fix:**
```bash
npm install -g janee
which janee  # Should return a path
```

### Connection Errors

**Error:** `Failed to connect to Janee MCP server`

**Debug:**
```bash
# Try running MCP server manually
janee serve

# Check config exists
ls -l ~/.janee/config.json

# Check services are configured
janee list
```

### Permission Errors

**Error:** `EACCES: permission denied, open '/Users/you/.janee/config.json'`

**Fix:**
```bash
# Config should be readable only by you
ls -l ~/.janee/config.json
# Should show: -rw------- (0600)

# If not, fix permissions
chmod 0600 ~/.janee/config.json
```

### Agent Not Seeing Tools

**Error:** Agent doesn't have `janee_*` tools

**Fix:**
1. Check plugin is installed: `openclaw plugins list`
2. Check agent config has `tools: { allow: ["janee"] }`
3. Restart OpenClaw: `openclaw gateway restart`

---

## Design Philosophy

**MCP-first.** Janee uses the Model Context Protocol standard. No custom protocols, no HTTP endpoints, no authentication gymnastics.

**No code changes.** The plugin integrates at the tool level. Your agent's skills/prompts don't need to know about Janee — they just call the tools.

**Discoverable.** Agent calls `janee_list_services` to see what's available. No hardcoded service names.

**Auditable.** Every request logged with timestamp, service, endpoint, and reason.

**Kill-switchable.** Delete config or stop server = immediate lockdown.

---

## Migration from Direct API Access

If your agent currently has API keys in config:

### Before (Insecure)

```json5
{
  agents: {
    list: [{
      id: "main",
      env: {
        STRIPE_API_KEY: "sk_live_xxx",
        GITHUB_TOKEN: "ghp_xxx"
      }
    }]
  }
}
```

### After (Janee)

```json5
{
  agents: {
    list: [{
      id: "main",
      tools: { allow: ["janee"] }
      // No API keys in config!
    }]
  }
}
```

Move keys to Janee by editing `~/.janee/config.yaml`:

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx

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

  github:
    service: github
    ttl: 30m
    autoApprove: true
```

Update agent code to use tools:

```typescript
// Before
const stripe = require('stripe')(process.env.STRIPE_API_KEY);
const balance = await stripe.balance.retrieve();

// After
const balance = await janee_execute({
  service: "stripe",
  method: "GET",
  path: "/v1/balance"
});
```

---

## Next Steps

1. **Install Janee + plugin** (5 minutes)
2. **Move one API key** (Stripe or GitHub — start small)
3. **Test with agent** (call `janee_list_services`, then `janee_execute`)
4. **Watch logs** (`janee logs -f` — see it work)
5. **Move more keys** (once you trust it)

**Total setup time: < 10 minutes**

---

## Questions?

- GitHub Issues: https://github.com/rsdouglas/janee/issues
- OpenClaw Discord: https://discord.com/invite/clawd (mention Janee)
- Email: ross@openclaw.ai

---

**Stop giving AI agents your keys. Start controlling access.** 🔐

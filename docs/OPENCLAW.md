# Using Janee with OpenClaw

**First-class integration** — OpenClaw agents can use Janee with zero code changes.

---

## Why Janee + OpenClaw?

OpenClaw agents (like Kit) need access to many APIs:
- Gmail for email
- Stripe for payments
- Bybit/MEXC for crypto trading
- Databases, admin APIs, etc.

**Current risk:** Agent has direct access to all keys

**With Janee:**
- Keys live in Janee (encrypted at rest)
- Agent proxies through `localhost:9119`
- Full audit trail of what agent accessed and when
- Instant kill switch (stop Janee proxy)

---

## Setup (< 10 minutes)

### 1. Install Janee

```bash
npm install -g janee
```

### 2. Initialize

```bash
janee init
```

This creates `~/.janee/` and generates a master encryption key.

### 3. Add Your Services

```bash
# Gmail API
janee add gmail \
  --url https://gmail.googleapis.com \
  --key <your-oauth-token>

# Stripe API
janee add stripe \
  --url https://api.stripe.com \
  --key sk_live_xxx

# Crypto exchanges
janee add bybit \
  --url https://api.bybit.com \
  --key <your-api-key>

janee add mexc \
  --url https://api.mexc.com \
  --key <your-api-key>

# Verify
janee list
```

### 4. Start Proxy

```bash
janee serve
```

Or run in background:

```bash
# In tmux/screen
janee serve

# Or with nohup
nohup janee serve > ~/.janee/proxy.log 2>&1 &
```

Janee is now running on `localhost:9119`.

### 5. Update OpenClaw Configuration

In your OpenClaw workspace, update tool configurations:

#### Option A: Tool-Specific Config

If tools have individual configs:

```yaml
# tools/gmail.yaml
baseUrl: http://localhost:9119/gmail
apiKey: dummy  # Won't be used

# tools/stripe.yaml
baseUrl: http://localhost:9119/stripe
apiKey: dummy

# tools/bybit.yaml
baseUrl: http://localhost:9119/bybit
apiKey: dummy
```

#### Option B: Environment Variables

If tools use env vars:

```bash
# Before
export GMAIL_API_BASE=https://gmail.googleapis.com
export GMAIL_API_KEY=<real-key>

# After
export GMAIL_API_BASE=http://localhost:9119/gmail
export GMAIL_API_KEY=dummy
```

#### Option C: Skill Wrapper (Advanced)

Create a Janee-aware OpenClaw skill:

```javascript
// skills/janee/api.js
async function callAPI(service, path, options = {}) {
  const url = `http://localhost:9119/${service}${path}`;
  
  // Janee handles auth, we just make the request
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body
  });

  return response.json();
}

module.exports = { callAPI };
```

Then in other skills:

```javascript
const janee = require('../janee/api');

// Instead of direct API call
const balance = await janee.callAPI('stripe', '/v1/balance');
```

---

## Usage

### Monitor What Kit Is Doing

```bash
# Real-time log tail
janee logs -f

# View recent activity
janee logs -n 50

# Filter by service
janee logs -s gmail
janee logs -s stripe
```

### Audit Trail

All requests logged to `~/.janee/logs/YYYY-MM-DD.jsonl`:

```json
{"id":"abc123","timestamp":"2024-02-03T10:30:45Z","service":"gmail","method":"GET","path":"/gmail/v1/messages","statusCode":200}
{"id":"def456","timestamp":"2024-02-03T10:31:12Z","service":"stripe","method":"GET","path":"/v1/balance","statusCode":200}
{"id":"ghi789","timestamp":"2024-02-03T10:32:03Z","service":"bybit","method":"POST","path":"/v5/order/create","statusCode":200}
```

Parse with `jq`:

```bash
# What APIs did Kit access today?
cat ~/.janee/logs/$(date +%Y-%m-%d).jsonl | jq -r '.service' | sort | uniq

# What Gmail endpoints?
cat ~/.janee/logs/*.jsonl | jq -r 'select(.service=="gmail") | .path' | sort | uniq

# Failed requests
cat ~/.janee/logs/*.jsonl | jq 'select(.statusCode >= 400)'
```

### Kill Switch

If Kit goes rogue:

```bash
# Stop proxy immediately
pkill -f "janee serve"

# Or just Ctrl+C in the terminal where it's running
```

All API access stops instantly (agents get connection refused).

---

## Benefits for OpenClaw

### 1. Security

- ✅ Keys never in OpenClaw config files
- ✅ Keys encrypted at rest in `~/.janee/`
- ✅ Agent never sees real keys
- ✅ Instant revocation (stop proxy)

### 2. Auditability

- ✅ Every API call logged
- ✅ See what agents are accessing in real-time
- ✅ Parse logs for compliance/debugging
- ✅ Know exactly what happened when

### 3. Control

- ✅ Rate limiting *(coming in Phase 2)*
- ✅ Read-only mode for sensitive services *(coming in Phase 2)*
- ✅ Endpoint allowlists *(coming in Phase 2)*
- ✅ LLM evaluation of requests *(coming in Phase 2)*

### 4. Developer Experience

- ✅ Zero OpenClaw code changes
- ✅ Just change base URLs in config
- ✅ Works with any tool/skill
- ✅ Transparent proxy

---

## Example: Kit Trading Crypto

**Scenario:** Kit (OpenClaw agent) trades crypto on Bybit/MEXC

**Before Janee:**
```javascript
// Kit's trading skill has direct access
const bybit = new Bybit(REAL_API_KEY, REAL_SECRET);
await bybit.placeOrder({...}); // 😱 No oversight
```

**With Janee:**
```bash
# Ross sets up Janee
janee add bybit --url https://api.bybit.com --key <real-key>
janee serve

# Kit's config uses proxy
baseUrl: http://localhost:9119/bybit
```

Now:
- Kit makes trades as normal
- Every order logged to audit trail
- Ross can `janee logs -s bybit` to see all trades
- If something goes wrong: stop proxy, Kit loses access

**Future (Phase 2 with LLM):**
- Kit: "Place $1000 BTC long"
- Janee LLM: "Reasonable trade size, within policy" → Approve
- Kit: "Place $1,000,000 BTC long"
- Janee LLM: "Suspiciously large, flag for review" → Deny or alert Ross

---

## Advanced: Session Context (Phase 2)

Future enhancement: context-aware access requests

```bash
# Kit requests access with intent
POST localhost:9119/request-access
{
  "service": "gmail",
  "reason": "User asked to check inbox",
  "agentId": "kit-main"
}

# Janee returns session token
{ "token": "jnee_sess_abc123" }

# Kit uses token for subsequent requests
GET localhost:9119/gmail/v1/messages
Authorization: Bearer jnee_sess_abc123
```

This enables:
- Per-session audit trails
- LLM evaluation of intent
- Scoped access (only approved endpoints)

---

## Multiple OpenClaw Agents

If you run multiple agents (e.g., Kit, Kitkat, Olivia):

**Option 1: Shared Janee**

All agents use same Janee proxy:

```bash
# All agents configured with
baseUrl: http://localhost:9119/<service>

# Logs show which agent (if you pass agent ID in headers)
```

**Option 2: Separate Janee Instances**

Run Janee per agent:

```bash
# Kit's Janee
janee serve --port 9119

# Kitkat's Janee
janee serve --port 9120

# Olivia's Janee
janee serve --port 9121
```

Each agent has isolated keys and audit logs.

---

## Troubleshooting

### "Connection refused" when agent calls API

- Is Janee running? Check with `ps aux | grep janee`
- Is it listening on the right port? `lsof -i :9119`
- Try `janee serve` again

### "Service not found"

- Did you add the service? `janee list`
- Is the name correct? (case-sensitive)

### Keys not working

- Check config: `cat ~/.janee/config.json` (keys should be encrypted)
- Try re-adding: `janee remove <service> && janee add <service>`

### Agent still uses old API endpoint

- Make sure you updated the config
- Restart OpenClaw to pick up new config
- Check env vars aren't overriding

---

## Next Steps

1. **Test it:** Set up Janee, run for a day, check logs
2. **Phase 2:** Add LLM adjudication when ready
3. **Contribute:** Open an issue with feedback/requests

---

**Questions?** Open an issue: https://github.com/rsdouglas/janee/issues

**This is how Kit secures its API access. Now it's your turn.** 🔐

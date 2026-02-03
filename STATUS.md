# Janee Status — 2024-02-03

**Repo:** `~/repos/janee` (replaces old Cloudflare Workers version)  
**Approach:** CLI-first local tool (per Ross's pivot decision)  
**First integration target:** OpenClaw (Kit/Ross dogfooding)

---

## Phase 1: COMPLETE ✅

### What's Working

**CLI Commands:**
- `janee init` — Initialize ~/.janee/ with master key
- `janee add <service>` — Add encrypted services
- `janee serve` — Start HTTP proxy on localhost:9119
- `janee list` — Show configured services
- `janee logs` — View audit trail (`-f` for tail, `-s <service>` for filter)
- `janee remove <service>` — Delete service

**Core Features:**
- HTTP proxy server (transparent to agents)
- AES-256-GCM encryption for keys
- Audit logging (JSONL format in ~/.janee/logs/)
- Config storage (JSON in ~/.janee/config.json with 0600 perms)
- Tested and working with httpbin.org

**Architecture:**
```
src/
  core/              # Storage-agnostic (reusable for cloud)
    crypto.ts        # AES-256-GCM encryption
    proxy.ts         # HTTP proxy with hooks
    audit.ts         # Event logging
  cli/               # CLI-specific
    config.ts        # File-based storage
    commands/        # Individual commands
```

**Stats:**
- Time: ~4 hours
- Files: 18
- Lines: ~2,900
- Dependencies: 1 (commander)
- Commits: 4

---

## OpenClaw Integration: COMPLETE ✅

### First-Class Support Added

**Documentation:**
- OpenClaw quick start in main README (prominent placement)
- Complete guide: `docs/OPENCLAW.md` (7KB)
- Real examples: Kit trading crypto, Ross monitoring

**Setup Flow (< 10 minutes):**
```bash
# 1. Install Janee
npm install -g janee

# 2. Add services
janee init
janee add gmail --url https://gmail.googleapis.com --key <token>
janee add stripe --url https://api.stripe.com --key sk_xxx
janee add bybit --url https://api.bybit.com --key <key>

# 3. Start proxy
janee serve

# 4. Update OpenClaw tools
# Change baseUrl to http://localhost:9119/<service>
# That's it!
```

**Integration Options:**
1. Tool-specific YAML configs (change baseUrl)
2. Environment variables (point at localhost:9119)
3. Skill wrapper (abstraction layer)

**Benefits for Kit/Ross:**
- Keys never in OpenClaw configs
- Keys encrypted at rest
- Full audit trail (every API call logged)
- Real-time monitoring: `janee logs -f`
- Kill switch: stop proxy → Kit loses access

---

## Phase 2: TODO

### LLM Adjudication

Evaluate requests before proxying:

```typescript
// Before proxying request
if (config.settings.llmEnabled) {
  const result = await adjudicator.evaluate({
    service: 'bybit',
    method: 'POST',
    path: '/v5/order/create',
    reason: 'User asked to place BTC long',
    agentId: 'kit-main'
  });
  
  if (result.decision === 'DENIED') {
    return 403 with reasoning;
  }
}
```

**Implementation:**
- `src/core/adjudicator.ts` with OpenAI/Anthropic support
- User provides their own API key
- Rules-first (fast path) for clear cases
- LLM for ambiguous requests
- 5-minute caching for cost optimization

### Policy Engine

```typescript
interface Policy {
  readOnly?: boolean;               // Block POST/PUT/DELETE
  allowedEndpoints?: string[];      // Whitelist patterns
  blockedEndpoints?: string[];      // Blacklist patterns
  maxRequestsPerMinute?: number;    // Rate limiting
}

// Stored per-service in config
```

**Per-service policies:**
- Gmail: Read-only (no sending emails)
- Stripe: Only /v1/balance endpoint
- Bybit: Max 10 orders/minute

### Session Tokens (Optional)

```typescript
// Agent requests access with intent
POST /request-access
{
  "service": "stripe",
  "reason": "User asked to check balance",
  "agentId": "kit-main"
}

// Returns session token
{ "token": "jnee_sess_abc123", "expiresAt": "..." }

// Agent includes in subsequent requests
Authorization: Bearer jnee_sess_abc123
```

Enables:
- Context-aware LLM evaluation
- Per-session audit trails
- Scoped access (only approved endpoints)

---

## Design Decisions Made

### 1. Port Number: 9119

**Why:** Not commonly used, easy to remember, no conflicts

**Alternative:** Could make this configurable (already supports `--port`)

### 2. Authentication: Trust Localhost (for now)

**Current:** Proxy is open on localhost (anyone on machine can use)

**Rationale:**
- Single-user dev machine = fine
- Simplifies initial adoption
- Can add token-based auth later if needed

**Future:** Generate local token at init, require `X-Janee-Token` header

### 3. Auth Pattern: Bearer Only (for now)

**Current:** Always injects `Authorization: Bearer <key>`

**Reality:** Different APIs use:
- Stripe: `Bearer sk_xxx`
- GitHub: `token ghp_xxx`
- Some: `X-API-Key` header
- Some: Basic Auth

**Future:** Auto-detect or per-service config

---

## Open Questions

### For Ross/Kit Testing

1. **Does the OpenClaw integration work as documented?**
   - Can you change base URLs and have it "just work"?
   - Any friction points?

2. **Port number OK?**
   - Is 9119 fine or would you prefer something else?

3. **Auth to proxy needed?**
   - Trust localhost sufficient?
   - Or want token-based auth even locally?

4. **What services first?**
   - Gmail, Stripe, Bybit confirmed
   - What else does Kit need?

---

## Next Steps

1. **Ross/Kit test with OpenClaw**
   - Real services, real usage
   - Find rough edges

2. **Phase 2: LLM Adjudication**
   - Add `src/core/adjudicator.ts`
   - OpenAI/Anthropic integration
   - User provides their own key

3. **Phase 2: Policy Engine**
   - Add `src/core/policies.ts`
   - Per-service rules
   - Read-only mode, allowlists, rate limits

4. **Polish & Publish**
   - Better CLI UX (colors, progress)
   - Error handling improvements
   - Publish to npm

5. **Integration Guides**
   - Cursor (Desktop)
   - Claude Desktop (MCP)
   - LangChain, CrewAI, AutoGPT

6. **Cloud Version**
   - Reuse `src/core/` with KV storage
   - Managed hosting option
   - Team features, analytics

---

## Files Changed

```
~/repos/janee/
├── package.json
├── tsconfig.json
├── README.md                   # CLI-first, OpenClaw prominent
├── LICENSE                     # MIT
├── CHANGELOG.md
├── PHASE1_COMPLETE.md          # Detailed phase 1 status
├── STATUS.md                   # This file
├── docs/
│   └── OPENCLAW.md             # Complete OpenClaw guide
└── src/
    ├── core/
    │   ├── crypto.ts           # AES-256-GCM
    │   ├── proxy.ts            # HTTP proxy
    │   └── audit.ts            # Logging
    └── cli/
        ├── config.ts           # File-based storage
        ├── index.ts            # CLI entry
        └── commands/
            ├── init.ts
            ├── add.ts
            ├── serve.ts
            ├── list.ts
            ├── logs.ts
            └── remove.ts
```

---

## How to Test

```bash
cd ~/repos/janee
npm install
npm run build

# Initialize
node dist/cli/index.js init

# Add a service
node dist/cli/index.js add test \
  --url https://httpbin.org \
  --key test123

# Start proxy
node dist/cli/index.js serve

# Test (other terminal)
curl http://localhost:9119/test/get
# Should return httpbin.org's response

# View logs
node dist/cli/index.js logs

# Clean up
node dist/cli/index.js remove test
rm -rf ~/.janee
```

---

## Repository Status

- ✅ Fresh repo at `~/repos/janee`
- ✅ Not yet pushed to GitHub
- ✅ Will replace old Cloudflare Workers repo
- ✅ Ready for Ross/Kit testing
- ⏳ Awaiting npm publish

**Next:** Test with OpenClaw, then push to GitHub and publish to npm.

---

**Phase 1: ✅ COMPLETE**  
**OpenClaw Integration: ✅ COMPLETE**  
**Phase 2: 🚧 READY TO START**

🔐 Janee CLI is alive and ready for dogfooding!

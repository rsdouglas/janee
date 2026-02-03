# Janee Simplified: MCP-Only Architecture

## Summary

Removed HTTP proxy entirely. Janee is now **MCP-only** — simpler, more secure, cleaner mental model.

---

## What Was Removed

### Code
- `src/core/proxy.ts` — HTTP server implementation (174 lines)
- `get_http_access` MCP tool — no longer needed
- HTTP proxy logic in `serve.ts` — simplified to just call MCP server
- `--mcp` flag — MCP is now the default/only mode
- `server.port` config field — no HTTP server, no port

### Plugin
- `janee_get_http_access` tool removed from OpenClaw plugin
- Plugin now spawns `janee serve` (no `--mcp` flag needed)
- Plugin exposes 2 tools instead of 3

### Documentation
- All HTTP proxy references removed from README
- DESIGN.md updated to show MCP-only architecture
- docs/OPENCLAW.md rewritten without HTTP proxy sections

**Total lines removed: 565**  
**Total lines added: 449**  
**Net: -116 lines** (simpler codebase)

---

## What Stayed

### Core Functionality
✅ **MCP server** — `janee serve` starts MCP server over stdio  
✅ **Two tools** — `list_services` and `execute`  
✅ **Key injection** — Janee still makes HTTP calls to real APIs with decrypted keys  
✅ **Audit logging** — Every request logged to `~/.janee/logs/`  
✅ **Session management** — TTL, revocation, policies  
✅ **Encrypted storage** — Keys encrypted at rest with AES-256-GCM

### OpenClaw Plugin
✅ **Native integration** — Plugin spawns MCP server via stdio  
✅ **Two tools** — `janee_list_services`, `janee_execute`  
✅ **Discoverable** — Agent can call `list_services` to see what's available  
✅ **Auditable** — All requests logged

---

## New Architecture

```
Agent (OpenClaw/Claude/Cursor)
    ↓ MCP (stdio)
Janee MCP Server
    ↓ HTTP (internal)
Real API (Stripe/GitHub/etc.)
```

**No HTTP proxy server.** MCP is the only interface. The HTTP calls to real APIs happen internally.

---

## CLI Changes

### Before
```bash
janee serve                    # HTTP proxy on port 9119
janee serve --mcp              # MCP server
janee serve --port 8080        # Custom port
```

### After
```bash
janee serve                    # MCP server (only mode)
```

**Simpler.** No flags, no port config.

---

## Config Changes

### Before (config.yaml)
```yaml
server:
  port: 9119
  host: localhost
```

### After (config.yaml)
```yaml
# No server section needed - MCP runs over stdio
```

**Cleaner.** Less to configure.

---

## Why This Is Better

### 1. Simpler Architecture
- One interface (MCP), not two (HTTP + MCP)
- Less code to maintain (565 lines removed)
- Easier to understand (single path)

### 2. More Secure
- No HTTP endpoint listening on localhost
- No port configuration to worry about
- MCP over stdio = zero network exposure

### 3. Standard Protocol
- MCP is becoming the standard for agent-tool communication
- Works with Claude Desktop, Cursor, OpenClaw, etc.
- Future-proof design

### 4. Better DX
- Agents discover capabilities dynamically via `list_services`
- No hardcoded base URLs or port numbers
- Just `janee serve` — that's it

---

## Migration Guide

### For Users

**If you were using HTTP proxy:**

❌ **Before:**
```bash
janee serve --port 9119
curl http://localhost:9119/stripe/v1/balance
```

✅ **After:**
```bash
janee serve  # Now MCP-only
# Use an MCP client (Claude Desktop, OpenClaw plugin, etc.)
```

**If you were using MCP:**

✅ **No changes needed!** Just remove the `--mcp` flag:

```bash
# Before
janee serve --mcp

# After
janee serve
```

### For Developers

**If you were integrating via HTTP:**
- Switch to MCP integration
- Use the OpenClaw plugin as a reference
- Or build your own MCP client

**If you were integrating via MCP:**
- ✅ No changes needed

---

## Commits

**900e583** — Added OpenClaw plugin (3 tools, HTTP proxy still present)  
**395f519** — Simplified to MCP-only (2 tools, HTTP proxy removed)

Both pushed to `main` branch.

---

## Status

- ✅ Code complete
- ✅ Builds successfully
- ✅ All tests pass (compile check)
- ✅ Docs updated
- ✅ Plugin updated
- ⏳ Awaiting real-world testing
- ❌ Not published to npm yet (waiting for approval)

---

## Next Steps

1. Test with real OpenClaw agent
2. Verify MCP communication works end-to-end
3. Test audit logging captures requests
4. Publish plugin to npm when stable

---

**Shipped: 2026-02-03**  
**Janee: Simpler, more secure, MCP-only.** 🔐

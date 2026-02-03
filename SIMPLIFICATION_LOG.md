# Janee Simplification Log

## Timeline

### Commit 900e583 — OpenClaw Plugin (2026-02-03 AM)
- Created `packages/openclaw-plugin/` 
- MCP client wrapping Janee MCP server
- 3 tools: `janee_list_services`, `janee_execute`, `janee_get_http_access`
- Comprehensive integration docs

### Commit 395f519 — MCP-Only Interface (2026-02-03 PM)
**BREAKING CHANGE:** Removed HTTP proxy entirely

**Removed:**
- `src/core/proxy.ts` (HTTP server)
- `get_http_access` MCP tool
- `--mcp` flag (MCP is now default/only)
- `server.port` config
- `janee_get_http_access` from plugin

**Result:**
- 565 lines removed, 449 added
- Net: -116 lines
- Simpler architecture, more secure

### Commit 75d702d — Edit Config Directly (2026-02-03 PM)
**Removed CLI commands:**
- `janee add <service>`
- `janee remove <service>`

**Updated:**
- `janee init` creates example config with comments
- Users edit `~/.janee/config.yaml` directly
- Standard config-file workflow

**Result:**
- Less code to maintain
- More flexible (use any text editor)
- Transparent (see whole config at once)

---

## Evolution

### Phase 1: Full-Featured (Original Plan)
```
- HTTP proxy on localhost:9119
- MCP server (via --mcp flag)
- janee add/remove commands
- Interactive CLI
```

### Phase 2: MCP-Only (After 395f519)
```
- MCP server only (no HTTP proxy)
- janee add/remove commands
- Simpler, more secure
```

### Phase 3: Config-File Workflow (After 75d702d)
```
- MCP server only
- Edit config file directly
- Minimal CLI surface
```

---

## Final CLI

```bash
janee init          # Setup with example config
janee serve         # Start MCP server
janee list          # Show configured services
janee logs          # Audit trail
janee sessions      # Active sessions
janee revoke <id>   # Kill session
```

6 commands. Clean and focused.

---

## Stats

**Total lines removed:** ~709  
**Total lines added:** ~847  
**Net change:** +138 (but much simpler architecture)

The added lines are mostly example config and documentation. The actual code is much smaller.

---

## Lessons

1. **Simpler is better** — Each round of simplification made Janee clearer
2. **Standard workflows win** — Editing a YAML file beats custom CLI commands
3. **MCP-only was right** — HTTP proxy was complexity we didn't need
4. **Remove features ruthlessly** — Every feature has a maintenance cost

---

## What's Left

### Core Features ✅
- MCP server (stdio transport)
- Encrypted key storage (AES-256-GCM)
- Session management (TTL, revocation)
- Audit logging (JSONL)
- Service + capability model

### Integrations ✅
- OpenClaw plugin (2 tools)
- Claude Desktop (via MCP)
- Cursor (via MCP)
- Any MCP client

### Phase 2 (Planned)
- LLM adjudication
- Policy engine (rate limits, allowlists)
- Cloud version (managed hosting)

---

**Status:** Ready for real-world testing  
**Next:** Ross/Kit test with OpenClaw agent  
**Published:** Not yet (waiting for approval)

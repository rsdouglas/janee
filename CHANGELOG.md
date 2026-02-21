# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.11.0] - 2026-02-18

### Added

- **Runner/Authority architecture** — Runner mode (`--authority`) proxies non-exec MCP calls to a host Authority and handles `janee_exec` locally inside containers.
- **Integrated authority endpoints** in `startMCPServerHTTP` for single-process Authority + MCP serving.
- `buildAuthorityHooks` factory for reusable exec authorization logic.

### Changed

- **Breaking:** `janee_exec` hidden in HTTP Authority mode (use Runner mode for containerized agents).
- Removed `creatureId` / `--creature-id` — Janee is agent-framework agnostic.

### Security

- `timingSafeEqual` for runner key comparison.
- Scrub hit counting order fixed (count before scrubbing).

## [0.10.0] - 2026-02-20

### Added

- **Multi-session HTTP** — HTTP transport now creates a Server + Transport per session, following the official MCP SDK pattern. Multiple agents can connect concurrently with isolated sessions.
- **Agent identity via `clientInfo.name`** — Agent identity is derived from the MCP `initialize` handshake's `clientInfo.name` field, not from tool arguments. Works across stdio, HTTP, and in-memory transports.
- **Capability-level access control** — New `allowedAgents` array per capability restricts which agents can see and use it. New `defaultAccess: restricted | open` server config controls the default policy for capabilities without an explicit allowlist.
- **Agent-scoped credential isolation** — Credentials created by an agent default to `agent-only` access. New `manage_credential` MCP tool lets agents view, grant, and revoke access.
- `CredentialOwnership` model with three policies: `agent-only`, `shared`, `all-agents`
- `captureClientInfo()` utility for stdio/test transports to capture identity from initialize
- `isInitializeRequest` from MCP SDK used for proper session routing

### Changed

- **Breaking:** `startMCPServerHTTP` and `startMCPServer` now accept `MCPServerOptions` instead of `MCPServerResult`. Callers no longer call `createMCPServer()` directly — the start functions create server instances internally (per-session for HTTP, once for stdio).
- `list_services` filters results by agent access when ownership or `allowedAgents` are configured
- `addServiceYAML()` sets `cliCreatedOwnership()` (all-agents) by default on new services
- `create-gh-app` package: de-creature-ified naming (generic `agent`/`.gh-apps` paths)

### Security

- Agent identity resolved from transport-level metadata (`clientInfo.name`) rather than trusting client-provided `agentId` arguments
- 4-level identity priority chain: `verifiedAgentId` > `transportAgentHint` > `session.agentId` > `assertedAgentId`
- Credential access checks enforced on `list_services`, `execute`, and `manage_credential`
- Owner-only enforcement on grant/revoke operations

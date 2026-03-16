# Changelog

All notable changes to Janee will be documented in this file.

## [Unreleased]

### Added

- **Per-capability `access` override** — Capabilities can now set `access: open` or `access: restricted` to override the global `defaultAccess` policy. Useful for mixed environments where some capabilities (e.g. SerpAPI) should be open to all agents while others (e.g. Stripe) are locked to specific agents. Configurable via `janee cap add --access open` / `janee cap edit --access restricted` / `janee cap edit --clear-access`. Surfaced in `explain_access` traces and `cap list` output.

### Changed

- **Refactor: Extract shared CLI utilities** — Common helpers (`cliError`, `requireConfig`, `resolveEnvVar`, `parseEnvMap`, `handleCommandError`) moved to `src/cli/cli-utils.ts`. Removes ~200 lines of duplicated code across 14 CLI command files. Error output format is now consistent (`{ ok: false, error }`) across all commands.
- **Refactor: Extract shared types** — `APIRequest`, `APIResponse` moved to `src/core/types.ts`; `DenialError`/`DenialDetails` also relocated there. `SerializedSession` added to `core/sessions.ts` to replace 3 duplicate interface definitions in CLI commands.
- **Refactor: Extract tool handlers from `mcp-server.ts`** — The 6 largest tool handlers (`execute`, `janee_exec`, `manage_credential`, `test_service`, `explain_access`, `whoami`) extracted to `src/core/tool-handlers.ts`, reducing the `createMCPServer` function by ~600 lines.
- **Refactor: Deduplicate Authority REST routes** — New `mountAuthorityRoutes()` in `authority.ts` replaces ~80 lines of copy-pasted Express route definitions in `startMCPServerHTTP`.
- **Refactor: Extract constants** — `DEFAULT_TIMEOUT_MS`, `REDACTED`, `MIN_SCRUB_LENGTH` now live in `core/types.ts` instead of being scattered as magic values across `exec.ts`, `authority.ts`, `serve-mcp.ts`, and `runner-proxy.ts`.

## [0.15.0] - 2026-03-09

### Added

- **AWS Signature V4 auth type (`aws-sigv4`)** — New auth type for AWS services (SES, S3, etc.). Janee computes per-request SigV4 signatures (HMAC-SHA256) server-side, keeping `accessKeyId`, `secretAccessKey`, and optional `sessionToken` encrypted at rest. Non-secret fields (`region`, `awsService`) stay in `config.yaml`. Supports `janee add aws-ses` / `janee add aws-s3` (directory templates), `janee service edit --access-key-id/--secret-access-key` for key rotation, and the standard `execute` MCP tool for calling AWS APIs.

## [0.14.0] - 2026-03-09

### Added

- **Twitter/X OAuth 1.0a auth type (`oauth1a-twitter`)** — New auth type for Twitter/X API v2. Janee computes per-request OAuth 1.0a signatures (HMAC-SHA1) server-side, keeping all 4 secrets encrypted at rest. Supports `janee add twitter` (template pre-fills `api.x.com`), `janee service edit --consumer-key/--consumer-secret/--access-token/--access-token-secret` for rotation, and the standard `execute` MCP tool for posting tweets.

## [0.13.0] - 2026-03-09

### Added

- **`janee cap add/edit` — exec & agent scoping flags** — Both commands now accept `--allowed-agents`, `--mode`, `--allow-commands`, `--env-map`, `--work-dir`, and `--timeout`. `cap edit` also accepts `--clear-agents`. All 6 previously missing CapabilityConfig fields are now fully CLI-manageable.
- **`janee service edit <name>`** — Edit an existing service in-place: update `--url`, `--test-path`, or rotate secrets (`--key`, `--api-secret`, `--passphrase`, `--pem-file`, `--credentials-file`, `--header`). Supports `--*-from-env` variants and `--json`.
- **`janee config get/set`** — View and update server settings (`server.port`, `server.host`, `server.logBodies`, `server.strictDecryption`, `server.defaultAccess`) without editing YAML. Values are type-validated (boolean, number, enum).
- **`whoami` MCP tool + `janee whoami` CLI command** — Agents can discover their resolved identity as Janee sees it, which capabilities they can access vs. are denied, and the server's default access policy. CLI supports `--agent <name>` to preview what a specific agent would see. In runner mode, MCP `whoami` resolves via Authority (source of truth).
- **Structured denial codes** — `execute` and `janee_exec` failures now include a machine-readable `denial` field with `reasonCode` (`CAPABILITY_NOT_FOUND`, `AGENT_NOT_ALLOWED`, `DEFAULT_ACCESS_RESTRICTED`, `OWNERSHIP_DENIED`, `RULE_DENY`, `MODE_MISMATCH`, `REASON_REQUIRED`, `COMMAND_NOT_ALLOWED`), the evaluated policy, and an actionable `nextStep` hint. Non-denial errors remain unchanged.
- **`explain_access` MCP tool + `janee diagnose access` CLI** — Trace exactly why an agent can or cannot access a capability. Returns step-by-step policy evaluation (capability exists → mode → allowedAgents → defaultAccess → ownership → rules). In runner mode, automatically forwarded to Authority for source-of-truth evaluation. CLI: `janee diagnose access <cap> --agent <name> [--method GET --path /foo]`.
- **`janee doctor runner <url>`** — Cross-system diagnostic for runner/authority setups. Checks authority reachability, runner key authentication, MCP tool forwarding, and identity parity. Outputs PASS/WARN/FAIL with remediation hints. Supports `--json`.
- **`janee doctor bundle`** — Export a redacted diagnostics bundle for incident debugging. Includes config metadata (no secrets), capability/service inventory, agent access summary, and recent denial events. Supports `--output <file>` and `--agent <name>`.

### Changed

- **Config secrets separation** — Encrypted secrets and the master key are now stored in `~/.janee/credentials.json` instead of inline in `config.yaml`. This makes `config.yaml` human-readable (~150 lines vs 392) so you can `vim` it for capability tweaks and agent scoping. Existing v0.2.0 configs with inline secrets are auto-migrated on first load. `credentials.json` is written atomically (temp + rename). No new dependencies.
- **LLM config deferred** — `llm.*` is not currently used at runtime, so `janee config get/set` no longer exposes `llm.provider`, `llm.apiKey`, or `llm.model` until provider-backed LLM runtime support exists.

## [0.12.0] - 2026-02-27

### Added

- **Library exports** — New `src/index.ts` barrel file exposes Janee's config and agent-scope APIs for programmatic use. Exports include `loadYAMLConfig`, `saveYAMLConfig`, `addServiceYAML`, `createServiceWithOwnership`, ownership factories (`agentCreatedOwnership`, `cliCreatedOwnership`), access control (`canAgentAccess`, `grantAccess`, `revokeAccess`), and all config types.
- **`janee test [service]`** — CLI command to test service connectivity and authentication. Tests one service or all configured services, verifying that Janee can reach the endpoint and that credentials are accepted. Supports `--json` and `--timeout`.
- **`test_service` MCP tool** — Agents can test service connections via MCP. Works in both standalone and runner mode (forwarded to Authority).
- **`POST /v1/test` REST endpoint** — Authority mode REST endpoint for testing services, authenticated via runner key.
- **`testPath` in service config and templates** — Each service now stores an auth-required GET endpoint for meaningful credential testing (e.g. `/v1/balance` for Stripe, `/user` for GitHub, `/v1/models` for OpenAI). `janee add` prompts for it (pre-populated from template). Existing configs without `testPath` gracefully fall back to template directory lookup, then base URL.
- **`src/core/auth.ts`** — Extracted shared auth header injection from `serve-mcp.ts` into a reusable module. All interfaces (CLI test, MCP proxy, REST) now use the same auth injection path.

### Changed

- **`serve-mcp.ts`** — Refactored `onExecute` to use shared `buildAuthHeaders()` from `src/core/auth.ts`, eliminating ~80 lines of duplicated auth logic.
- **`health.ts`** — Added `testServiceConnection()` for authenticated health checks (the existing `checkServiceHealth()` only does unauthenticated HEAD requests). Uses template directory to resolve the best test endpoint per service.

## [0.11.0] - 2026-02-18

### Added

- **Runner/Authority architecture** — Janee can now run in two modes: Authority (central credential store and policy enforcement on the host) and Runner (local MCP proxy inside containers that handles exec locally).
- **Runner proxy mode** — `janee serve --authority <url> --runner-key <key>` starts a Runner that forwards `list_services`, `execute`, `manage_credential`, and `reload_config` to the Authority via MCP, while intercepting `janee_exec` for local execution inside the container.
- **Integrated authority endpoints** — `startMCPServerHTTP` can now serve both MCP and authority REST endpoints (`/v1/exec/authorize`, `/v1/exec/complete`, `/v1/health`) from a single process when `runnerKey` is provided.
- **`buildAuthorityHooks`** — Reusable factory function for creating authority exec hooks from config, used by both standalone `janee authority` and integrated HTTP serve.
- Runner proxy starts without local config in `--authority` mode, fetching capabilities from the Authority.

### Changed

- **Breaking:** `janee_exec` is hidden from the MCP tool list when serving over HTTP without `--authority` (Authority mode). Exec over HTTP ran commands on the host in the wrong filesystem context. Use Runner mode for containerized agents, or stdio mode for local agents.
- Removed `creatureId` from `RunnerIdentity` and `--creature-id` CLI flag — Janee is agent-framework agnostic.

### Security

- Runner key comparison uses `timingSafeEqual` to prevent timing attacks.
- Scrub hit counting now happens before credential scrubbing (was previously always 0).
- Process group kill (`process.kill(-pid)`) has ESRCH race condition documented and handled.

### Fixed

- macOS test compatibility for `os.tmpdir()` symlink resolution (`/var/folders/...` vs `/tmp`).

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

## [0.9.0] - 2026-02-19

### Added

- **GitHub App Authentication** — New auth type: `github-app` for GitHub App installation tokens
  - Stores App ID, private key (encrypted), and installation ID
  - Signs JWT with RS256, mints short-lived installation tokens (1hr TTL)
  - Token caching with auto-refresh when <10 minutes remaining
  - Retry-on-401 with automatic cache clear
  - Interactive and non-interactive `janee add` support (`--pem-file`, `--app-id`, `--installation-id`)
  - Auth tested on add (validates JWT signing + GitHub API connectivity)
  - Directory template: `janee add github-app`
- **create-gh-app CLI** — New package `@true-and-useful/create-gh-app` for GitHub App lifecycle management
  - Create GitHub Apps via the manifest flow (supports personal + org)
  - List, delete, and manage local app credentials
  - List installations and mint installation tokens
  - `janee-add` subcommand to pipe credentials directly into `janee add`

## [0.8.5] - 2026-02-19

### Added
- Docker support: Dockerfile, docker-compose.yml, and .dockerignore for containerized deployment
- Docker documentation (docs/docker.md) with stdio/HTTP modes, Claude Desktop config, and security guidance
- README Docker section with quick start examples

### Fixed (janee-openclaw v0.3.1)
- **Version Sync** — Align plugin manifest and MCP client version with package.json (was 0.1.5 / 0.1.0, now 0.3.1)
- **MCP SDK Version** — Bump `@modelcontextprotocol/sdk` dependency from ^1.0.0 to ^1.25.3
- **README Fixes** — Correct install command to scoped package name, fix config.json → config.yaml references, document `janee_reload_config` tool (3 tools, not 2), remove stale `--mcp` flag

## [0.8.4] - 2026-02-14

### Fixed

- **Dynamic Server Version** — Read version from package.json instead of hardcoding (#74)
  - Bug: MCP serverInfo reported version "0.1.0" regardless of actual package version
  - Fix: Dynamically read version from package.json at module load time
  - Also fixes User-Agent header to always use current version
- **Exec Command Normalization** — Handle string commands in `janee_exec` tool (#75)
  - Bug: `janee_exec` crashed with `execCommand.join is not a function` when command sent as string
  - Fix: Normalize string commands to arrays via `split(/\s+/)` before processing
- **Exec-Mode Credential Leak Prevention** — Block exec-mode capabilities from proxy path (#75)
  - Security: `execute` tool didn't check `cap.mode`, allowing exec-mode credentials to leak as Bearer tokens
  - Fix: Filter out exec-mode capabilities in the execute handler

## [0.8.3] - 2026-02-13

### Fixed

- **User-Agent Header for Proxy Requests** — Add `User-Agent: janee/<version>` header to all proxied HTTP requests (#72)
  - Bug: GitHub API (and other APIs) were rejecting proxied requests with 403 Forbidden
  - Root cause: Node.js `http.request` sends no User-Agent by default; GitHub requires one
  - Fix: Inject `User-Agent: janee/<version>` header on all outgoing proxy requests
  - Impact: GitHub API proxy mode now works reliably

## [0.8.2] - 2026-02-13

### Added

- **Secure CLI Execution Mode** — Allow agents to run pre-approved CLI commands with secrets injected via environment variables (RFC-0001, #69)
  - New capability mode: `exec` — runs commands in sandboxed subprocess
  - Secrets injected as env vars (e.g., `GH_TOKEN: '{{credential}}'`), never visible to agent
  - `allowCommands` whitelist restricts which binaries can be executed
  - Configurable `timeout` per capability (default: 30s)
  - Full audit logging of command execution with sanitized output
  - Example: `gh api /user` runs through janee with GitHub token injected
- **Real-World Configuration Examples** — Add examples directory with production-ready config templates (#68)
  - `claude-desktop-github-openai.yaml` — Multi-service setup for Claude Desktop
  - `crypto-trading-agent.yaml` — Exchange API configuration with HMAC auth
  - `slack-notion-productivity.yaml` — Productivity tool integration
- **Service Health Check Module** — Add health check infrastructure for monitoring service connectivity (#67)

## [0.8.1] - 2026-02-13

### Added

- **MCP Registry Support** — Add metadata for official MCP Registry listing (#60)
  - Add `server.json` with MCP Registry schema compliance
  - Add `mcpName` field to `package.json` (`io.github.rsdouglas/janee`)
  - Enables publication to [official MCP Registry](https://registry.modelcontextprotocol.io)
  - Will appear on PulseMCP, Glama.ai, and other MCP aggregators

## [0.8.0] - 2026-02-11

### Added

- **Network Transport for Containerized Deployments** — Support for HTTP transport to enable containerized agent deployments (RFC-0004, #28)
  - New CLI flags for `janee serve`: `--transport <type>` (stdio|http), `--port <number>` (default: 9100), `--host <host>` (default: localhost)
  - Server-side implementation uses `StreamableHTTPServerTransport` from MCP SDK (RFC originally specified SSE, but SSE transport is deprecated in favor of StreamableHTTP)
  - Client-side support in `janee-openclaw` plugin via optional `url` config field using `StreamableHTTPClientTransport`
  - When `url` is provided, plugin connects to remote Janee instance over HTTP instead of spawning local subprocess
  - Enables running Janee on host while agent runs in Docker container (no secrets in container)
  - Server exposes `/mcp` endpoint for MCP protocol over HTTP
  - Default stdio transport preserved for backward compatibility
  - Localhost-only binding by default for security
  - Example: `janee serve --transport http --port 9100` and configure plugin with `url: "http://host.docker.internal:9100/mcp"`
- **Container Setup Guide** — Add comprehensive documentation for running Janee with containerized OpenClaw agents (#48)
  - New guide: [docs/container-openclaw.md](container-openclaw.md)
  - Covers HTTP transport setup for container → host communication
  - Platform-specific networking instructions (macOS `host.docker.internal`, Linux bridge IPs)
  - Docker Compose examples
  - Security considerations for network binding
  - Troubleshooting common connection issues
  - Linked from README integrations section

## [0.7.2] - 2026-02-10

### Added

- **Google Analytics Directory Template** — Add built-in template for Google Analytics Data API (#46)
  - Service name: `google-analytics`
  - Base URL: `https://analyticsdata.googleapis.com`
  - Auth type: `service-account` (OAuth2 with service account credentials)
  - Default scope: `https://www.googleapis.com/auth/analytics.readonly`
  - Enables `janee add google-analytics` for quick setup

## [0.7.1] - 2026-02-10

### Fixed

- **MEXC Authentication** — Fix `makeAPIRequest()` to include query parameters in HTTP requests (#45)
  - Bug: MEXC API calls were failing with `{"code":400,"msg":"api key required"}`
  - Root cause: `http.request(url, options)` wasn't including `path` in options, causing query params (timestamp, signature) to be lost
  - Fix: Explicitly set `path: targetUrl.pathname + targetUrl.search` in request options
  - Impact: MEXC API now works correctly through Janee proxy
  - No impact on other exchanges (OKX, Bybit use header-based auth)

## [0.7.0] - 2026-02-10

### Added

- **JSON Output for Write Commands** — Add `--json` flag to all write commands (#43)
  - `janee add` — Returns `{ok, service, message, capability?, capabilityMessage?}`
  - `janee remove` — Returns `{ok, service, dependentCapabilities, message}`
  - `janee cap add` — Returns `{ok, capability, service, ttl, message}`
  - `janee cap edit` — Returns `{ok, capability, message}`
  - `janee cap remove` — Returns `{ok, capability, message}`
  - Errors return `{ok: false, error: "..."}`
  - Enables programmatic CLI usage from backend integrations (The Office plugin)
  - `--json` automatically skips interactive prompts and confirmation dialogs

## [0.6.0] - 2026-02-10

### Changed

- **Auth Types** — Rename `hmac` to `hmac-mexc` for clarity
  - MEXC now explicitly uses `hmac-mexc` auth type
  - Removes ambiguity about which HMAC scheme is used
  - Each exchange has explicit auth type: `hmac-mexc`, `hmac-bybit`, `hmac-okx`
  - **Breaking change**: Existing configs with `type: 'hmac'` need to be updated to `type: 'hmac-mexc'`

## [0.5.1] - 2026-02-10

### Fixed

- **Service Directory** — Remove Binance from directory (incompatible auth scheme)
  - Binance was listed with `hmac` auth type but requires different signing than MEXC
  - Clarified auth type documentation in code comments

## [0.5.0] - 2026-02-10

### Added

- **Capability Management Commands** — New `janee cap` subcommand group for managing capabilities independently (#39)
  - `janee cap list` — List all capabilities (supports `--json`)
  - `janee cap add <name> --service <service>` — Add capability with TTL, auto-approve, rules
  - `janee cap edit <name>` — Edit existing capability (TTL, auto-approve, rules)
  - `janee cap remove <name>` — Remove capability without removing parent service (supports `--yes`)
  - Enables creating multiple capabilities per service (e.g., read-only, admin)
  - Allows fine-grained control of TTL and allow/deny rules per capability
  - Supports programmatic management via JSON output

## [0.4.5] - 2026-02-10

### Added

- **JSON Output for Search Command** — Add `--json` flag to `janee search` for programmatic directory access (#37)
  - `janee search <query> --json` outputs matching services as JSON array
  - `janee search --json` outputs entire service directory
  - Includes service metadata: name, description, baseUrl, authType, authFields, category, tags, docs
  - Enables building service directory UIs in external applications
- **Non-interactive Remove Command** — Add `--yes` flag to `janee remove` to skip confirmation prompt (#36)
  - `janee remove <service> --yes` removes service without interactive confirmation
  - Useful for programmatic integrations and backend adapters
  - Follows convention of tools like npm, apt, rm -f

## [0.4.4] - 2026-02-10

### Added

- **JSON Output for CLI Commands** — Add `--json` flag to `janee list`, `janee sessions`, and `janee logs` for programmatic integrations (#34)
  - `janee list --json` outputs structured service/capability data (no secrets)
  - `janee sessions --json` outputs active session details with TTL in seconds
  - `janee logs --json` outputs audit log entries (not supported with `--follow`)
  - Enables integration with RPC brokers and backend systems (e.g., The Office plugin system)

### Fixed

- **CLI Version Command** — `janee --version` now reports actual installed version instead of hardcoded 0.2.1 (#32)
  - Reads version dynamically from package.json at runtime
  - Previously version string was hardcoded and not updated with releases

## [0.4.3] - 2026-02-10

### Added

- **Auto-install SKILL.md for coding agents** — Postinstall script automatically installs SKILL.md to `~/.claude/`, `~/.codex/`, and `~/.cursor/` skill directories on npm install (#27)
  - Zero-config skill discovery for Claude Code, Codex, and Cursor
  - Silent failure handling for permissions/CI environments
  - Idempotent installation
- **OpenClaw plugin skill** — SKILL.md now bundled with OpenClaw plugin for agent behavioral guidance (#30)
  - Agents proactively offer to store API keys in Janee
  - Agents route API calls through `janee_execute()`
  - Agents suggest migrating keys from .env files
  - Skill auto-injected into system prompt when plugin is enabled

## [0.4.2] - 2026-02-10

### Security

- **Strict Decryption Mode** — Fail hard on decryption errors by default (#22)
  - New `server.strictDecryption` config option (default: `true`)
  - When enabled, corrupted encrypted values or wrong master key cause immediate failure
  - When disabled, falls back to plaintext (not recommended, for backwards compatibility only)
  - Prevents silent use of corrupted encrypted data as API credentials
- **Encrypt `auth.headers` Values** — Header-based auth now encrypted at rest (#20)
  - All values in `auth.type: headers` are now encrypted in config.yaml
  - Previously stored in plaintext while other auth types were encrypted
  - Existing configs automatically encrypt on next save
- **SSRF Protection** — Validate URL origin before injecting auth credentials (#16)
  - Prevents agents from exfiltrating secrets by passing absolute URLs as paths
  - Request blocked if target origin doesn't match service baseUrl
- **CI Security Trade-off Documented** — CI continues to use `rm -f package-lock.json && npm install` (#17)
  - npm bug (https://github.com/npm/cli/issues/4828) prevents cross-platform lock files
  - Mac-generated lock files lack Linux optional deps, breaking `npm ci` on Linux
  - Trade-off: CI dependencies unpinned, but package-lock.json still provides local reproducibility
  - Compensating control: small dep tree, local review with pinned versions
  - Full rationale documented in CI workflow comments
- **Crypto Improvements** — Use `crypto.randomUUID()` for audit log IDs instead of Math.random() (#19)

### Fixed

- **Dependencies** — Move `@types/js-yaml` to devDependencies (#18)

## [0.4.1] - 2026-02-09

### Fixed

- **Flag handling** — `--auth-type` and `--key` flags now properly respected when service template is matched (#11)

### Improved

- **Documentation** — Rewrote SKILL.md as agent-facing operating manual (#12)
- **Documentation** — Fixed README broken links, stale content, restructured sections (#13)

## [0.4.0] - 2026-02-05

### Added

- **Non-interactive `janee add`** — Agent-friendly setup without readline prompts (#9)
  - New flags: `--api-secret`, `--passphrase` for direct credential input
  - New flags: `--key-from-env`, `--secret-from-env`, `--passphrase-from-env` to read credentials from environment variables (keeps secrets out of command args and agent context)
  - Auto-creates capability with sensible defaults (1h TTL, auto-approve) when fully non-interactive
  - Lazy readline initialization — stdin only opened when prompts are actually needed
  - Interactive mode unchanged

## [0.3.0] - 2026-02-04

### Added

- **Request Body Logging** — POST/PUT/PATCH request bodies now logged in audit trail
  - Bodies automatically truncated at 10KB to prevent log bloat from file uploads
  - New `requestBody` field in audit events (optional)
  - Config option `server.logBodies` to disable (default: `true`)
  - No automatic redaction — full visibility into what agents sent

## [0.2.2] - 2026-02-04

### Improved

- **Interactive Auth Type Selector** — CLI now uses searchable list for auth types (#4)
  - Arrow keys to navigate, type to filter
  - Each auth type shows inline description
  - Clearer UX for new users

## [0.2.1] - 2026-02-04

### Fixed

- **Service Account File Input** — CLI now prompts for file path instead of pasting JSON (#5)
  - Interactive: `📄 Path to service account JSON file: ~/Downloads/service-account.json`
  - Non-interactive: `--credentials-file` flag for scripting
  - Supports `~` expansion to home directory
  - Multiple `--scope` flags for specifying OAuth scopes
  - Better error messages for missing/invalid files
  - Fixes issue where multi-line private keys were garbled during paste

## [0.2.0] - 2026-02-04

### Added

- **Service Account Authentication** — Support for Google-style OAuth2 service accounts (RFC-0002)
  - New auth type: `service-account` with encrypted credentials and OAuth scopes
  - JWT signing with RS256 algorithm using `jsonwebtoken` library
  - Automatic token caching (50-minute lifetime) with refresh when <10 minutes remaining
  - Validation and authentication testing during `janee add`
  - Handles 401 responses by clearing cache and retrying
  - Enables access to Google APIs (Analytics, Sheets, Drive, Cloud services)

## [0.1.0] - 2026-02-03

### Added

- **MCP Server Interface** — Janee runs as an MCP server, no HTTP proxy
- **Path-based Policies** — Allow/deny rules for request-level enforcement
- **CLI Commands** — `init`, `add`, `remove`, `serve`, `list`, `logs`, `sessions`, `revoke`
- **Encrypted Storage** — API keys encrypted with AES-256-GCM in `~/.janee/`
- **Audit Logging** — All requests logged to `~/.janee/logs/`
- **Session Management** — TTL-based sessions with revocation
- **OpenClaw Plugin** — `@true-and-useful/janee-openclaw` for native OpenClaw integration

### Security

- Keys encrypted at rest (AES-256-GCM)
- Keys never exposed to agents
- Path-based policies enforce allowed operations
- MCP over stdio (no network exposure)

### MCP Tools

- `list_services` — Discover available capabilities
- `execute` — Make API requests through Janee

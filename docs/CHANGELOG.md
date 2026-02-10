# Changelog

All notable changes to Janee will be documented in this file.

## [Unreleased]

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

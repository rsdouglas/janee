# Changelog

All notable changes to Janee will be documented in this file.

## [Unreleased]

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

### Security

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

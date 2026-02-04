# Changelog

All notable changes to Janee will be documented in this file.

## [Unreleased]

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

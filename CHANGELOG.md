# Changelog

All notable changes to Janee will be documented in this file.

## [0.1.0] - 2024-02-03

### Added
- Initial release of CLI-first Janee proxy
- Commands: `init`, `add`, `serve`, `list`, `logs`, `remove`
- Local HTTP proxy server on `localhost:9119`
- AES-256-GCM encryption for API keys
- Config storage in `~/.janee/`
- Audit logging to `~/.janee/logs/` (JSONL format)
- TypeScript codebase with modular architecture
- MIT License

### Security
- Keys encrypted at rest with AES-256-GCM
- Master key generated at initialization
- Config file permissions set to `0600` (owner-only)
- Proxy listens only on localhost (not exposed to network)

### Architecture
- Core modules: `crypto`, `proxy`, `audit`
- CLI commands in separate files
- Storage-agnostic design for future cloud version
- Minimal dependencies (only `commander` for CLI)

## [Unreleased]

### Planned
- LLM adjudication (OpenAI/Anthropic integration)
- Policy engine (read-only, allowlists, blocklists)
- Rate limiting
- Session tokens (request access with intent)
- Multiple auth patterns support
- Optional web dashboard

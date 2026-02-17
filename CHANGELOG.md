# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Agent-scoped credential isolation** — credentials created by one agent are invisible to others unless explicitly shared via `manage_credential` tool
- New `CredentialOwnership` model with three access policies: `private`, `shared`, `global`
- New MCP tool `manage_credential` for grant/revoke/view operations on credential access
- Transport-bound agent identity resolution via `resolveAgentIdentity()` — agent identity derived from authenticated session/transport, not client-asserted arguments
- `onPersistOwnership` callback for persisting ownership changes to disk
- CLI-created credentials automatically tagged with `cliCreatedOwnership()` (global access)
- 36 new tests covering agent-scope logic and MCP handler integration

### Security
- Agent identity is now resolved from transport metadata (`extra.authInfo.clientId`, `extra.sessionId`) rather than trusting client-provided `agentId` arguments
- Credential access checks enforced on `list_services`, `execute`, and `manage_credential` handlers
- Owner-only enforcement on grant/revoke operations

### Changed
- `addServiceYAML()` now sets `cliCreatedOwnership()` by default on new services
- `list_services` tool filters results based on agent access when ownership metadata is present

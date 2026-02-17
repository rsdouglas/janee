# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.8.x   | :white_check_mark: |
| < 0.8   | :x:                |

## Reporting a Vulnerability

Janee takes security seriously — it's a secrets management tool, so security is foundational to its value.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, report vulnerabilities by emailing: **security@janee.dev**

If that bounces or you don't receive a response within 48 hours, open a [GitHub Security Advisory](https://github.com/rsdouglas/janee/security/advisories/new) on this repository.

### What to Include

- Description of the vulnerability
- Steps to reproduce (or a proof-of-concept)
- Impact assessment (what could an attacker do?)
- Any suggested fix, if you have one

### What to Expect

- **Acknowledgment** within 48 hours
- **Assessment** within 7 days — we'll confirm whether it's a valid issue and its severity
- **Fix timeline** based on severity:
  - **Critical** (secret exposure, auth bypass): Patch within 72 hours
  - **High** (privilege escalation, policy bypass): Patch within 7 days
  - **Medium** (information disclosure, DoS): Patch within 30 days
  - **Low** (minor issues): Next scheduled release

### Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good faith effort to avoid privacy violations and data destruction
- Only interact with accounts they own or with explicit permission
- Report vulnerabilities promptly and don't exploit them beyond what's needed to demonstrate the issue

## Security Model

Janee operates as a **local-first MCP server** that manages secrets for AI agents. Key security properties:

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Agent reads raw secrets | Secrets are never exposed to agents — Janee injects credentials into proxied requests |
| Prompt injection exfiltrates keys | Request policies restrict which APIs and methods each capability can access |
| Unauthorized API access | Session TTLs provide time-limited access with instant revocation |
| Local secret storage compromise | Secrets encrypted at rest in  |
| Path traversal in config | File-based providers validate and sandbox all paths |
| Audit evasion | Every proxied request is logged with timestamp, method, path, and status |

### Architecture Principles

1. **Zero-knowledge agents**: Agents never see raw API keys or tokens
2. **Principle of least privilege**: Capabilities grant minimal required access
3. **Defense in depth**: Multiple layers (encryption, policies, audit, TTLs)
4. **Fail-closed**: If Janee can't verify a request, it's denied
5. **Full audit trail**: Every action is logged for forensic analysis

### What Janee Does NOT Protect Against

- Compromise of the host machine where Janee runs (if an attacker has root, all bets are off)
- Side-channel attacks on the MCP transport layer
- Vulnerabilities in upstream APIs that Janee proxies to
- Social engineering of the human who configures Janee

## Dependencies

Janee minimizes its dependency footprint to reduce supply chain risk. We monitor dependencies via:

- GitHub Dependabot alerts
- Regular  checks
- Pinned dependency versions in 

## Acknowledgments

We're grateful to security researchers who help keep Janee and its users safe. Responsible disclosures will be acknowledged in release notes (unless the reporter prefers anonymity).

# Security Policy

## Reporting Vulnerabilities

**Please do not report security vulnerabilities through public GitHub issues.**

Email security reports to: **security@janee.io**

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We aim to acknowledge reports within 48 hours and provide a fix timeline within 5 business days.

## Security Model

Janee is a secrets proxy — it sits between AI agents and external APIs so that **agents never see raw credentials**. The threat model assumes:

1. **Agents are untrusted.** They may be compromised via prompt injection, jailbreaks, or malicious tool calls. Janee enforces server-side policies regardless of agent intent.
2. **The host machine is trusted.** Janee runs on the user's machine or in their infrastructure. The master key and config file must be protected by standard OS-level access controls.
3. **Transport is local by default.** stdio transport exposes no network surface. HTTP transport binds to localhost unless explicitly configured otherwise.

### What's protected

| Layer | Mechanism |
|-------|-----------|
| **Secrets at rest** | AES-256-GCM encryption with a per-install master key |
| **Secrets in transit** | Never sent to agents — Janee injects credentials into outbound API calls server-side |
| **API access scope** | Path-based request policies (allow/deny rules per HTTP method and path) |
| **Session limits** | Configurable TTLs with automatic session expiry |
| **Audit trail** | All proxied requests logged with agent identity, timestamp, and capability used |
| **Agent identity** | `clientInfo.name` from MCP handshake used for access control in multi-agent setups |

### What's NOT protected

- **Config file permissions** — Janee does not enforce file permissions on `~/.janee/config.yaml`. Users must set appropriate permissions (`chmod 600`).
- **Master key storage** — The master key is stored in the config file. If an attacker has read access to the config, they can decrypt all secrets.
- **Localhost network access** — In HTTP mode, any process on the same machine can connect to the MCP endpoint unless additional network controls are applied.
- **Agent impersonation** — `clientInfo.name` is self-reported by agents and not cryptographically verified in the current version. See [issue #96](https://github.com/rsdouglas/janee/issues/96) for hardened agent identity.

## Encryption Details

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key:** 256-bit random key, base64-encoded, generated via `crypto.randomBytes(32)`
- **IV:** 12-byte random IV per encryption operation (GCM standard)
- **Auth tag:** 16-byte authentication tag for integrity verification
- **Storage format:** `base64(iv + authTag + ciphertext)`

Each secret is encrypted independently with a unique random IV, providing semantic security (identical plaintext values produce different ciphertexts).

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.10.x  | ✅ Current |
| < 0.10  | ❌ Upgrade recommended |

## Best Practices

1. **Set file permissions** on your config: `chmod 600 ~/.janee/config.yaml`
2. **Use request policies** to limit what agents can do — don't rely on agent "intent"
3. **Set session TTLs** for time-limited access in automated workflows
4. **Review audit logs** periodically for unexpected API usage patterns
5. **Use separate capabilities** per agent in multi-agent setups with access control
6. **Rotate secrets** if you suspect the master key or config file has been compromised

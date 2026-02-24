# Security Policy

## Reporting Vulnerabilities

**Please do not report security vulnerabilities through public GitHub issues.**

Report vulnerabilities through a [GitHub Security Advisory](https://github.com/rsdouglas/janee/security/advisories/new) on this repository.

Include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment
- Suggested fix (if any)

We aim to acknowledge reports within 48 hours and provide a fix timeline within 5 business days.

## Security Model

Janee is a secrets proxy — agents never see raw credentials. For the full security model, threat analysis, and architecture details, see the [Security Model documentation](https://janee.io/docs/security-model.html).

**Key design principles:**

- **Agents are untrusted.** Janee enforces server-side policies regardless of agent intent.
- **Zero-knowledge proxying.** Credentials are injected into outbound API calls server-side — the agent receives API responses, never keys.
- **Defense in depth.** AES-256-GCM encryption at rest, path-based request policies, session TTLs, and full audit trail.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.11.x  | ✅ Current |
| < 0.11  | ❌ Upgrade recommended |

## Best Practices

1. **Set file permissions** on your config: `chmod 600 ~/.janee/config.yaml`
2. **Use request policies** to limit what agents can do — don't rely on agent "intent"
3. **Set session TTLs** for time-limited access in automated workflows
4. **Review audit logs** periodically for unexpected API usage patterns
5. **Use separate capabilities** per agent in multi-agent setups with access control

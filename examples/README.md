# Janee Examples

Real-world configuration examples for common use cases.

## Quick Start

```bash
# Install Janee
npm install -g @true-and-useful/janee

# Initialize (generates master key)
janee init

# Copy an example config
cp examples/claude-desktop-github-openai.yaml ~/.janee/config.yaml

# Add your actual API keys
janee add github --auth bearer --key ghp_yourtoken
janee add openai --auth bearer --key sk-yourkey

# Start serving
janee serve
```

## Examples

### [`claude-desktop-github-openai.yaml`](./claude-desktop-github-openai.yaml)

**Use case:** Claude Desktop accessing GitHub and OpenAI APIs.

- Read/write GitHub issues with approval
- Use OpenAI completions and embeddings (auto-approved)
- Blocks destructive operations (DELETE, settings changes)
- Includes Claude Desktop JSON config snippet

### [`crypto-trading-agent.yaml`](./crypto-trading-agent.yaml)

**Use case:** AI agent monitoring crypto exchanges (MEXC, Bybit).

- HMAC request signing — agent never sees API secrets
- Read market data auto-approved, trades require manual approval
- Batch orders blocked as safety measure
- Full request body logging for trade audit

### [`slack-notion-productivity.yaml`](./slack-notion-productivity.yaml)

**Use case:** Productivity agent managing Slack and Notion.

- Read Slack messages and Notion pages (auto-approved)
- Send Slack messages and edit Notion (requires approval + reason)
- Destructive operations (delete, archive) always blocked

## Key Concepts

**Services** define your API connections — base URL + authentication.

**Capabilities** define what an agent can do — which service, what endpoints, how long, whether it needs approval.

**Rules** use glob patterns to allow/deny specific HTTP methods and paths:
```yaml
rules:
  allow:
    - "GET /repos/**"      # Read any repo
    - "POST /repos/*/issues"  # Create issues
  deny:
    - "DELETE /**"          # Never delete anything
```

**TTL** (time-to-live) limits how long a capability stays active:
- `"2m"` — 2 minutes (good for writes)
- `"10m"` — 10 minutes (good for reads)
- `"1h"` — 1 hour (use sparingly)

## Auth Types

| Type | Use case | Example |
|------|----------|---------|
| `bearer` | Most REST APIs | GitHub, OpenAI, Slack, Notion |
| `hmac-mexc` | MEXC exchange | Signed requests with API key + secret |
| `hmac-bybit` | Bybit exchange | Signed requests with API key + secret |
| `hmac-okx` | OKX exchange | Signed requests with key + secret + passphrase |
| `headers` | Custom header auth | APIs with non-standard auth headers |
| `service-account` | Google Cloud | Service account JSON credentials |

## Security Notes

- Keys are encrypted at rest with your master key
- Never commit `~/.janee/config.yaml` with real keys to git
- Use `autoApprove: false` for any write operations
- Set `requiresReason: true` for sensitive operations
- Keep TTLs as short as practical
- Use deny rules to block destructive endpoints even if allow rules are broad

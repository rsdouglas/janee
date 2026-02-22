---
title: Why Janee?
description: How Janee compares to other approaches for managing AI agent credentials
---

Every AI agent needs API keys. The question is how they get them.

## The Problem

When you give an AI agent access to external services — GitHub, Slack, databases, email — you need to provide credentials. Most setups do one of:

1. **Hardcode secrets in prompts or config** — the agent sees raw keys and can leak them via prompt injection
2. **Use environment variables** — slightly better, but the agent's runtime still has direct access
3. **Build a custom auth layer** — works, but you're reinventing the wheel for every project

None of these are great. The agent shouldn't need to see credentials at all.

## How Janee Works

Janee sits between the agent and external APIs as an MCP server. The agent says *what* it wants to do ("create a GitHub issue", "send a Slack message"), and Janee handles authentication server-side. The agent never sees a single API key.

```
Agent → MCP → Janee → External API
                ↑
          injects credentials,
          enforces policies,
          logs everything
```

### What you get

- **Agents never see raw secrets** — credentials are injected into outbound requests server-side
- **Request policies** — restrict which endpoints, methods, and headers each capability can use
- **Audit logging** — every proxied request is logged with timestamp, method, path, and status
- **Session TTLs** — time-limited access with instant revocation
- **Exec mode** — run CLI tools with credentials injected as environment variables, scrubbed from output
- **Works with any MCP client** — Claude Desktop, Cursor, Windsurf, custom agents

## Compared to Alternatives

### vs. Environment Variables

Environment variables are the most common approach. The agent's process has `GITHUB_TOKEN` in its environment, and the agent (or any code it runs) can read it directly.

| | Env Vars | Janee |
|---|---|---|
| Agent sees raw secrets | ✅ Yes | ❌ No |
| Policy enforcement | ❌ None | ✅ Per-capability URL/method/header rules |
| Audit trail | ❌ None | ✅ Every request logged |
| Revocation | 🟡 Kill process | ✅ Session TTL or instant revoke |

### vs. Vault / Cloud Secret Managers

HashiCorp Vault, AWS Secrets Manager, and similar tools are designed for infrastructure secrets management. They're powerful but heavyweight for the AI agent use case.

| | Vault | Janee |
|---|---|---|
| Setup complexity | High (server, policies, auth backends) | Low (`janee add`, `janee serve`) |
| Agent integration | Custom code needed | Native MCP — works with any MCP client |
| Request-level policies | ❌ Secrets only | ✅ URL, method, header restrictions |
| Local-first | ❌ Requires server | ✅ Runs on your machine |

### vs. OAuth / Token Brokers

OAuth flows work well for user-facing apps but are awkward for AI agents that need to act autonomously.

| | OAuth | Janee |
|---|---|---|
| Agent autonomy | 🟡 Requires user interaction for auth flows | ✅ Pre-configured, autonomous |
| Scope control | ✅ OAuth scopes | ✅ Request policies (more granular) |
| Multi-service | 🟡 Per-provider setup | ✅ Unified config for any HTTP API |
| MCP native | ❌ | ✅ |

## When to Use Janee

Janee is the right choice when:

- You're building with MCP-compatible AI agents
- Agents need access to external APIs (GitHub, Slack, databases, etc.)
- You want secrets management without infrastructure overhead
- You need audit logging and policy enforcement out of the box
- You're running agents in containers (see [Runner/Authority architecture](/architecture/runner-authority/))

## Get Started

```bash
npm install -g @true-and-useful/janee
janee add github --provider github-token
janee serve
```

See the [Quickstart guide](/getting-started/quickstart/) for a complete walkthrough.

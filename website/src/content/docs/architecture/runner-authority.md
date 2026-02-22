---
title: Runner / Authority Architecture
description: Secure multi-agent deployments with separated trust boundaries
---

For single-user setups, `janee serve` is all you need. But when running agents in containers, CI pipelines, or multi-tenant environments, you need stronger isolation. That's where Runner/Authority comes in.

## The Problem

If an agent runs on the same machine as its secrets, a compromised agent can potentially access the credential store. In container environments, you also need a way to distribute credentials without baking them into images.

## Architecture

Runner/Authority splits Janee into two components:

```
┌─────────────────────┐     ┌──────────────────────┐
│  Container / CI      │     │  Trusted Environment  │
│                      │     │                       │
│  Agent → Runner ─────────→ Authority              │
│         (no secrets) │     │  (has secrets)        │
└─────────────────────┘     └──────────────────────┘
```

### Authority

The **Authority** runs in a trusted environment (your machine, a secure server) and holds all credentials. It:

- Stores encrypted secrets in its local keychain
- Issues time-limited sessions to authenticated Runners
- Proxies API requests on behalf of Runners
- Enforces request policies
- Logs all activity

### Runner

The **Runner** runs alongside the agent (in a container, CI runner, etc.) and has **no secrets**. It:

- Connects to the Authority over HTTPS
- Authenticates with a pre-shared runner key
- Exposes the same MCP interface as standalone Janee
- Forwards all API requests through the Authority

## Setup

### Start the Authority

```bash
# Generate a runner key
janee authority keygen

# Start the authority server
janee authority serve --port 3100
```

### Configure the Runner

Set environment variables in the container:

```bash
JANEE_AUTHORITY_URL=https://your-authority:3100
JANEE_RUNNER_KEY=<generated-key>
```

Start the runner:

```bash
janee serve
```

Janee detects the environment variables and starts in Runner mode automatically.

## Trust Model

- The **Runner** is untrusted — it never sees raw credentials
- The **Authority** is the single trust boundary — all secrets stay here
- Communication is authenticated (runner key) and encrypted (HTTPS)
- Sessions are time-limited with configurable TTLs
- The Authority can revoke access instantly

## Use Cases

### Container Agents

Run agents in ephemeral containers with no secrets. The container only needs the Authority URL and a runner key.

### CI/CD Pipelines

Give CI agents access to APIs without storing tokens in CI secrets. The Authority controls what each runner key can access.

### Multi-Tenant

Different runner keys can have different capability sets and policies. One Authority serves multiple agents with isolated permissions.

## Health Checks

Both Authority and Runner expose health endpoints:

```bash
# Authority
curl http://localhost:3100/v1/health

# Runner (via MCP)
# The Runner's health is determined by its connection to the Authority
```

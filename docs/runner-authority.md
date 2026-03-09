# Runner/Authority Architecture

When AI agents run inside Docker containers, they can't use `janee_exec` on the host — the host process has no access to the container's filesystem. The Runner/Authority architecture solves this by splitting janee into two cooperating processes.

## Overview

```
┌─────────────────────────────────────────────────┐
│  Host Machine                                    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Authority (janee serve --runner-key)     │   │
│  │  - Holds credentials & secrets            │   │
│  │  - Enforces exec policy (allowlists)      │   │
│  │  - Proxies API requests with credentials  │   │
│  │  - Issues exec grants to Runners          │   │
│  └────────────────────┬─────────────────────┘   │
│                       │ :3100                     │
├───────────────────────┼─────────────────────────┤
│  Container            │                          │
│                       │                          │
│  ┌────────────────────▼─────────────────────┐   │
│  │  Runner (janee serve --authority)         │   │
│  │  - Serves MCP to the agent                │   │
│  │  - Forwards tool calls to Authority       │   │
│  │  - Runs janee_exec locally (in-container) │   │
│  └────────────────────▲─────────────────────┘   │
│                       │ :3200                     │
│  ┌────────────────────┴─────────────────────┐   │
│  │  Agent (Claude, Codex, custom)            │   │
│  │  JANEE_URL=http://localhost:3200          │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## How It Works

1. **Agent calls a tool** via MCP (e.g., `list_services`, `execute`)
2. **Runner receives** the MCP request on its local port
3. For **non-exec tools**: Runner forwards the call to the Authority over HTTP, which handles it with full credential access
4. For **exec tools** (`janee_exec`): Runner asks the Authority to **authorize** the execution, receives a grant with injected credentials and scrub values, then runs the command **locally in the container** where the agent's files live
5. After execution, Runner reports the result back to the Authority for audit logging

This means credentials never leave the host, but commands run where the agent's code actually lives.

## Quick Start

### 1. Configure janee on the host

Create your `janee.yaml` with services and capabilities as usual:

```yaml
services:
  github:
    baseUrl: https://api.github.com
    auth:
      type: bearer
      key: ghp_your_token_here

capabilities:
  - name: gh-cli
    service: github
    mode: exec
    allowCommands: [gh]
    env:
      GH_TOKEN: "{{credential}}"
    timeout: 30000
```

### 2. Start the Authority on the host

```bash
# Generate a shared runner key
export JANEE_RUNNER_KEY=$(openssl rand -hex 32)

# Start Authority — serves both MCP and exec authorization
janee serve -t http -p 3100 --host 0.0.0.0 --runner-key "$JANEE_RUNNER_KEY"
```

The Authority exposes:
- Standard MCP endpoints (for proxied tool calls)
- `/v1/exec/authorize` — grants exec permissions with credential injection
- `/v1/exec/complete` — receives execution reports for audit logging
- `/v1/health` — unauthenticated health check

### 3. Start the Runner in each container

```bash
janee serve -t http -p 3200 --host 127.0.0.1 \
  --authority http://host.docker.internal:3100 \
  --runner-key "$JANEE_RUNNER_KEY"
```

The Runner:
- Accepts MCP connections from the agent on port 3200
- Uses `--authority` to know where to forward calls
- Authenticates to the Authority using `--runner-key`

### 4. Point the agent at the Runner

```bash
export JANEE_URL=http://localhost:3200
```

The agent sees a normal janee MCP server. It has no idea it's talking to a Runner.

## Standalone Authority

If you don't need the full MCP server on the host (e.g., the Authority only authorizes exec), you can run it standalone:

```bash
janee authority --runner-key "$JANEE_RUNNER_KEY" --host 127.0.0.1 --port 9120
```

This only exposes the exec authorization API, not the MCP proxy endpoints.

## Exec Authorization Flow

The exec flow uses a two-phase grant protocol:

```
Runner                          Authority
  │                                │
  │  POST /v1/exec/authorize       │
  │  {runner, command, capability} │
  │──────────────────────────────► │
  │                                │  ✓ Validates capability
  │  {grantId, envInjections,      │  ✓ Checks allowlist
  │   scrubValues, constraints}    │  ✓ Builds credential env
  │◄────────────────────────────── │
  │                                │
  │  [runs command locally with    │
  │   injected env, scrubs output] │
  │                                │
  │  POST /v1/exec/complete        │
  │  {grantId, exitCode, stats}    │
  │──────────────────────────────► │
  │                                │  ✓ Audit logs the execution
  │  {ok: true}                    │
  │◄────────────────────────────── │
```

### Grant Fields

| Field | Description |
|-------|-------------|
| `grantId` | Unique ID for this execution grant |
| `grantExpiresAt` | ISO timestamp — grant expires after 60 seconds |
| `effectiveTimeoutMs` | Maximum execution time (min of request + config) |
| `envInjections` | Environment variables to set (contains credentials) |
| `scrubValues` | Strings to scrub from stdout/stderr before returning to agent |
| `constraints.policyHash` | Hash of the capability policy for audit |
| `constraints.executable` | Validated executable name |
| `constraints.command` | Full validated command array |

## Security Model

- **Credentials stay on the host.** The Authority injects them as env vars in the grant; the Runner sets them for the subprocess and scrubs them from output.
- **Runner key authenticates all Authority requests** using timing-safe comparison.
- **Command allowlists** are enforced by the Authority before granting execution.
- **Agent filtering**: Capabilities can specify `allowedAgents` to restrict which agents can use them.
- **Audit trail**: Every exec completion is logged with timing, byte counts, and scrub hit counts.

## Docker Compose Example

```yaml
services:
  authority:
    image: node:20-slim
    command: npx janee serve -t http -p 3100 --host 0.0.0.0 --runner-key ${JANEE_RUNNER_KEY}
    ports:
      - "3100:3100"
    volumes:
      - ./janee.yaml:/app/janee.yaml

  agent:
    build: ./agent
    environment:
      JANEE_URL: http://localhost:3200
      JANEE_RUNNER_KEY: ${JANEE_RUNNER_KEY}
    command: |
      sh -c "npx janee serve -t http -p 3200 --host 127.0.0.1 \
        --authority http://authority:3100 --runner-key $JANEE_RUNNER_KEY & \
        sleep 2 && node agent.js"
    depends_on:
      - authority
```

## Troubleshooting

### Quick diagnostics

Run `janee doctor runner` to check connectivity, auth, tool forwarding, and identity parity in one command:

```bash
janee doctor runner http://authority:3100 --runner-key "$JANEE_RUNNER_KEY"
```

To test as a specific agent:

```bash
janee doctor runner http://authority:3100 --runner-key "$JANEE_RUNNER_KEY" --agent creature:patch
```

This outputs PASS/WARN/FAIL for each check with remediation hints.

### Debugging access denials

When an agent reports it can't do something, trace the exact policy evaluation:

```bash
# CLI — reads local config
janee diagnose access gh-cli --agent creature:patch

# With method/path for rule evaluation
janee diagnose access stripe-read --agent my-agent --method DELETE --path /v1/charges/ch_123
```

Agents can also call `explain_access` directly via MCP (automatically forwarded to Authority in runner mode):

```json
{
  "tool": "explain_access",
  "arguments": {
    "capability": "gh-cli",
    "agent": "creature:patch"
  }
}
```

Both return a step-by-step trace: capability exists → mode → allowedAgents → defaultAccess → ownership → rules.

### Structured denial codes

When `execute` or `janee_exec` is denied, the error response includes a machine-readable `denial` field:

```json
{
  "error": "Access denied: capability \"gh-cli\" is not accessible to this agent",
  "denial": {
    "reasonCode": "AGENT_NOT_ALLOWED",
    "capability": "gh-cli",
    "agentId": "unknown-agent",
    "evaluatedPolicy": "Agent \"unknown-agent\" is not in allowedAgents [creature:patch]",
    "nextStep": "Add this agent to allowedAgents: 'janee cap edit gh-cli --allowed-agents unknown-agent'"
  }
}
```

Reason codes: `CAPABILITY_NOT_FOUND`, `AGENT_NOT_ALLOWED`, `DEFAULT_ACCESS_RESTRICTED`, `OWNERSHIP_DENIED`, `RULE_DENY`, `MODE_MISMATCH`, `REASON_REQUIRED`, `COMMAND_NOT_ALLOWED`.

### Support bundle

For complex incidents, generate a redacted diagnostics bundle:

```bash
janee doctor bundle --agent creature:patch -o /tmp/janee-debug.json
```

This includes config metadata (no secrets), agent access summary, and recent denial events.

### Common issues

**Runner can't reach Authority**
- Check that the Authority is listening on `0.0.0.0`, not `127.0.0.1`
- In Docker, use `http://host.docker.internal:3100` (macOS/Windows) or the container network hostname
- Verify the runner key matches on both sides
- Run `janee doctor runner <url>` for a full connectivity check

**Exec authorization fails with "Unknown capability"**
- The `capabilityId` the agent sends must match a `name` in your `capabilities` config
- The capability must have `mode: exec`
- Run `janee diagnose access <cap> --agent <name>` to see where it fails

**Commands fail but worked in non-Runner mode**
- The command runs inside the container — ensure the executable is installed there
- Working directory may differ; set `workDir` in the capability config

**Agent says "not accessible" but should have access**
- Check `allowedAgents` on the capability: `janee cap list --json`
- Check `defaultAccess` policy: `janee config get server.defaultAccess`
- Use `explain_access` or `janee diagnose access` for a full trace

## Recent Features

### Working Directory (`cwd`) — v0.11.2

Agents can specify the working directory for exec commands using the `cwd` parameter:

```json
{
  "tool": "janee_exec",
  "arguments": {
    "capability": "gh-cli",
    "command": ["gh", "pr", "list"],
    "cwd": "/home/agent/project"
  }
}
```

Without `cwd`, commands run in the Runner's `process.cwd()`. This is useful when agents work on multiple projects or need to run commands in a specific repository checkout.

### Agent Identity Forwarding — v0.11.1

The Runner now maintains **per-agent MCP sessions** with the Authority. Previously, the Authority saw all requests as coming from the Runner itself. Now each unique agent gets its own session, so `allowedAgents` access control works correctly through the Runner.

This is transparent — agents don't need to do anything differently. The Runner reads the agent's `clientInfo.name` from the MCP initialize handshake and creates a corresponding session with the Authority.

```
Agent "creature:patch" ──▶ Runner ──▶ Authority session for "creature:patch"
Agent "creature:voyager" ──▶ Runner ──▶ Authority session for "creature:voyager"
```

### GitHub App Token Minting in Exec — v0.11.1

Capabilities using `github-app` auth type now work correctly in exec mode. The Authority mints short-lived GitHub App installation tokens and injects them as environment variables for the command.

### Automatic GIT_ASKPASS — v0.11.2

When `janee_exec` runs a `git` command and the capability injects `GH_TOKEN` or `GITHUB_TOKEN` as an environment variable, Janee automatically creates a temporary askpass script. This makes HTTPS authentication transparent — agents can `git push`, `git pull`, and `git clone` without any extra configuration.

The askpass script is created before the command runs and cleaned up automatically afterward. It returns `x-access-token` as the username and the token value as the password, following GitHub's HTTPS token authentication protocol.

```yaml
# This "just works" — git auth is handled automatically
capabilities:
  - name: git-ops
    service: github
    mode: exec
    allowCommands: [git]
    env:
      GH_TOKEN: "{{credential}}"
```

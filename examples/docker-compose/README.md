# Docker Compose: Janee + Agent

Run Janee as a sidecar service with your agent in a container.
The agent connects over HTTP — **no secrets enter the container**.

```
┌─────────────────────┐     HTTP      ┌──────────────────────┐
│  janee container    │◄──────────────│  agent container     │
│  (has credentials)  │    :9100      │  (has NO credentials)│
└─────────────────────┘               └──────────────────────┘
```

## Prerequisites

1. [Install Janee](https://github.com/rsdouglas/janee#quick-start) on your host
2. Configure at least one service:

```bash
janee init
janee add stripe -u https://api.stripe.com --auth-type bearer --key sk_live_xxx
```

## Run

```bash
cd examples/docker-compose
docker compose up
```

Janee starts on port 9100. The example agent connects and calls the Stripe API
through Janee — credentials are injected server-side, never exposed to the agent.

## Adapt for Your Agent

Replace the `agent/` directory with your own agent. The only thing your agent needs
is the `JANEE_URL` environment variable:

```python
# Your agent just calls Janee's HTTP endpoint
resp = httpx.post(f"{JANEE_URL}/mcp", json={
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
        "name": "execute",
        "arguments": {
            "capability": "stripe",
            "method": "GET",
            "path": "/v1/balance",
            "reason": "Check balance"
        }
    }
})
```

## Architecture Notes

- Janee config is mounted **read-only** (`~/.janee:/root/.janee:ro`)
- The agent container has no access to credentials, master key, or config
- Health check on `:9100/health` ensures janee is ready before agent starts
- If janee restarts, compose restarts it automatically (`unless-stopped`)

For production, see [Container Setup Guide](../../docs/container-openclaw.md).

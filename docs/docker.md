# Running Janee with Docker

Deploy Janee as a containerized MCP secrets management server.

## Quick Start

### 1. Build the image

```bash
docker build -t janee .
```

### 2. Prepare your config

```bash
mkdir -p config
# Copy your existing config, or initialize a new one:
cp ~/.janee/config.yaml config/
```

### 3. Run in HTTP mode

```bash
docker run -d \
  --name janee-mcp \
  -p 3000:3000 \
  -v $(pwd)/config:/root/.janee:ro \
  janee --transport http --port 3000 --host 0.0.0.0
```

### 4. Test it

```bash
curl http://localhost:3000/health
```

## Docker Compose

For a production-ready setup:

```bash
# Copy config
mkdir -p config
cp ~/.janee/config.yaml config/

# Start
docker compose up -d

# View logs
docker compose logs -f janee

# Stop
docker compose down
```

## Transport Modes

### HTTP Mode (network-accessible)

Best for: multi-agent setups, remote MCP clients, microservice architectures.

```bash
docker run -d -p 3000:3000 \
  -v $(pwd)/config:/root/.janee:ro \
  janee --transport http --port 3000 --host 0.0.0.0
```

### Stdio Mode (direct process)

Best for: single-agent setups where the MCP client spawns and manages the server process.

```bash
# Used by MCP clients that manage the server lifecycle
docker run -i --rm \
  -v $(pwd)/config:/root/.janee:ro \
  janee --transport stdio
```

For Claude Desktop, add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "janee": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/path/to/config:/root/.janee:ro",
        "janee", "--transport", "stdio"
      ]
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JANEE_CONFIG_DIR` | `/root/.janee` | Path to config directory inside container |
| `NODE_ENV` | `production` | Node.js environment |
| `JANEE_PORT` | `3000` | Port for HTTP transport (docker-compose) |

## Volumes

| Path | Purpose |
|------|---------|
| `/root/.janee` | Configuration (mount read-only) |
| `/data` | Persistent data (audit logs, sessions) |

## Security Considerations

- **Mount config read-only** (`-v config:/root/.janee:ro`) to prevent the container from modifying your credentials
- **Don't expose port 3000 publicly** without additional authentication — Janee's HTTP transport is designed for trusted network access
- Use Docker secrets or environment variables for sensitive configuration in orchestrated deployments
- The container runs as root by default; for hardened deployments, consider adding a non-root user

## Multi-Architecture Builds

Build for multiple platforms:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t janee:latest .
```

## Troubleshooting

**Container exits immediately in stdio mode:**
Stdio mode requires an interactive terminal (`-i` flag) or a connected MCP client piping stdin/stdout.

**Config not found:**
Ensure your config volume mount points to the directory containing `config.yaml`, not the file itself.

**Permission denied on config:**
Check that the config file is readable: `chmod 644 config/config.yaml`

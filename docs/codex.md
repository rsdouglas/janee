# Using Janee with Codex CLI

This guide walks you through setting up Janee as an MCP server for [Codex CLI](https://github.com/openai/codex), OpenAI's open-source coding agent.

## Why use Janee with Codex?

When Codex needs to interact with external APIs (GitHub, Stripe, databases, etc.), you typically have to share credentials somehow. Common approaches have problems:

- **Environment variables** — Keys sit in plaintext in your shell config
- **Pasting in prompts** — Keys end up in context and logs
- **Hardcoded in scripts** — Keys get committed to repos

Janee solves this by:
- Storing credentials **encrypted at rest**
- Handling authentication **transparently** (the agent never sees raw keys)
- **Logging every request** for audit trails
- Supporting multiple services in one config

## Prerequisites

- [Codex CLI](https://github.com/openai/codex) installed
- [Node.js](https://nodejs.org) 18+ installed
- A terminal

## Step 1: Install Janee

```bash
npm install -g @true-and-useful/janee
```

Verify it's installed:

```bash
janee --version
```

## Step 2: Add a service

Janee has built-in templates for common services (GitHub, Stripe, OpenAI, etc.) that auto-detect the base URL and auth type, so you often just need a name and a key.

**Non-interactive (recommended for agents):**

```bash
# Known services — template handles the URL
janee add github --key-from-env GITHUB_TOKEN
janee add stripe --key-from-env STRIPE_KEY
janee add openai --key-from-env OPENAI_API_KEY

# Any REST API
janee add myservice -u https://api.example.com --key-from-env MY_API_KEY
```

Using `--key-from-env` reads the key from an environment variable so it never appears in command args or agent context. You can also pass `--key` / `-k` directly.

**Interactive:**

```bash
janee add github
```

Follow the prompts for base URL, auth type, and token.

Janee encrypts and stores credentials in `~/.janee/config.yaml`.

## Step 3: Configure Codex

Codex uses a TOML config file. The location depends on your OS:

- **macOS**: `~/Library/Application Support/codex/config.toml`
- **Linux**: `~/.config/codex/config.toml`
- **Windows**: `%APPDATA%\codex\config.toml`

Add Janee to the MCP servers section:

```toml
[mcp_servers.janee]
command = "janee"
args = ["serve"]
```

If `janee` isn't in your PATH, use the full path:

```bash
# Find the full path
which janee
```

```toml
[mcp_servers.janee]
command = "/usr/local/bin/janee"
args = ["serve"]
```

### Using npx

If you prefer not to install globally:

```toml
[mcp_servers.janee]
command = "npx"
args = ["@true-and-useful/janee", "serve"]
```

## Step 4: Restart Codex

If Codex is running, restart it for the MCP settings to take effect.

## Step 5: Test it

Start a Codex session and try:

```bash
codex "List my GitHub repositories"
```

or

```bash
codex "Show me my recent Stripe charges"
```

Codex will use Janee to make API calls without you needing to provide credentials.

## Config file example

Here's a complete `config.toml` with Janee configured:

```toml
# Codex CLI configuration

model = "o4-mini"

[mcp_servers.janee]
command = "janee"
args = ["serve"]

# You can add other MCP servers too
# [mcp_servers.other]
# command = "other-mcp-server"
# args = ["start"]
```

## Troubleshooting

### "Command not found" error

Codex can't find the `janee` executable. Either:
1. Use the full path in config.toml
2. Ensure Node.js bin directory is in your PATH

### MCP server not connecting

1. Check config.toml syntax (TOML is sensitive to formatting)
2. Verify Janee works standalone: `janee serve` (should start without errors)
3. Restart Codex completely

### Authentication errors

```bash
# Re-add the service with correct credentials
janee remove github
janee add github
```

### Check Janee logs

Janee logs all requests for debugging:

```bash
# Today's requests
cat ~/.janee/logs/$(date +%Y-%m-%d).jsonl
```

## Example: GitHub workflow

Once configured, you can ask Codex things like:

```bash
codex "Create a new issue in my-repo titled 'Bug fix needed'"
codex "Show me open PRs in organization/repo"
codex "What are my assigned issues?"
```

Codex will use Janee to authenticate with GitHub automatically.

## Example: Multi-service workflow

Set up multiple services:

```bash
janee add github
janee add stripe -u https://api.stripe.com/v1
janee add notion -u https://api.notion.com/v1
```

Then use them all:

```bash
codex "Check my GitHub notifications and list recent Stripe charges"
```

## Security notes

- Credentials are encrypted using your system keychain where available
- Janee never sends credentials to AI models — only the API responses
- All requests are logged for audit purposes (v0.3.0+ logs request bodies)
- You can revoke access anytime with `janee remove <service>`

## Shared config with VS Code extension

The Codex CLI and VS Code Codex extension share the same config file. If you set up Janee for the CLI, it'll work in VS Code too (and vice versa).

## Managing services

```bash
# List all configured services
janee list

# Remove a service
janee remove github

# Re-add with different credentials
janee add github
```

## Next steps

- [Add more services](/docs/services.md)
- [Configure audit logging](/docs/audit.md)
- [Use with Cursor](/docs/cursor.md)
- [Use with Claude Code](/docs/claude-code.md)

# Using Janee with Claude Code

This guide walks you through setting up Janee as an MCP server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI coding agent.

## Why use Janee with Claude Code?

When Claude Code needs to interact with external APIs (GitHub, Stripe, databases, etc.), you typically have to share credentials somehow. Common approaches have problems:

- **Environment variables** — Keys sit in plaintext in your shell config
- **Pasting in prompts** — Keys end up in context and logs
- **Hardcoded in scripts** — Keys get committed to repos

Janee solves this by:
- Storing credentials **encrypted at rest**
- Handling authentication **transparently** (Claude never sees raw keys)
- **Logging every request** for audit trails
- Supporting multiple services in one config

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed (`npm install -g @anthropic-ai/claude-code`)
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

## Step 3: Add Janee to Claude Code

Use the `claude mcp add` command:

```bash
claude mcp add janee --command janee --args serve --scope user
```

This registers Janee as an MCP server available to all your Claude Code sessions.

### Alternative: Project scope

To add Janee only for the current project:

```bash
claude mcp add janee --command janee --args serve --scope project
```

### Alternative: Manual config

You can also edit `~/.claude.json` directly:

```json
{
  "mcpServers": {
    "janee": {
      "command": "janee",
      "args": ["serve"]
    }
  }
}
```

If `janee` isn't in your PATH, use the full path:

```bash
# Find the full path
which janee

# Then use it
claude mcp add janee --command /usr/local/bin/janee --args serve --scope user
```

## Step 4: Verify the setup

Check that Janee is registered:

```bash
claude mcp list
```

You should see `janee` in the output.

## Step 5: Test it

Start a Claude Code session and try:

```bash
claude "List my GitHub repositories"
```

or

```bash
claude "Show me my recent Stripe charges"
```

Claude Code will use Janee to make API calls without you needing to provide credentials.

## Using with npx

If you prefer not to install globally:

```bash
claude mcp add janee --command npx --args "@true-and-useful/janee serve" --scope user
```

## Troubleshooting

### "Command not found" error

Claude Code can't find the `janee` executable. Either:
1. Use the full path when adding the MCP server
2. Ensure Node.js bin directory is in your PATH

### MCP server not connecting

1. Check the server is registered: `claude mcp list`
2. Remove and re-add: `claude mcp remove janee && claude mcp add janee --command janee --args serve --scope user`
3. Verify Janee works standalone: `janee serve` (should start without errors)

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

Once configured, you can ask Claude Code things like:

```bash
claude "Create a new issue in my-repo titled 'Bug fix needed'"
claude "Show me open PRs in organization/repo"
claude "What are my assigned issues?"
```

Claude Code will use Janee to authenticate with GitHub automatically.

## Example: Multi-service workflow

Set up multiple services:

```bash
janee add github
janee add stripe -u https://api.stripe.com/v1
janee add notion -u https://api.notion.com/v1
```

Then use them all in one session:

```bash
claude "Check my GitHub notifications, list recent Stripe charges, and show my Notion databases"
```

## Security notes

- Credentials are encrypted using your system keychain where available
- Janee never sends credentials to AI models — only the API responses
- All requests are logged for audit purposes (v0.3.0+ logs request bodies)
- You can revoke access anytime with `janee remove <service>`

## Managing MCP servers

```bash
# List all MCP servers
claude mcp list

# Remove Janee
claude mcp remove janee

# Check Janee services
janee list
```

## Next steps

- [Add more services](/docs/services.md)
- [Configure audit logging](/docs/audit.md)
- [Use with Cursor](/docs/cursor.md)

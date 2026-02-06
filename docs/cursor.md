# Using Janee with Cursor

This guide walks you through setting up Janee as an MCP server for [Cursor](https://cursor.sh), the AI-powered code editor.

## Why use Janee with Cursor?

When you ask Claude in Cursor to interact with external APIs (GitHub, Stripe, databases, etc.), you typically need to share credentials somehow. Common approaches have problems:

- **Pasting API keys in prompts** — Keys end up in logs, history, and potentially model context
- **Plaintext config files** — Keys sit unencrypted on disk
- **Manual API calls** — Defeats the purpose of AI assistance

Janee solves this by:
- Storing credentials **encrypted at rest**
- Handling authentication **transparently** (Claude never sees raw keys)
- **Logging every request** for audit trails
- Supporting multiple services in one config

## Prerequisites

- [Cursor](https://cursor.sh) installed
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

## Step 3: Configure Cursor

### Option A: Cursor Settings UI (recommended)

1. Open **Cursor Settings** (⌘, on macOS)
2. Go to **Tools & MCP**
3. Click **New MCP Server**
4. Add the Janee server config

### Option B: Edit config file directly

Cursor stores MCP settings in `~/.cursor/mcp.json`. Create or edit the file:

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

```json
{
  "mcpServers": {
    "janee": {
      "command": "/usr/local/bin/janee",
      "args": ["serve"]
    }
  }
}
```

Find the full path with:
```bash
which janee
```

### Alternative: npx

If you prefer not to install globally:

```json
{
  "mcpServers": {
    "janee": {
      "command": "npx",
      "args": ["@true-and-useful/janee", "serve"]
    }
  }
}
```

## Step 4: Restart Cursor

Close and reopen Cursor for the MCP settings to take effect.

## Step 5: Test it

Open a new chat in Cursor and try:

> "List my GitHub repositories"

or

> "Show me my recent GitHub notifications"

Claude should use Janee to make the API call without you needing to provide credentials in the prompt.

## Verifying Janee is connected

You can check if Janee is running as an MCP server:

```bash
janee list
```

This shows all configured services and their status.

## Troubleshooting

### "Command not found" error

Cursor can't find the `janee` executable. Either:
1. Use the full path in settings.json
2. Ensure Node.js bin directory is in your PATH

### MCP server not appearing in Cursor

1. Check that `settings.json` is valid JSON (no trailing commas)
2. Verify the file location is correct for your Cursor version
3. Restart Cursor completely (not just reload)

### Authentication errors

```bash
# Re-add the service with correct credentials
janee remove github
janee add github
```

### Check Janee logs

Janee logs requests to help debug issues:

```bash
# View recent requests
cat ~/.janee/logs/requests.log
```

## Example: GitHub workflow

Once configured, you can ask Claude things like:

- "Create a new issue in my-repo titled 'Bug fix needed'"
- "Show me open PRs in organization/repo"
- "What are my assigned issues?"

Claude will use Janee to authenticate with GitHub automatically.

## Example: Stripe workflow

```bash
janee add stripe -u https://api.stripe.com/v1
# Enter your Stripe secret key when prompted
```

Then ask:
- "List my recent Stripe customers"
- "Show me the last 5 charges"
- "Create a customer with email test@example.com"

## Security notes

- Credentials are encrypted using your system keychain where available
- Janee never sends credentials to AI models — only the API responses
- All requests are logged for audit purposes
- You can revoke access anytime with `janee remove <service>`

## Next steps

- [Add more services](/docs/services.md)
- [Configure audit logging](/docs/audit.md)
- [Use with Claude Desktop](/docs/claude-desktop.md)

# Using Janee with Claude Desktop

A step-by-step guide to setting up Janee as your secrets manager for Claude Desktop.

## Why?

When Claude Desktop connects to MCP servers that need API keys (GitHub, Stripe, OpenAI, etc.), you typically hardcode those keys in your Claude Desktop config. This means:

- Keys are stored in plaintext in `claude_desktop_config.json`
- Every MCP server gets its own copy of your keys
- No audit trail of which keys were used when
- No way to rotate keys centrally

**Janee fixes this.** Store your keys once, encrypted, and let Claude access them through MCP — with full audit logging.

## Setup (2 minutes)

### 1. Install Janee

```bash
npm install -g @true-and-useful/janee
janee init
```

### 2. Add your API keys

```bash
# Interactive mode
janee add

# Or directly
janee add github --auth bearer --key ghp_yourtoken
janee add stripe --auth bearer --key sk_live_yourkey
janee add openai --auth bearer --key sk-yourkey
```

### 3. Configure Claude Desktop

Add Janee to your `claude_desktop_config.json`:

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

On macOS, this file is at: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### 4. Restart Claude Desktop

That's it. Claude can now use your APIs through Janee.

## Usage Examples

Once configured, you can ask Claude things like:

- *"Check my recent GitHub notifications"* — Claude uses your GitHub key via Janee
- *"List my Stripe customers"* — Claude uses your Stripe key via Janee
- *"Send an email via my Gmail"* — Claude uses your Gmail key via Janee

All requests are proxied through Janee, so:
- ✅ Claude never sees the raw API key
- ✅ Every API call is logged in `~/.janee/audit.log`
- ✅ You can revoke access instantly with `janee remove <service>`

## Viewing Audit Logs

```bash
# See recent API calls made by Claude
janee audit

# Filter by service
janee audit --service github

# Export as JSON
janee audit --format json
```

## Multiple Agents, One Config

The best part: if you also use Cursor, Windsurf, or any other MCP client, just point them at Janee too. **One set of keys, every agent, full visibility.**

```json
// cursor mcp config
{
  "janee": {
    "command": "janee",
    "args": ["serve"]
  }
}
```

## Security Notes

- Keys are encrypted at rest using AES-256-GCM in `~/.janee/`
- The encryption key is derived from your system keychain (macOS) or a local passphrase
- Janee runs locally — your keys never leave your machine
- Audit logs capture timestamps, service accessed, and request metadata (not response bodies)

## Troubleshooting

**Claude says "Janee is not available"**
- Make sure `janee serve` works from your terminal
- Check that the path to `janee` is in your system PATH
- Restart Claude Desktop after config changes

**Keys not working**
- Verify with `janee list` that your service is configured
- Test directly: `janee test github` (runs a health check against the API)

## Next Steps

- [Janee Documentation](https://github.com/rsdouglas/janee)
- [MCP Protocol Spec](https://modelcontextprotocol.io)
- [Report Issues](https://github.com/rsdouglas/janee/issues)

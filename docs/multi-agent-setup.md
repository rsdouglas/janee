# Multi-Agent Setup with Janee

How to use Janee across multiple AI agents simultaneously — with one set of keys and centralized audit logging.

## The Problem

Most developers use 2-3 AI tools daily. Each one needs API access configured separately:

| Without Janee | With Janee |
|---|---|
| Copy keys to Claude Desktop config | Store keys once in Janee |
| Copy keys to Cursor config | Point Claude at Janee |
| Copy keys to Windsurf config | Point Cursor at Janee |
| Copy keys to CLI tools | Point Windsurf at Janee |
| Keys in 4 plaintext files | Keys in 1 encrypted vault |
| 0 audit trail | Full audit trail |
| Key rotation = update 4 files | Key rotation = update 1 place |

## Setup

### 1. Install and configure Janee once

```bash
npm install -g @true-and-useful/janee
janee init
janee add github --auth bearer --key ghp_xxx
janee add stripe --auth bearer --key sk_live_xxx
janee add openai --auth bearer --key sk-xxx
```

### 2. Add to Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "janee": { "command": "janee", "args": ["serve"] }
  }
}
```

### 3. Add to Cursor

`.cursor/mcp.json` in your project root:
```json
{
  "mcpServers": {
    "janee": { "command": "janee", "args": ["serve"] }
  }
}
```

### 4. Add to any MCP client

The pattern is always the same — just tell the client to run `janee serve` as an MCP server.

## Audit Across Agents

When multiple agents use Janee, the audit log captures which client made each request:

```bash
$ janee audit --last 5
2026-02-12 14:23:01  claude-desktop  github    GET /user/repos
2026-02-12 14:23:15  cursor          openai    POST /v1/chat/completions  
2026-02-12 14:24:02  claude-desktop  stripe    GET /v1/customers
2026-02-12 14:25:11  cursor          github    POST /repos/user/repo/issues
2026-02-12 14:26:00  windsurf        github    GET /user/notifications
```

## Key Rotation

Rotate a key once, every agent gets the update:

```bash
janee update github --key ghp_newtoken
# Done. All agents use the new key on their next request.
```

## Access Control (Coming Soon)

Future versions will support per-agent permissions:

```yaml
# ~/.janee/policies.yaml
agents:
  cursor:
    allow: [github, openai]
    deny: [stripe]  # Cursor doesn't need payment access
  claude-desktop:
    allow: [github, stripe, openai]
```

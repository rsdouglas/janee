---
title: Cursor
description: Use Janee with Cursor for secure AI-powered development
---

## Prerequisites

- [Cursor](https://cursor.sh) installed
- Janee installed (`npm install -g @true-and-useful/janee`)
- At least one capability configured (`janee add`)

## Configuration

Add Janee to your Cursor MCP config at `~/.cursor/mcp.json`:

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

## Usage

In Cursor's AI chat, you can now ask the agent to interact with external services:

> *"Create a GitHub issue titled 'Fix login bug' in my repo"*

The agent uses Janee's tools to make authenticated API calls. Credentials are never exposed in the conversation or stored in Cursor's context.

## Tips

- **Combine with request policies** — restrict Cursor to read-only access on production repos
- **Use exec mode** — let Cursor run authenticated CLI commands (e.g., `gh`, `aws`) through Janee
- **Check the audit log** — review what API calls were made during each session

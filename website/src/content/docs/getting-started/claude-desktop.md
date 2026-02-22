---
title: Claude Desktop
description: Connect Janee to Claude Desktop for secure API access
---

## Prerequisites

- [Claude Desktop](https://claude.ai/download) installed
- Janee installed (`npm install -g @true-and-useful/janee`)
- At least one capability configured (`janee add`)

## Configuration

Add Janee to your Claude Desktop MCP config:

import { Tabs, TabItem } from '@astrojs/starlight/components';

<Tabs>
  <TabItem label="macOS">
    Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:
  </TabItem>
  <TabItem label="Windows">
    Edit `%APPDATA%\Claude\claude_desktop_config.json`:
  </TabItem>
</Tabs>

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

## Restart Claude Desktop

After saving the config, restart Claude Desktop. You should see the Janee tools appear in the MCP tools panel.

## Try It

Ask Claude:

> *"List my GitHub repositories"*

Claude will use the `github_request` tool through Janee. You'll see the tool call in the conversation — the request goes through Janee, which injects your credentials, and Claude gets the response without ever seeing your token.

## Multiple Capabilities

If you've configured multiple capabilities, all their tools are available simultaneously:

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

Claude gets tools for every configured capability — GitHub, Slack, databases, etc. — all through a single MCP server.

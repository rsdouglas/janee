---
title: Quickstart
description: Get Janee running in under 5 minutes
---

## Install

```bash
npm install -g @true-and-useful/janee
```

## Add a Capability

A **capability** is a named connection to an external service. Create one for GitHub:

```bash
janee add github --provider github-token
```

This prompts you for a GitHub personal access token and stores it encrypted in your local keychain.

## Start the Server

```bash
janee serve
```

Janee starts an MCP server on `stdio` (default). Your MCP client connects to it and gets tools like:

- `github_request` — make authenticated HTTP requests to the GitHub API
- `github_graphql` — run GitHub GraphQL queries

The agent uses these tools without ever seeing your token.

## Try a Request

From your MCP client, call:

```json
{
  "tool": "github_request",
  "arguments": {
    "method": "GET",
    "path": "/user"
  }
}
```

Janee injects your GitHub token into the `Authorization` header, forwards the request, and returns the response. Your agent sees the result but never the credential.

## What's Next

- [Claude Desktop setup](/getting-started/claude-desktop/) — connect Janee to Claude Desktop
- [Cursor setup](/getting-started/cursor/) — use Janee with Cursor
- [Request Policies](/guides/request-policies/) — restrict what agents can do with each capability
- [Configuration](/guides/configuration/) — all config options explained

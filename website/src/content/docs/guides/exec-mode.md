---
title: Exec Mode
description: Run CLI tools with credentials injected as environment variables
---

Exec mode lets agents run command-line tools (like `gh`, `aws`, `kubectl`) with credentials injected into the process environment — and automatically scrubbed from the output.

## How It Works

1. The agent calls the `exec` tool with a command
2. Janee spawns the process with credentials as environment variables
3. The command runs and produces output
4. Janee scrubs any credential values from stdout/stderr before returning

The agent sees the command output but can never extract the raw credentials, even by running `env` or `printenv`.

## Configuration

Enable exec mode for a capability:

```yaml
capabilities:
  github:
    provider: github-token
    exec:
      command: gh
      env:
        GH_TOKEN: "{{secret}}"
```

## Usage

From an MCP client:

```json
{
  "tool": "github_exec",
  "arguments": {
    "args": ["repo", "list", "--limit", "5"]
  }
}
```

Janee runs `gh repo list --limit 5` with `GH_TOKEN` set to your GitHub token. The output is returned with any token values replaced with `[REDACTED]`.

## Security

- Credentials are injected via environment variables (not command-line arguments)
- Output scrubbing catches credentials in stdout, stderr, and error messages
- Commands run in a sandboxed subprocess with a timeout
- Command allowlists prevent arbitrary execution

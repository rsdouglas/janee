---
title: Configuration
description: Janee configuration reference
---

Janee uses a YAML configuration file stored in your home directory.

## Config Location

| Platform | Path |
|---|---|
| macOS | `~/.config/janee/config.yaml` |
| Linux | `~/.config/janee/config.yaml` |
| Windows | `%APPDATA%\janee\config.yaml` |

## Structure

```yaml
capabilities:
  github:
    provider: github-token
    baseUrl: https://api.github.com
    policies:
      - path: /repos/**
        methods: [GET, POST]
      - path: /user
        methods: [GET]
  slack:
    provider: bearer-token
    baseUrl: https://slack.com/api
```

## Capability Options

| Field | Required | Description |
|---|---|---|
| `provider` | Yes | Authentication provider (see below) |
| `baseUrl` | Yes | Base URL for the API |
| `policies` | No | Request policy rules |
| `sessionTtl` | No | Session time-to-live (e.g., `1h`, `30m`) |

## Authentication Providers

| Provider | Description |
|---|---|
| `github-token` | GitHub personal access token |
| `github-app` | GitHub App (installation token) |
| `bearer-token` | Generic Bearer token auth |
| `basic-auth` | HTTP Basic authentication |
| `header` | Custom header injection |
| `google-service-account` | Google Cloud service account |

## Environment Variables

| Variable | Description |
|---|---|
| `JANEE_CONFIG` | Override config file path |
| `JANEE_LOG_LEVEL` | Logging verbosity (`debug`, `info`, `warn`, `error`) |
| `JANEE_AUTHORITY_URL` | URL of a Janee Authority server |
| `JANEE_RUNNER_KEY` | Authentication key for Runner mode |

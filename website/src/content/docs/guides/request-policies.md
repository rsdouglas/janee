---
title: Request Policies
description: Control what agents can do with each capability
---

Request policies let you restrict which API endpoints, HTTP methods, and headers a capability can use. This is defense-in-depth — even if an agent is compromised, it can only make requests you've explicitly allowed.

## Basic Policies

Add a `policies` array to any capability:

```yaml
capabilities:
  github:
    provider: github-token
    baseUrl: https://api.github.com
    policies:
      - path: /repos/myorg/**
        methods: [GET]
      - path: /user
        methods: [GET]
```

This config allows:
- `GET` requests to any path under `/repos/myorg/`
- `GET` requests to `/user`
- **Nothing else** — all other requests are denied

## Policy Fields

| Field | Description | Example |
|---|---|---|
| `path` | URL path pattern (supports `*` and `**` globs) | `/repos/**` |
| `methods` | Allowed HTTP methods | `[GET, POST]` |
| `headers` | Required/forbidden headers | `{ deny: [X-Admin] }` |

## Path Patterns

- `*` — matches a single path segment: `/repos/*/issues` matches `/repos/myrepo/issues`
- `**` — matches any number of segments: `/repos/**` matches `/repos/myorg/myrepo/pulls/1`

## Default Behavior

With no policies defined, all requests to the capability's `baseUrl` are allowed. Once you add at least one policy rule, the default becomes **deny** — only matching requests are permitted.

## Examples

### Read-only GitHub access

```yaml
policies:
  - path: /**
    methods: [GET]
```

### Restrict to specific repo

```yaml
policies:
  - path: /repos/myorg/myrepo/**
    methods: [GET, POST, PATCH]
  - path: /user
    methods: [GET]
```

### Slack: only post to specific channels

```yaml
policies:
  - path: /chat.postMessage
    methods: [POST]
  - path: /conversations.list
    methods: [GET]
```

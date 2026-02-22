---
title: GitHub App Authentication
description: Use GitHub App installation tokens for fine-grained repository access
---

GitHub App authentication provides fine-grained, time-limited access to specific repositories — ideal for production agent deployments.

## Why GitHub Apps?

Personal access tokens are convenient but coarse-grained. GitHub Apps offer:

- **Per-repository permissions** — limit access to specific repos
- **Time-limited tokens** — installation tokens expire automatically (1 hour)
- **Organization control** — org admins manage which repos the app can access
- **No user account needed** — the app acts as itself, not as a person

## Setup

### 1. Create a GitHub App

1. Go to **Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set permissions (e.g., Issues: Read & Write, Pull Requests: Read & Write)
3. Generate a private key and download it

### 2. Install the App

Install the app on the repositories you want agents to access.

### 3. Configure Janee

```bash
janee add github-work --provider github-app
```

You'll be prompted for:
- **App ID** — from the app's settings page
- **Installation ID** — from the installation URL
- **Private key path** — path to the `.pem` file

### 4. Use It

```bash
janee serve
```

Janee automatically generates short-lived installation tokens and rotates them before expiry. The agent never sees the private key or any token.

## Token Rotation

Janee handles token lifecycle automatically:

1. On first request, generates an installation token using the private key
2. Caches the token until 5 minutes before expiry
3. Generates a new token transparently when the cache expires

No manual token management needed.

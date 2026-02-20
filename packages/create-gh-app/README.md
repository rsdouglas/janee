# @true-and-useful/create-gh-app

Create GitHub Apps for autonomous agents using the [manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest). List installations and mint short-lived installation tokens.

## Install

```bash
npm i -g @true-and-useful/create-gh-app
```

Or run directly:

```bash
npx @true-and-useful/create-gh-app <command>
```

### Prerequisites

- Node.js >= 18
- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated via `gh auth login`

## Commands

### `create` — Create a new GitHub App

```bash
create-gh-app my-agent                    # interactive org picker
create-gh-app my-agent --owner my-org     # create under an org
create-gh-app my-agent --owner @me        # create under your personal account
```

Opens a browser to complete the GitHub manifest flow. The app credentials (including private key) are saved locally to `.gh-apps/<agent>/<timestamp>/`.

After creation, install the app on the target org/account:

```
https://github.com/apps/<slug>/installations/new
```

### `list` — List locally stored apps

```bash
create-gh-app list
```

### `installations` — List installations of an app

```bash
create-gh-app installations <slug>
```

### `token` — Mint a short-lived installation token

```bash
create-gh-app token <slug>                     # auto-selects if one installation
create-gh-app token <slug> <installation_id>   # target a specific installation
```

The token is printed to stdout (metadata to stderr), so it's pipe-friendly:

```bash
export GH_TOKEN="$(create-gh-app token my-agent)"
gh repo view my-org/my-repo --json nameWithOwner
```

### `janee-add` — Register the app as a Janee service

```bash
create-gh-app janee-add <slug>
```

Feeds the app credentials into [Janee](https://janee.io) as a `github-app` auth service, so AI agents can request short-lived GitHub tokens through Janee's MCP proxy.

Requires the `janee` CLI (`npm i -g @true-and-useful/janee`).

### `delete` — Delete an app

```bash
create-gh-app delete <slug>
```

Deletes the app from GitHub (using the stored private key) and removes local files.

## How it works

1. **Create** — Spins up a local HTTP server, POSTs a manifest to GitHub, receives credentials via redirect.
2. **Token** — Signs a JWT with the app's private key (RS256), exchanges it for a 1-hour installation token via the GitHub API.
3. **Janee integration** — Passes credentials to `janee add` so the private key is encrypted at rest and tokens are minted on demand.

## Default permissions

Apps are created with these defaults (editable later in GitHub):

- **Contents**: write
- **Pull requests**: write
- **Issues**: write

Events: `pull_request`, `pull_request_review`, `issues`, `issue_comment`

## License

MIT

# Interactive Flow - Best of Both Worlds

## Decision

Ross initially asked to remove `janee add` and `janee remove` commands, but changed his mind after consideration.

**Reason:** Interactive guided flow provides better UX for first-time users.

---

## The Interactive Flow

### Adding a Service

```bash
$ janee add

Service name: stripe
Base URL: https://api.stripe.com
Auth type (bearer/hmac/headers): bearer
API key: sk_live_xxx

✓ Added service "stripe"

Create a capability for this service? (Y/n): y
Capability name (default: stripe): stripe
TTL (e.g., 1h, 30m): 1h
Auto-approve? (Y/n): y
Requires reason? (y/N): n

✓ Added capability "stripe"

Done! Run 'janee serve' to start.
```

### Removing a Service

```bash
$ janee remove stripe

⚠️  The following capabilities depend on this service:
   - stripe
   - stripe_sensitive

Are you sure you want to remove service "stripe"? This cannot be undone. (y/N): y

✅ Service "stripe" removed successfully!
✅ Removed 2 dependent capability(ies)
```

---

## Auth Types Supported

### Bearer Token
```
Auth type: bearer
API key: sk_live_xxx
```

### HMAC Signature
```
Auth type: hmac
API key: xxx
API secret: yyy
```

### Custom Headers
```
Auth type: headers
Enter headers as key:value pairs (empty line to finish):
  X-API-Key: xxx
  X-Custom-Header: yyy
  
```

---

## Quick Add (With Arguments)

For users who prefer CLI args:

```bash
janee add stripe -u https://api.stripe.com -k sk_live_xxx
```

Skips prompts, uses provided args. Still prompts for capability creation.

---

## Edit Config Directly

Power users can still edit `~/.janee/config.yaml`:

```yaml
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      key: sk_live_xxx

  github:
    baseUrl: https://api.github.com
    auth:
      type: bearer
      key: ghp_xxx

capabilities:
  stripe:
    service: stripe
    ttl: 1h
    autoApprove: true

  github:
    service: github
    ttl: 30m
    autoApprove: true
```

---

## Two Paths, Best of Both

| Approach | When to Use |
|----------|-------------|
| **`janee add`** | First-time users, guided setup, hard to mess up |
| **Edit YAML** | Power users, bulk changes, copy/paste |

Both work. Choose what fits your workflow.

---

## Implementation Details

### add.ts
- No args → fully interactive
- With args (`-u`, `-k`) → uses args, prompts for rest
- Validates auth type (bearer/hmac/headers)
- Prompts for capability creation
- Saves to YAML config with encryption

### remove.ts
- Shows dependent capabilities before deletion
- Confirms with user (requires 'y' or 'yes')
- Removes service + all dependent capabilities
- Saves updated config

### Works with YAML Config
- Uses `loadYAMLConfig()` and `saveYAMLConfig()`
- Encryption handled automatically
- Master key from config

---

## Why This Is Better Than Just Editing Config

1. **Validation** — CLI validates auth types, URLs, TTL format
2. **Encryption** — Handles key encryption automatically
3. **Safety** — Shows dependencies before deletion
4. **Guidance** — Prompts explain what each field means
5. **Discovery** — Users learn the config structure by using the CLI

---

## Documentation

All docs updated to show both approaches:

- **README.md** — Quick start with both options
- **docs/OPENCLAW.md** — Recommends interactive for first-time users
- **packages/openclaw-plugin/README.md** — Installation with `janee add`

---

## Example Workflows

### Beginner Setup
```bash
npm install -g janee
janee init
janee add
# Follow prompts...
janee serve
```

### Power User Setup
```bash
npm install -g janee
janee init
vim ~/.janee/config.yaml
# Add services...
janee serve
```

### Quick Setup (Shell Script)
```bash
janee add stripe -u https://api.stripe.com -k $STRIPE_KEY
janee add github -u https://api.github.com -k $GITHUB_TOKEN
janee serve
```

---

## Status

- ✅ Implemented in commit ceabd47
- ✅ Works with YAML config
- ✅ Supports all auth types
- ✅ Creates capabilities automatically
- ✅ Docs updated
- ⏳ Ready for testing

**Best of both worlds: guided for beginners, flexible for power users.**

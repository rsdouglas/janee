# The Secret Problem: Managing Credentials in MCP Servers

## TL;DR

MCP servers need API keys to be useful. But hardcoding them in config files is a security nightmare. This guide shows you how to handle secrets properly, with practical examples for GitHub, Slack, PostgreSQL, and Filesystem servers.

## The Problem

You want Claude to help with GitHub issues, so you install the GitHub MCP server. The README says:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_your_token_here"
      }
    }
  }
}
```

Now your GitHub token lives in plaintext in `~/Library/Application Support/Claude/claude_desktop_config.json`. 

**What could go wrong?**

1. **Accidental commits**: Config files get backed up, synced, committed to git
2. **Broad access**: Any process reading your config gets all your secrets
3. **No rotation**: When you need to change tokens, you edit raw JSON
4. **No auditing**: You have no idea when/how secrets are used
5. **All-or-nothing**: Claude gets permanent access to everything

## Solution 1: OS-Level Credential Storage

Most operating systems have secure credential stores:
- **macOS**: Keychain
- **Windows**: Credential Manager  
- **Linux**: Secret Service / libsecret

Instead of hardcoding tokens, store them securely and retrieve programmatically.

### Example: GitHub MCP Server with Keychain

```bash
# Store token in macOS Keychain
security add-generic-password \
  -a "github-mcp" \
  -s "github-token" \
  -w "ghp_your_token_here"

# Modify server to read from keychain
# (This requires the server to support it - most don't yet)
```

**Limitations:**
- Not all MCP servers support this
- Requires OS-specific code
- Still gives permanent access

## Solution 2: JIT (Just-In-Time) Provisioning

What if secrets were **temporary** instead of permanent?

```
User: "Check GitHub issue #123"
↓
System: "Approve GitHub read access for 5 minutes?"
↓
Agent: Gets temporary token, makes API call, token expires
↓
Attacker (trying later): Token expired, access denied
```

This is the **capability-based security** model. Instead of giving Claude permanent access to everything, you approve specific actions with time limits.

### Example: Janee (MCP Secrets Server)

Janee implements JIT provisioning for MCP:

```bash
# Install
npm install -g @true-and-useful/janee

# Add to Claude Desktop config
{
  "mcpServers": {
    "janee": {
      "command": "janee",
      "args": []
    }
  }
}
```

Now when Claude needs GitHub access:

1. **User asks**: "What's the status of issue #123?"
2. **Janee intercepts**: Prompts for approval with scope and duration
3. **User approves**: "Yes, read access for 5 minutes"
4. **Temporary token**: Janee generates short-lived credential
5. **Access expires**: After 5 minutes, token is invalid

**Benefits:**
- No permanent secrets in config files
- User controls every API access
- Time-limited exposure
- Full audit trail

## Solution 3: Enterprise Secret Vaults

For teams/enterprises, integrate with existing secret management:

- **HashiCorp Vault**
- **AWS Secrets Manager**
- **Azure Key Vault**
- **1Password Connect**

### Example: Vault Integration (Conceptual)

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "vault://secret/github/token"
      }
    }
  }
}
```

The MCP runtime would:
1. Detect `vault://` prefix
2. Authenticate to Vault
3. Retrieve secret dynamically
4. Pass to server process

**Status**: This is not yet standardized in MCP, but there are discussions in the community about supporting it.

## Hybrid Approach: Static + Dynamic Secrets

For production systems, you might want:

- **Static secrets** for infrastructure (DB passwords, internal APIs)
  → Use Vault/AWS Secrets Manager
  
- **Dynamic secrets** for user-driven actions (GitHub, Slack, Jira)
  → Use JIT provisioning (Janee, OAuth flows)

### Example Configuration

```json
{
  "mcpServers": {
    "janee": {
      "command": "janee",
      "args": [],
      "capabilities": ["github", "slack", "linear"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "vault://secret/postgres/connection"
      }
    }
  }
}
```

**What this gives you:**
- ✅ PostgreSQL credentials managed centrally (Vault)
- ✅ GitHub/Slack access approved per-use (Janee)
- ✅ No plaintext secrets in config
- ✅ Audit trail for all access

## Real-World Examples

### GitHub MCP Server

**Before (Insecure):**
```json
{
  "mcpServers": {
    "github": {
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_abc123..."
      }
    }
  }
}
```

**After (Secure with Janee):**
```json
{
  "mcpServers": {
    "janee": {
      "command": "janee",
      "args": []
    }
  }
}
```

When Claude needs GitHub access, you approve the request through Janee's UI with specific scopes and time limits.

### PostgreSQL Server

**Before:**
```json
{
  "mcpServers": {
    "postgres": {
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost/db"
      }
    }
  }
}
```

**After (with environment variables):**
```bash
# Store in .env (not checked into git)
export DATABASE_URL="postgresql://user:password@localhost/db"
```

```json
{
  "mcpServers": {
    "postgres": {
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    }
  }
}
```

**Better (with Vault):**
```bash
# Retrieve from Vault on startup
export DATABASE_URL=$(vault kv get -field=url secret/postgres)
```

### Slack MCP Server

**Problem:** Slack tokens have broad permissions (read messages, send messages, manage channels)

**Solution with Janee:**
1. User: "Send a message to #engineering"
2. Janee: "Approve Slack write access for 1 minute?"
3. User: "Yes"
4. Message sent, access expires

This prevents:
- Accidental mass-messages
- Prompt injection attacks that abuse Slack access
- Long-lived token exposure

## Best Practices

### 1. Never Commit Secrets to Git

```bash
# Add to .gitignore
claude_desktop_config.json
.env
secrets/
*.key
```

### 2. Use Environment Variables

Instead of hardcoding in config:

```json
{
  "mcpServers": {
    "github": {
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### 3. Rotate Secrets Regularly

- Set expiration dates on tokens
- Use short-lived credentials where possible
- Automate rotation with secret managers

### 4. Audit Secret Access

Track when/how secrets are used:
- Enable audit logging in your secret manager
- Monitor for unusual access patterns
- Review access logs periodically

### 5. Principle of Least Privilege

- Give each server only the permissions it needs
- Use read-only tokens when possible
- Limit token scopes to specific resources

## The Future: MCP Native Secret Management

The MCP community is discussing standardized approaches:

### Proposal 1: `secretsResolution` in Config

```json
{
  "mcpServers": {
    "my-server": {
      "secretsResolution": "vault://path/to/secrets",
      "command": "..."
    }
  }
}
```

### Proposal 2: OAuth Integration

Let servers declare OAuth requirements:

```json
{
  "mcpServers": {
    "github": {
      "oauth": {
        "provider": "github",
        "scopes": ["repo:read", "issues:write"]
      }
    }
  }
}
```

The MCP client would handle the OAuth flow and token management.

### Proposal 3: Capability-Based Access

Servers request capabilities, users approve:

```
Server: "I need GitHub access"
User: "Approved for 1 hour, read-only"
Server: Gets temporary token with those constraints
```

## Conclusion

Secrets management in MCP is still evolving, but you don't have to wait for perfect solutions:

**Right now, you can:**
1. Use environment variables instead of hardcoding
2. Integrate with OS credential stores (Keychain, etc.)
3. Use JIT provisioning tools like Janee
4. Integrate with enterprise secret vaults

**In the future:**
- MCP will likely standardize secrets resolution
- OAuth flows will be built into clients
- Capability-based access will become the norm

**The key principle:** Secrets should be temporary, audited, and user-controlled — not permanent, invisible, and all-or-nothing.

---

## Resources

- **Janee**: https://github.com/rsdouglas/janee (MCP secrets server with JIT provisioning)
- **MCP Security Discussions**: https://github.com/modelcontextprotocol/specification/discussions
- **Awesome MCP Servers**: https://github.com/punkpeye/awesome-mcp-servers
- **HashiCorp Vault**: https://www.vaultproject.io/
- **AWS Secrets Manager**: https://aws.amazon.com/secrets-manager/

---

*This guide is a living document. As MCP's security model evolves, I'll update it with new patterns and best practices.*

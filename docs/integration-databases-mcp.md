# Integrating Janee with Database MCP Servers

Manage database credentials securely while giving AI agents read/write access to PostgreSQL, MySQL, SQLite, and Supabase through MCP.

## Why Use Janee for Database Access?

Database credentials are the most sensitive secrets in any stack:
- **Connection strings** contain host, port, username, and password
- **A leaked credential = full database access** — reads, writes, deletes
- **Compliance frameworks** (SOC2, HIPAA) require credential rotation and audit trails

Without Janee, database MCP servers require credentials in plaintext config:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:password@localhost:5432/mydb"]
    }
  }
}
```

**Problems:**
- ❌ Password visible in config file
- ❌ Connection string in process arguments (visible via `ps aux`)
- ❌ No record of which queries the agent ran
- ❌ If config is committed to git, credentials are permanently exposed

---

## Architecture

```
┌──────────────┐     MCP      ┌───────┐    HTTPS    ┌────────────┐
│  AI Agent    │ ◄──────────► │ Janee │ ──────────► │  Database  │
│ (Claude,     │  (tools +    │       │  (injected  │  (Postgres │
│  Cursor)     │   prompts)   │       │   creds)    │   MySQL)   │
└──────────────┘              └───────┘             └────────────┘
                                 │
                          Audit log: what was
                          accessed, when, why
```

---

## Setup

### 1. Install Janee

```bash
npm install -g @true-and-useful/janee
janee init
```

### 2. Add Database Service

**PostgreSQL:**

```bash
janee add service postgres \
  --base-url "postgresql://localhost:5432/mydb" \
  --auth-type basic \
  --auth-key "user:password"
```

**Supabase:**

```bash
janee add service supabase \
  --base-url "https://your-project.supabase.co/rest/v1" \
  --auth-type bearer \
  --auth-key "eyJhbGciOiJIUzI1NiIsInR5..."
```

**MySQL:**

```bash
janee add service mysql \
  --base-url "mysql://localhost:3306/mydb" \
  --auth-type basic \
  --auth-key "root:secret"
```

### 3. Configure Your MCP Client

**Claude Desktop (`claude_desktop_config.json`):**

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

That's it. No database credentials in this file.

### 4. Use It

Ask your AI agent:

> "Query the users table and show me the most recent signups"

The agent calls Janee's `execute` tool → Janee injects the real credentials → the query runs → results come back. The agent never sees `user:password`.

---

## Security Best Practices

### Restrict to Read-Only

Create a read-only database user for agent access:

```sql
-- PostgreSQL
CREATE ROLE agent_readonly WITH LOGIN PASSWORD 'agent_pass';
GRANT CONNECT ON DATABASE mydb TO agent_readonly;
GRANT USAGE ON SCHEMA public TO agent_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agent_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO agent_readonly;
```

Then configure Janee with this restricted user instead of your admin credentials.

### Use Connection Pooling

For production, point Janee at a connection pooler (PgBouncer, Supavisor) rather than directly at the database:

```bash
janee add service postgres \
  --base-url "postgresql://pooler.example.com:6432/mydb" \
  --auth-type basic \
  --auth-key "agent_readonly:agent_pass"
```

### Rotate Credentials

When you rotate database passwords, update once in Janee:

```bash
janee update service postgres --auth-key "agent_readonly:new_password"
```

All connected agents automatically use the new credentials. No config files to update, no agents to restart.

### Review Audit Logs

```bash
janee logs --service postgres --last 24h
```

See every query the agent executed, with timestamps and context.

---

## Supported Database MCP Servers

| Server | Package | Notes |
|--------|---------|-------|
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Official MCP server |
| SQLite | `@modelcontextprotocol/server-sqlite` | File-based, local only |
| MySQL | `@benborla29/mcp-server-mysql` | Community server |
| Supabase | `@supabase/mcp` | Includes auth + storage |
| Neon | `@neondatabase/mcp-server-neon` | Serverless Postgres |

All of these normally require credentials passed via environment variables or CLI arguments. Janee replaces that pattern with encrypted, audited secret injection.

---

## Example: Supabase + Janee + Claude Desktop

A complete working setup:

**1. Store Supabase credentials:**

```bash
janee add service supabase \
  --base-url "https://xyzproject.supabase.co/rest/v1" \
  --auth-type bearer \
  --auth-key "eyJhbGciOiJIUzI1NiIs..."

janee add service supabase-admin \
  --base-url "https://xyzproject.supabase.co/rest/v1" \
  --auth-type bearer \
  --auth-key "eyJhbGciOiJIUzI1NiIs..." \
```

**2. Claude Desktop config:**

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

**3. Talk to Claude:**

> "Show me all users who signed up in the last week from the supabase service"

Claude uses Janee → Janee authenticates with Supabase → results returned → credentials never exposed.

---

## Troubleshooting

**"Service not found" error:**
- Run `janee list` to see configured services
- Service names are case-sensitive

**Connection timeout:**
- Verify the database is accessible from your machine
- Check firewall rules allow the connection
- Try the connection string directly with `psql` or `mysql` first

**Agent can't modify data:**
- Check if you configured a read-only user (this is good!)
- If writes are needed, create a separate service with write permissions

---

## Next Steps

- [Janee Quickstart](./quickstart.md)
- [Secrets Management Best Practices](./mcp-secrets-guide.md)
- [GitHub MCP Integration](./integration-github-mcp.md)
- [Slack MCP Integration](./integration-slack-mcp.md)

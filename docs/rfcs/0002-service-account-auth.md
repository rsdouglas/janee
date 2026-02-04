# RFC-0002: Service Account Authentication

**Status:** Draft  
**Author:** Kit (with Ross)  
**Created:** 2026-02-04

## Summary

Add support for Google-style service account authentication in Janee, enabling agents to access APIs that require OAuth2 JWT-based auth (e.g., Google Analytics, Google Sheets, GCP services).

## Motivation

### The Story: Janee Agent Needs Analytics

The Janee agent is responsible for promoting the project — posting on social media, engaging in relevant conversations, and tracking what's working. To measure effectiveness, it needs access to Google Analytics.

**Current problem:** Google Analytics Data API requires OAuth2 authentication via service account. Janee currently supports:
- `bearer` — static token in Authorization header
- `headers` — arbitrary headers (API keys)
- `hmac` / `hmac-okx` / `hmac-bybit` — request signing for crypto exchanges

None of these work for Google's auth model, which requires:
1. A service account JSON file with a private key
2. JWT creation and signing at request time
3. Token exchange with Google's OAuth endpoint
4. Using the resulting access token for API calls

### Why This Matters

Google APIs are everywhere — Analytics, Sheets, Drive, Calendar, Cloud services. Many agents will need access to at least one. Without service account support, users have to:
- Give agents raw service account JSON files (security risk)
- Build custom auth wrappers outside Janee (defeats the purpose)
- Skip Google integrations entirely

## Design

### Config Format

```yaml
services:
  google-analytics:
    baseUrl: https://analyticsdata.googleapis.com
    auth:
      type: service-account
      credentials: |
        <encrypted JSON blob - entire service account file contents>
      scopes:
        - https://www.googleapis.com/auth/analytics.readonly
```

The `credentials` field contains the full service account JSON, encrypted with Janee's master key (same as existing secrets).

The `scopes` field specifies OAuth scopes to request. Different Google APIs require different scopes.

### Alternative: File Reference

```yaml
auth:
  type: service-account
  keyFile: ~/.janee/keys/ga-service-account.json
  scopes:
    - https://www.googleapis.com/auth/analytics.readonly
```

**Tradeoffs:**
- File reference: Familiar to users, but another file to manage and secure
- Embedded: Single config file, consistent with existing Janee patterns

**Recommendation:** Support both. Default to embedded for new setups, allow file reference for users migrating existing service accounts.

### Runtime Behavior

When Janee proxies a request to a service-account service:

1. **Decrypt** the service account credentials
2. **Create JWT** with:
   - `iss`: service account email
   - `scope`: configured scopes
   - `aud`: `https://oauth2.googleapis.com/token`
   - `iat`: current timestamp
   - `exp`: current timestamp + 1 hour
3. **Sign JWT** with the service account's private key (RS256)
4. **Exchange** JWT for access token at Google's token endpoint
5. **Cache** access token until near expiry (~50 minutes)
6. **Proxy** the original request with `Authorization: Bearer <access_token>`

### Token Caching

Google access tokens are valid for 1 hour. Janee should:
- Cache tokens in memory per service
- Refresh when <10 minutes remaining
- Handle 401 responses by forcing token refresh

### CLI: Adding Service Accounts

```bash
# From file
janee add google-analytics \
  --base-url https://analyticsdata.googleapis.com \
  --auth-type service-account \
  --key-file ~/Downloads/my-service-account.json \
  --scope https://www.googleapis.com/auth/analytics.readonly

# Interactive (paste JSON)
janee add google-analytics --auth-type service-account
# Prompts for JSON content, scopes
```

### Example: Google Analytics Query

Once configured, the agent can query GA4:

```
janee_execute(
  service="google-analytics",
  method="POST",
  path="/v1beta/properties/123456789:runReport",
  body={
    "dateRanges": [{"startDate": "7daysAgo", "endDate": "today"}],
    "metrics": [{"name": "sessions"}, {"name": "screenPageViews"}],
    "dimensions": [{"name": "date"}]
  }
)
```

Janee handles all the OAuth complexity. The agent just makes a REST call.

## Implementation Notes

### Dependencies

Need JWT signing capability. Options:
- `jsonwebtoken` npm package (lightweight)
- Node's built-in `crypto` for RS256 signing

### Service Account JSON Structure

```json
{
  "type": "service_account",
  "project_id": "my-project",
  "private_key_id": "abc123",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "janee@my-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

Janee needs `private_key`, `client_email`, and `token_uri` from this.

### Audit Logging

Service account requests should be logged like any other Janee request:
- Timestamp, service, method, path
- Do NOT log the JWT or access token
- Log token refresh events separately

## Tradeoffs & Limitations

### Proxy-Only (Initially)

This RFC covers the proxy model only. For handoff (agent runs Google SDK directly), we'd need to:
- Write decrypted credentials to a temp file
- Set `GOOGLE_APPLICATION_CREDENTIALS` env var
- Clean up after

That's out of scope here but could be added to RFC-0001 (Credential Handoff).

### Google-Specific?

The JWT + token exchange flow is Google's pattern. Other providers (Azure, AWS) have different service account models. This RFC focuses on Google; other providers could be separate auth types.

### Scope Management

Users need to know which scopes to request. Janee could provide presets:
```yaml
auth:
  type: service-account
  credentials: ...
  preset: google-analytics  # implies correct scopes
```

But this adds maintenance burden. Start simple: require explicit scopes.

## Alternatives Considered

### 1. Wrap Google SDKs

Instead of proxying HTTP, Janee could wrap Google's Node SDKs and expose higher-level tools.

**Rejected:** Too much surface area. Every Google API would need its own wrapper. HTTP proxy is more general.

### 2. External Token Helper

User runs a separate process that handles Google auth, Janee just uses the resulting token.

**Rejected:** Adds complexity, doesn't solve the "secure credential storage" problem.

### 3. Only Support Handoff

Don't proxy Google requests; always use handoff mode (RFC-0001) for Google services.

**Rejected:** Handoff has more moving parts (temp files, env vars). Proxy is cleaner when it works, and it works for Google's REST APIs.

## Open Questions

1. **Should Janee validate the service account JSON on add?** (Check required fields, maybe test auth)
2. **How to handle multiple Google projects?** (Probably just multiple services)
3. **Scope presets — worth it?** (Leaning no for v1)

## Next Steps

1. Implement `service-account` auth type
2. Add JWT signing and token exchange
3. Add token caching
4. Update `janee add` CLI
5. Test with Google Analytics Data API
6. Document setup flow (GCP console steps)

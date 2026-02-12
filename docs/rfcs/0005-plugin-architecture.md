# RFC 0005: Secrets Provider Plugin Architecture

**Status:** Proposed  
**Author:** Luca Moretti (@lucamorettibuilds)  
**Date:** 2026-02-12  
**Related Issue:** [#54](https://github.com/rsdouglas/janee/issues/54)

## Summary

Add a plugin architecture to support multiple secrets management backends (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, etc.) instead of only filesystem-based encrypted storage. This enables Janee to integrate with existing enterprise secrets infrastructure while maintaining its core security properties.

New configuration: `providers` block that defines secrets backends with type-specific configuration. Service keys can reference providers using a URI-style syntax: `provider://path/to/secret`.

## Motivation

Janee currently stores encrypted secrets on the local filesystem. This works well for individual developers and small teams, but creates friction for enterprise adoption:

**Current limitations:**
- No integration with existing secrets infrastructure (Vault, AWS, Azure, GCP)
- Secrets must be copied/duplicated into Janee's local storage
- No centralized rotation or auditing through enterprise systems
- Bootstrap problem: how do you securely provision Janee's master key?

**Enterprise requirements:**
- Secrets already exist in Vault/AWS/Azure
- Security teams mandate centralized secrets management
- Compliance requires audit trails from secrets backend
- Secrets rotation happens at the provider level

**Solution:** Make Janee's secrets backend pluggable. Support local filesystem storage (current behavior) PLUS external providers. Each service can choose its provider, or mix providers for different services.

## Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Janee Core                           │
│  (MCP Server, Auth Proxy, Audit, Policy Enforcement)   │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ▼
         ┌────────────────────┐
         │  Secrets Manager   │  (abstraction layer)
         │  Interface         │
         └────────┬───────────┘
                  │
    ┌─────────────┼─────────────┬─────────────────┐
    │             │             │                 │
    ▼             ▼             ▼                 ▼
┌──────────┐ ┌──────────┐ ┌──────────┐     ┌──────────┐
│ Local FS │ │ HashiCorp│ │   AWS    │ ... │  Azure   │
│ Provider │ │  Vault   │ │ Secrets  │     │   Key    │
│(default) │ │ Provider │ │ Manager  │     │  Vault   │
└──────────┘ └──────────┘ └──────────┘     └──────────┘
```

### Configuration Example

```yaml
# Define available secrets providers
providers:
  local:
    type: filesystem
    path: ~/.janee/credentials
    # This is the current default behavior
  
  prodVault:
    type: hashicorp-vault
    address: https://vault.company.com
    namespace: mcp-agents
    auth:
      method: token
      token: ${VAULT_TOKEN}  # From environment
    # Alternative auth methods: approle, kubernetes, aws, etc.
  
  awsSecrets:
    type: aws-secrets-manager
    region: us-east-1
    auth:
      method: iam-role  # Use instance/pod IAM role
      # Alternative: access-key with key/secret
  
  devVault:
    type: hashicorp-vault
    address: http://localhost:8200
    auth:
      method: docker
      # Starts vault in Docker for local development
      image: hashicorp/vault:latest
      network: host
      volumes:
        - ./vault-data:/vault/data

# Services reference providers using URI syntax
services:
  stripe:
    baseUrl: https://api.stripe.com
    auth:
      type: bearer
      # New URI syntax: provider://path
      key: prodVault://mcp/agents/stripe/api-key
  
  github:
    baseUrl: https://api.github.com
    auth:
      type: bearer
      # Can still use local filesystem (backward compatible)
      key: local://github-token
      # Or omit provider to use default: github-token
  
  openai-dev:
    baseUrl: https://api.openai.com
    auth:
      type: bearer
      key: devVault://dev/openai-key

capabilities:
  stripe_payments:
    service: stripe
    ttl: 1h
    autoApprove: false
  
  github_repos:
    service: github
    ttl: 30m
    autoApprove: true
```

### Provider Interface

All providers must implement this interface:

```typescript
interface SecretsProvider {
  readonly name: string;
  readonly type: string;
  
  /**
   * Initialize the provider (connect, authenticate, etc.)
   */
  initialize(): Promise<void>;
  
  /**
   * Retrieve a secret by path
   * @param path - Provider-specific path (e.g., "mcp/agents/stripe/api-key")
   * @returns The secret value, or null if not found
   */
  getSecret(path: string): Promise<string | null>;
  
  /**
   * Optional: Store a secret (not all providers support this)
   * @param path - Provider-specific path
   * @param value - Secret value to store
   */
  setSecret?(path: string, value: string): Promise<void>;
  
  /**
   * Optional: Delete a secret
   */
  deleteSecret?(path: string): Promise<void>;
  
  /**
   * Optional: List available secrets (for CLI tools)
   */
  listSecrets?(prefix?: string): Promise<string[]>;
  
  /**
   * Clean up resources (disconnect, close connections)
   */
  dispose(): Promise<void>;
  
  /**
   * Health check - is the provider accessible?
   */
  healthCheck(): Promise<{ healthy: boolean; error?: string }>;
}
```

### Phase 1: Core Providers

**Local Filesystem** (current behavior, default)
- No breaking changes
- Services without `provider://` prefix use local storage
- Backward compatible with existing configs

**HashiCorp Vault**
- Most common enterprise secrets manager
- Support multiple auth methods (token, approle, kubernetes, AWS)
- KV v2 secrets engine (most common)

**AWS Secrets Manager**
- Native AWS integration
- IAM-based authentication
- Common in AWS-heavy environments

### Phase 2: Additional Providers

**Azure Key Vault**
- Managed Identity or Service Principal auth
- Common in Azure-heavy environments

**GCP Secret Manager**
- Service Account or Workload Identity auth
- Common in GCP environments

**Environment Variables**
- Simplest provider: reads from `process.env`
- Useful for simple deployments and testing
- Example: `env://STRIPE_API_KEY`

**Docker Secrets**
- For Docker Swarm / Compose deployments
- Reads from `/run/secrets/`

### Migration Path

**Backward compatibility:**
- Existing configs work unchanged
- `key: stripe-token` → implicitly uses local filesystem provider
- No breaking changes for v1 → v2 upgrade

**Explicit local provider:**
```yaml
# These are equivalent:
key: stripe-token                    # implicit local
key: local://stripe-token            # explicit local
key: filesystem://stripe-token       # explicit local (alternate name)
```

**Migration steps for enterprises:**
1. Add `providers` section with external backend
2. Test with one low-risk service
3. Gradually migrate services to external provider
4. Keep local provider for personal dev/testing

### Security Considerations

**Provider credentials:**
- Provider auth credentials (Vault tokens, AWS keys) are sensitive
- Support env var substitution: `${VAULT_TOKEN}`
- Support file references: `${file:~/.vault-token}`
- Consider system keychain integration for local dev

**Audit trail:**
- Log which provider was used for each secret access
- Include provider name and path (but NOT the secret value)
- External providers (Vault, AWS) have their own audit logs

**Failure handling:**
- If provider is unreachable, fail fast with clear error
- Don't fall back to another provider (security risk)
- Health checks should detect provider issues early

**Least privilege:**
- Providers should only have read access to secrets
- Write access (setSecret) is optional and often disabled
- Use provider-specific RBAC (IAM policies, Vault policies)

### Implementation Phases

**Phase 1: Core Architecture (week 1-2)**
- Define `SecretsProvider` interface
- Refactor current code to use interface
- Implement `LocalFilesystemProvider` (current behavior)
- Add provider resolution logic (`provider://path` parsing)
- Update config schema to support `providers` block

**Phase 2: Vault Integration (week 3)**
- Implement `HashicorpVaultProvider`
- Support token and approle auth methods
- Add Vault-specific error handling
- Documentation and examples

**Phase 3: AWS Integration (week 4)**
- Implement `AwsSecretsManagerProvider`
- Support IAM role and access key auth
- Handle AWS-specific errors and retries
- Documentation and examples

**Phase 4: Testing & Documentation (week 5)**
- Integration tests for each provider
- Migration guide from local to external providers
- Security best practices documentation
- Example configs for common scenarios

**Phase 5: Additional Providers (week 6+)**
- Azure Key Vault
- GCP Secret Manager
- Environment variables
- Community-contributed providers

### Testing Strategy

**Unit tests:**
- Mock provider implementations
- Test provider resolution logic
- Test error handling for unreachable providers

**Integration tests:**
- Spin up local Vault in Docker for tests
- Use AWS LocalStack for Secrets Manager tests
- Test backward compatibility with current configs

**Security tests:**
- Verify secrets never logged
- Test provider credential protection
- Validate RBAC with different provider configurations

## API Changes

### Configuration Schema

Add new top-level `providers` block:

```typescript
interface Config {
  providers?: Record<string, ProviderConfig>;
  services: Record<string, ServiceConfig>;
  capabilities: Record<string, CapabilityConfig>;
}

interface ProviderConfig {
  type: 'filesystem' | 'hashicorp-vault' | 'aws-secrets-manager' | 'azure-key-vault' | 'gcp-secret-manager' | 'env';
  // Type-specific configuration
  [key: string]: unknown;
}
```

### Service Key Syntax

Support three formats:

```yaml
# Format 1: Implicit local (current, backward compatible)
key: stripe-token

# Format 2: Explicit provider with path
key: prodVault://mcp/agents/stripe/api-key

# Format 3: Environment variable substitution (existing feature, still works)
key: ${STRIPE_API_KEY}
```

### CLI Commands

Add provider management commands:

```bash
# List configured providers
janee providers list

# Test provider connectivity
janee providers check prodVault

# Migrate a secret from local to provider
janee secret migrate stripe-token --to prodVault://mcp/agents/stripe/api-key
```

## Alternatives Considered

### 1. Environment Variables Only

**Pros:** Simple, universal, no new code
**Cons:** 
- No centralized management
- Secrets in environment are easy to leak
- No rotation or audit trail
- Doesn't solve the enterprise integration problem

### 2. Wrapper Scripts

Let users write scripts that fetch from Vault and inject into Janee.

**Pros:** No code changes needed
**Cons:**
- Every user reinvents the wheel
- No standard approach
- Hard to audit
- Doesn't leverage Janee's security model

### 3. External Secrets Operator Pattern

Use Kubernetes External Secrets Operator or similar to sync secrets into local storage.

**Pros:** Leverages existing tools
**Cons:**
- Requires Kubernetes
- Adds deployment complexity
- Secrets still copied/duplicated
- Audit trail split between systems

## Open Questions

1. **Provider priority:** If a service doesn't specify a provider, should there be a default provider order? (e.g., check Vault, then local, then env?)
   - **Proposal:** Require explicit provider or use single configured default. Implicit fallback is confusing.

2. **Provider-specific features:** Vault supports versioned secrets, AWS supports rotation. Should we expose these?
   - **Proposal:** Start simple (just getSecret), add advanced features later based on demand.

3. **Write operations:** Should providers support writing secrets via Janee? Or read-only?
   - **Proposal:** Read-only for v1. Writing secrets is risky and most enterprises manage this separately.

4. **Provider caching:** Should Janee cache secrets from providers to reduce API calls?
   - **Proposal:** No caching in v1. Let providers handle this (Vault has built-in caching).

5. **Multiple providers per service:** Can a service use multiple providers for different keys?
   - **Proposal:** No, one provider per service key. Keep it simple.

## Success Metrics

- Zero breaking changes for existing users
- At least 3 providers implemented (local, Vault, AWS)
- 10+ enterprise users adopt external provider integration
- Provider API is clean enough for community contributions
- Performance impact < 10ms per request (provider lookup overhead)

## References

- [HashiCorp Vault API](https://developer.hashicorp.com/vault/api-docs)
- [AWS Secrets Manager API](https://docs.aws.amazon.com/secretsmanager/latest/apireference/)
- [Azure Key Vault API](https://learn.microsoft.com/en-us/rest/api/keyvault/)
- [GCP Secret Manager API](https://cloud.google.com/secret-manager/docs/reference/rest)
- [Kubernetes External Secrets Operator](https://external-secrets.io/)
- [12-Factor App: Config](https://12factor.net/config)


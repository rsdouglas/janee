# Programmatic Usage (Library API)

Janee exports its config management functions as a library, so orchestrators and integrations can manage Janee configuration programmatically — adding services, updating capabilities, and controlling agent access — without shelling out to the CLI.

> **Since v0.12.0** — `npm install @true-and-useful/janee`

## When to use the library

- **Orchestrators** that manage Janee as a child process (e.g. [OpenSeed](https://github.com/openseed-dev/openseed))
- **Dashboards** that need CRUD operations on services and capabilities
- **CI/CD pipelines** that provision Janee configs before deployment
- **Custom tooling** that extends Janee's config format

For CLI usage, see the [quickstart](./quickstart.md).

---

## Install

```bash
npm install @true-and-useful/janee
```

## Reading Config

```typescript
import {
  hasYAMLConfig,
  loadYAMLConfig,
  getConfigDir,
} from '@true-and-useful/janee';

// Check if ~/.janee/config.yaml exists
if (hasYAMLConfig()) {
  const config = loadYAMLConfig();
  
  console.log('Services:', Object.keys(config.services));
  console.log('Capabilities:', Object.keys(config.capabilities));
  console.log('Config dir:', getConfigDir()); // ~/.janee
}
```

## Adding a Service

```typescript
import {
  loadYAMLConfig,
  saveYAMLConfig,
  addServiceYAML,
} from '@true-and-useful/janee';

// Add a new service with bearer auth
addServiceYAML('github', {
  baseUrl: 'https://api.github.com',
  auth: {
    type: 'bearer',
    key: 'ghp_yourtoken',
  },
});
```

The key is encrypted automatically using the master key in `~/.janee/config.yaml`.

### With ownership tracking

When an agent (not a human) creates a service, track who created it:

```typescript
import {
  createServiceWithOwnership,
  agentCreatedOwnership,
} from '@true-and-useful/janee';

createServiceWithOwnership(
  'my-api',
  {
    baseUrl: 'https://api.example.com',
    auth: { type: 'bearer', key: 'sk_xxx' },
  },
  agentCreatedOwnership('creature:my-agent')
);
```

## Adding a Capability

```typescript
import { addCapabilityYAML } from '@true-and-useful/janee';

addCapabilityYAML('github-readonly', {
  service: 'github',
  ttl: '10m',
  autoApprove: true,
  rules: {
    allow: ['GET /repos/**', 'GET /user/**'],
    deny: ['DELETE /**'],
  },
});
```

## Modifying Config Directly

For updates that aren't covered by the helper functions, load → modify → save:

```typescript
import { loadYAMLConfig, saveYAMLConfig } from '@true-and-useful/janee';

const config = loadYAMLConfig();

// Update a capability's TTL
config.capabilities['github-readonly'].ttl = '30m';

// Restrict a capability to specific agents
config.capabilities['github-readonly'].allowedAgents = [
  'creature:trusted-agent',
];

// Remove a service (and its capabilities)
delete config.services['old-api'];
for (const [name, cap] of Object.entries(config.capabilities)) {
  if (cap.service === 'old-api') delete config.capabilities[name];
}

saveYAMLConfig(config);
```

## Agent Access Control

Control which agents can access which capabilities:

```typescript
import {
  canAgentAccess,
  grantAccess,
  revokeAccess,
  loadYAMLConfig,
  saveYAMLConfig,
} from '@true-and-useful/janee';

const config = loadYAMLConfig();
const service = config.services['github'];

// Check if an agent can access a service
const allowed = canAgentAccess(
  'creature:my-agent',
  service,
  'restricted' // server's defaultAccess policy
);

// Grant access to a specific agent
grantAccess(service, 'creature:new-agent');

// Revoke access
revokeAccess(service, 'creature:old-agent');

saveYAMLConfig(config);
```

## Reloading a Running Janee Process

After mutating config on disk, send `SIGHUP` to the running Janee process to reload without restart:

```typescript
import { execSync } from 'node:child_process';

function reloadJanee(): boolean {
  try {
    // Find the Janee process
    const pid = execSync('pgrep -f "janee serve"', { encoding: 'utf8' }).trim();
    if (!pid) return false;
    
    process.kill(Number(pid), 'SIGHUP');
    return true;
  } catch {
    return false;
  }
}

// After saving config changes:
saveYAMLConfig(config);
const reloaded = reloadJanee();
console.log(reloaded ? 'Config reloaded' : 'Janee not running — config saved for next start');
```

## Types

All config types are exported for TypeScript consumers:

```typescript
import type {
  AuthConfig,
  CapabilityConfig,
  JaneeYAMLConfig,
  LLMConfig,
  ServerConfig,
  ServiceConfig,
  AccessPolicy,
  CredentialOwnership,
} from '@true-and-useful/janee';
```

### `ServiceConfig`

```typescript
interface ServiceConfig {
  baseUrl: string;
  auth: AuthConfig;
  testPath?: string;           // Path for `janee test` health checks
  ownership?: CredentialOwnership;
}
```

### `CapabilityConfig`

```typescript
interface CapabilityConfig {
  service: string;
  ttl: string;                 // e.g. "10m", "1h"
  autoApprove?: boolean;
  requiresReason?: boolean;
  rules?: {
    allow?: string[];          // e.g. ["GET /repos/**"]
    deny?: string[];           // e.g. ["DELETE /**"]
  };
  allowedAgents?: string[];
  
  // Exec mode (for CLI tools)
  mode?: 'proxy' | 'exec';
  allowCommands?: string[];
  env?: Record<string, string>;
  workDir?: string;
  timeout?: number;            // ms, default 30000
}
```

### `AuthConfig`

```typescript
interface AuthConfig {
  type: 'bearer' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' 
      | 'headers' | 'service-account' | 'github-app';
  key?: string;                // Bearer token
  apiKey?: string;             // HMAC API key
  apiSecret?: string;          // HMAC secret
  passphrase?: string;         // OKX passphrase
  headers?: Record<string, string>;
  credentials?: string;        // Service account JSON
  scopes?: string[];           // OAuth scopes
  appId?: string;              // GitHub App ID
  privateKey?: string;         // GitHub App PEM
  installationId?: string;     // GitHub App installation
}
```

## Example: Dashboard Integration

Here's a pattern for a dashboard that manages Janee config via REST endpoints (used by [OpenSeed](https://github.com/openseed-dev/openseed)):

```typescript
import {
  hasYAMLConfig,
  loadYAMLConfig,
  saveYAMLConfig,
  type JaneeYAMLConfig,
  type ServiceConfig,
} from '@true-and-useful/janee';

// Mask secrets before sending to the frontend
function maskConfig(config: JaneeYAMLConfig) {
  const masked = structuredClone(config);
  for (const svc of Object.values(masked.services)) {
    if (svc.auth.key) svc.auth.key = '••••' + svc.auth.key.slice(-4);
    if (svc.auth.apiSecret) svc.auth.apiSecret = '••••';
  }
  return masked;
}

// GET /api/config — read (masked)
function getConfig() {
  if (!hasYAMLConfig()) return { services: {}, capabilities: {} };
  return maskConfig(loadYAMLConfig());
}

// PUT /api/services/:name — update a service
function updateService(name: string, patch: Partial<ServiceConfig>) {
  const config = loadYAMLConfig();
  if (!config.services[name]) throw new Error(`Service ${name} not found`);
  Object.assign(config.services[name], patch);
  saveYAMLConfig(config);
}
```

## Environment

Janee reads `JANEE_HOME` to locate its config directory. Defaults to `~/.janee`.

```bash
# Use a custom config directory
JANEE_HOME=/etc/janee node your-orchestrator.js
```

This is useful when running Janee in containers or managing multiple isolated configs.

/**
 * Janee library exports for programmatic config management.
 *
 * Use these to read/write ~/.janee/config.yaml from an orchestrator
 * or integration that manages Janee as a child process. After mutations,
 * send SIGHUP to the running Janee process to reload config in-memory.
 */

// Config types
export type {
  AuthConfig,
  CapabilityConfig,
  JaneeYAMLConfig,
  LLMConfig,
  ServerConfig,
  ServiceConfig,
} from './cli/config-yaml';

// Config read/write
export {
  addCapabilityYAML,
  addServiceYAML,
  createServiceWithOwnership,
  getConfigDir,
  hasYAMLConfig,
  initYAMLConfig,
  loadYAMLConfig,
  persistServiceOwnership,
  saveYAMLConfig,
} from './cli/config-yaml';

// Agent scope / ownership
export type {
  AccessPolicy,
  CredentialOwnership,
} from './core/agent-scope';

export {
  agentCreatedOwnership,
  canAgentAccess,
  cliCreatedOwnership,
  grantAccess,
  revokeAccess,
} from './core/agent-scope';

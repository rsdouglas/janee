/**
 * @deprecated — Use config-store.ts instead. This file re-exports for backwards compatibility.
 */
export {
  hasConfig as hasYAMLConfig,
  loadConfig as loadYAMLConfig,
  saveConfig as saveYAMLConfig,
  getConfigDir,
  getAuditDir,
  initConfig,
  migrateToSQLite as migrateToYAML,
} from './config-store';

export type { JaneeConfig, ServiceConfig, CapabilityConfig, ServerConfig } from './config-store';

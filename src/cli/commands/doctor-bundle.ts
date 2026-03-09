import { writeFileSync } from 'fs';

import {
  AuditEvent,
  AuditLogger,
} from '../../core/audit';
import {
  getAuditDir,
  hasYAMLConfig,
  JaneeYAMLConfig,
  loadYAMLConfig,
} from '../config-yaml';

interface BundleOutput {
  generated: string;
  janeeVersion: string;
  config: {
    version: string;
    server: Record<string, any>;
    serviceCount: number;
    services: Array<{ name: string; authType: string; hasOwnership: boolean }>;
    capabilityCount: number;
    capabilities: Array<{
      name: string;
      service: string;
      mode: string;
      allowedAgents?: string[];
      hasRules: boolean;
    }>;
  } | null;
  recentDenials: Array<Partial<AuditEvent>>;
  agentAccess?: {
    agent: string;
    accessible: string[];
    denied: string[];
  };
  error?: string;
}

function redactConfig(config: JaneeYAMLConfig): BundleOutput['config'] {
  const services = Object.entries(config.services).map(([name, svc]) => ({
    name,
    authType: (svc as any).auth?.type || 'unknown',
    hasOwnership: !!(svc as any).ownership,
  }));

  const capabilities = Object.entries(config.capabilities).map(([name, cap]) => ({
    name,
    service: (cap as any).service,
    mode: (cap as any).mode || 'proxy',
    allowedAgents: (cap as any).allowedAgents,
    hasRules: !!(cap as any).rules,
  }));

  return {
    version: config.version,
    server: {
      port: config.server?.port,
      host: config.server?.host,
      defaultAccess: config.server?.defaultAccess ?? 'open',
      strictDecryption: config.server?.strictDecryption,
    },
    serviceCount: services.length,
    services,
    capabilityCount: capabilities.length,
    capabilities,
  };
}

export async function doctorBundleCommand(
  options: { output?: string; agent?: string; lines?: string } = {},
): Promise<void> {
  const bundle: BundleOutput = {
    generated: new Date().toISOString(),
    janeeVersion: '',
    config: null,
    recentDenials: [],
  };

  try {
    const pkgPath = require.resolve('../../../package.json');
    bundle.janeeVersion = require(pkgPath).version || 'unknown';
  } catch {
    bundle.janeeVersion = 'unknown';
  }

  if (hasYAMLConfig()) {
    try {
      const config = loadYAMLConfig();
      bundle.config = redactConfig(config);

      // Agent access summary
      if (options.agent) {
        const agentId = options.agent;
        const accessible: string[] = [];
        const denied: string[] = [];

        for (const [name, cap] of Object.entries(config.capabilities)) {
          const c = cap as any;
          let allowed = true;

          if (c.allowedAgents && c.allowedAgents.length > 0) {
            allowed = c.allowedAgents.includes(agentId);
          } else if (config.server?.defaultAccess === 'restricted') {
            allowed = false;
          }

          (allowed ? accessible : denied).push(name);
        }

        bundle.agentAccess = { agent: agentId, accessible, denied };
      }
    } catch (err: any) {
      bundle.error = `Config load error: ${err.message}`;
    }
  } else {
    bundle.error = 'No config found';
  }

  // Recent denials from audit log
  try {
    const auditLogger = new AuditLogger(getAuditDir());
    const limit = parseInt(options.lines || '50');
    const events = await auditLogger.readLogs({ limit: limit * 5 });
    const denials = events
      .filter(e => e.denied)
      .slice(-limit)
      .map(e => ({
        timestamp: e.timestamp,
        service: e.service,
        method: e.method,
        path: e.path,
        denyReason: e.denyReason,
        agentId: e.agentId,
      }));
    bundle.recentDenials = denials;
  } catch {
    // No audit logs available
  }

  const json = JSON.stringify(bundle, null, 2);

  if (options.output) {
    writeFileSync(options.output, json);
    console.log(`Bundle written to ${options.output}`);
  } else {
    console.log(json);
  }
}

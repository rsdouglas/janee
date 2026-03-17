import { canAgentAccess } from '../../core/agent-scope';
import { handleCommandError, requireConfig } from '../cli-utils';
import { loadYAMLConfig } from '../config-yaml';
import type { CapabilityConfig, ServiceConfig as YAMLServiceConfig } from '../config-yaml';

type AccessPolicy = 'open' | 'restricted' | undefined;

interface CapAccess {
  name: string;
  service: string;
  mode: string;
  access: AccessPolicy;
  allowedAgents: string[];
}

function resolveEffectiveAccess(
  cap: CapabilityConfig,
  service: YAMLServiceConfig | undefined,
  agentId: string,
  globalDefault: AccessPolicy,
): 'allowed' | 'denied' | 'open' {
  if (cap.allowedAgents && cap.allowedAgents.length > 0) {
    return cap.allowedAgents.includes(agentId) ? 'allowed' : 'denied';
  }

  const effective = cap.access ?? globalDefault;
  if (effective === 'restricted') return 'denied';

  if (!canAgentAccess(agentId, service?.ownership)) return 'denied';

  return 'open';
}

export async function overviewCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    requireConfig(options.json);
    const config = loadYAMLConfig();
    const globalDefault = config.server?.defaultAccess;

    const serviceNames = Object.keys(config.services);
    const capEntries = Object.entries(config.capabilities);

    // Collect all known agent IDs from allowedAgents and ownership
    const knownAgents = new Set<string>();
    for (const [, cap] of capEntries) {
      for (const a of cap.allowedAgents ?? []) knownAgents.add(a);
    }
    for (const [, svc] of Object.entries(config.services)) {
      for (const a of svc.ownership?.sharedWith ?? []) knownAgents.add(a);
      if (svc.ownership?.createdBy) knownAgents.add(svc.ownership.createdBy);
    }

    // Build per-capability access info
    const caps: CapAccess[] = capEntries.map(([name, cap]) => ({
      name,
      service: cap.service,
      mode: cap.mode || 'proxy',
      access: cap.access,
      allowedAgents: cap.allowedAgents ?? [],
    }));

    // Build per-agent access map
    const agentAccess: Record<string, { accessible: string[]; denied: string[] }> = {};
    for (const agentId of knownAgents) {
      const accessible: string[] = [];
      const denied: string[] = [];
      for (const [name, cap] of capEntries) {
        const svc = config.services[cap.service];
        const result = resolveEffectiveAccess(cap, svc, agentId, globalDefault);
        if (result === 'denied') denied.push(name);
        else accessible.push(name);
      }
      agentAccess[agentId] = { accessible, denied };
    }

    // Find capabilities no known agent can reach
    const unreachable = caps.filter(cap => {
      if (cap.allowedAgents.length > 0) return false;
      const effective = cap.access ?? globalDefault;
      if (effective === 'restricted') return true;
      return false;
    });

    if (options.json) {
      console.log(JSON.stringify({
        services: serviceNames.length,
        capabilities: caps.length,
        globalDefaultAccess: globalDefault ?? 'open',
        agents: agentAccess,
        unreachable: unreachable.map(c => c.name),
      }, null, 2));
      return;
    }

    // Human-readable output
    console.log('');
    console.log(`  ${serviceNames.length} service${serviceNames.length !== 1 ? 's' : ''}, ${caps.length} capabilit${caps.length !== 1 ? 'ies' : 'y'}    (defaultAccess: ${globalDefault ?? 'open'})`);
    console.log('');

    if (caps.length === 0) {
      console.log('  No capabilities configured. Run `janee add <service>` to get started.');
      console.log('');
      return;
    }

    // Per-agent summary
    if (knownAgents.size > 0) {
      for (const agentId of [...knownAgents].sort()) {
        const { accessible, denied } = agentAccess[agentId];
        if (accessible.length > 0) {
          const labels = accessible.map(name => {
            const cap = config.capabilities[name];
            if (cap.allowedAgents?.includes(agentId)) return `${name} (allowed)`;
            if (cap.access === 'open') return `${name} (open)`;
            return name;
          });
          console.log(`  ${agentId}: ${labels.join(', ')}`);
        } else {
          console.log(`  ${agentId}: (no access)`);
        }
      }
    } else {
      console.log('  No agent restrictions configured — all capabilities are open.');
    }

    // Unreachable capabilities
    if (unreachable.length > 0) {
      console.log('');
      console.log(`  Unreachable: ${unreachable.map(c => c.name).join(', ')}`);
      console.log('  (restricted with no allowedAgents — no agent can use these)');
    }

    console.log('');

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

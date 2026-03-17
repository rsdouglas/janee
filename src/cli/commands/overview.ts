import { resolveAccess } from '../../core/agent-scope';
import {
  handleCommandError,
  requireConfig,
} from '../cli-utils';
import { loadYAMLConfig } from '../config-yaml';

const useColor = process.stdout.isTTY !== false && !process.env.NO_COLOR;
const c = {
  bold:    (s: string) => useColor ? `\x1b[1m${s}\x1b[22m` : s,
  dim:     (s: string) => useColor ? `\x1b[2m${s}\x1b[22m` : s,
  green:   (s: string) => useColor ? `\x1b[32m${s}\x1b[39m` : s,
  yellow:  (s: string) => useColor ? `\x1b[33m${s}\x1b[39m` : s,
  red:     (s: string) => useColor ? `\x1b[31m${s}\x1b[39m` : s,
  cyan:    (s: string) => useColor ? `\x1b[36m${s}\x1b[39m` : s,
};

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

    // Build per-agent access map with access type
    const agentAccess: Record<string, { accessible: { name: string; type: 'allowed' | 'open' }[]; denied: string[] }> = {};
    for (const agentId of knownAgents) {
      const accessible: { name: string; type: 'allowed' | 'open' }[] = [];
      const denied: string[] = [];
      for (const [name, cap] of capEntries) {
        const svc = config.services[cap.service];
        const result = resolveAccess(agentId, cap, svc, globalDefault);
        if (result === 'denied') denied.push(name);
        else accessible.push({ name, type: result });
      }
      agentAccess[agentId] = { accessible, denied };
    }

    const unreachable = capEntries.filter(([name]) => {
      if (knownAgents.size === 0) return false;
      return [...knownAgents].every(agentId => agentAccess[agentId].denied.includes(name));
    }).map(([name]) => name);

    if (options.json) {
      const jsonAgents: Record<string, { accessible: string[]; denied: string[] }> = {};
      for (const [agentId, data] of Object.entries(agentAccess)) {
        jsonAgents[agentId] = { accessible: data.accessible.map(a => a.name), denied: data.denied };
      }
      console.log(JSON.stringify({
        services: serviceNames.length,
        capabilities: capEntries.length,
        globalDefaultAccess: globalDefault ?? 'open',
        agents: jsonAgents,
        unreachable,
      }, null, 2));
      return;
    }

    // Human-readable output
    console.log('');
    console.log(`  ${c.bold(`${serviceNames.length}`)} service${serviceNames.length !== 1 ? 's' : ''}, ${c.bold(`${capEntries.length}`)} capabilit${capEntries.length !== 1 ? 'ies' : 'y'}    ${c.dim(`(defaultAccess: ${globalDefault ?? 'open'})`)}`);
    console.log('');

    if (capEntries.length === 0) {
      console.log(`  No capabilities configured. Run ${c.cyan('janee add <service>')} to get started.`);
      console.log('');
      return;
    }

    // Per-agent summary
    if (knownAgents.size > 0) {
      for (const agentId of [...knownAgents].sort()) {
        const { accessible } = agentAccess[agentId];
        if (accessible.length > 0) {
          const labels = accessible.map(a =>
            a.type === 'allowed' ? c.cyan(a.name) : c.green(a.name)
          );
          console.log(`  ${c.bold(agentId)}: ${labels.join(c.dim(', '))}`);
        } else {
          console.log(`  ${c.bold(agentId)}: ${c.dim('(no access)')}`);
        }
      }
    } else {
      console.log('  No agent restrictions configured — all capabilities are open.');
    }

    // Unreachable capabilities
    if (unreachable.length > 0) {
      console.log('');
      console.log(`  ${c.red('Unreachable')}: ${unreachable.map(n => c.yellow(n)).join(', ')}`);
      console.log(`  ${c.dim('(no known agent can access these)')}`);
    }

    console.log('');

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

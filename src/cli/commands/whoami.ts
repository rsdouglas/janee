import { canAccessCapability } from '../../core/agent-scope';
import {
  handleCommandError,
  requireConfig,
} from '../cli-utils';
import { loadYAMLConfig } from '../config-yaml';

export async function whoamiCommand(
  options: { agent?: string; json?: boolean } = {},
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();
    const agentId = options.agent || undefined;
    const defaultAccess = config.server?.defaultAccess;

    const capNames = Object.keys(config.capabilities);
    const accessible: string[] = [];
    const denied: string[] = [];

    for (const name of capNames) {
      const cap = config.capabilities[name];
      if (canAccessCapability(agentId, cap, config.services[cap.service], defaultAccess)) {
        accessible.push(name);
      } else {
        denied.push(name);
      }
    }

    if (options.json) {
      console.log(JSON.stringify({
        agentId: agentId ?? null,
        role: agentId ? 'agent' : 'admin (CLI)',
        defaultAccessPolicy: defaultAccess ?? 'open',
        capabilities: { accessible, denied },
      }, null, 2));
      return;
    }

    if (!agentId) {
      console.log('');
      console.log('  Identity: CLI admin (no agent identity)');
      console.log('  Access:   all capabilities');
      console.log(`  Default policy: ${defaultAccess ?? 'open'}`);
      console.log(`  Capabilities: ${capNames.length} total`);
      console.log('');
      console.log('  Tip: use --agent <name> to preview what a specific agent can access.');
      return;
    }

    console.log('');
    console.log(`  Agent: ${agentId}`);
    console.log(`  Default policy: ${defaultAccess ?? 'open'}`);
    console.log('');

    if (accessible.length > 0) {
      console.log(`  Accessible (${accessible.length}):`);
      for (const c of accessible) console.log(`    ✅ ${c}`);
    }
    if (denied.length > 0) {
      console.log(`  Denied (${denied.length}):`);
      for (const c of denied) console.log(`    ❌ ${c}`);
    }
    if (accessible.length === 0 && denied.length === 0) {
      console.log('  No capabilities configured.');
    }
    console.log('');
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

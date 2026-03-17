import { validateTTL } from '../../core/types';
import {
  cliError,
  handleCommandError,
  parseEnvMap,
  requireConfig,
} from '../cli-utils';
import {
  CapabilityConfig,
  loadYAMLConfig,
  saveYAMLConfig,
} from '../config-yaml';

export async function capabilityListCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();
    const capabilityNames = Object.keys(config.capabilities);

    if (options.json) {
      const capabilities = capabilityNames.map(name => {
        const cap = config.capabilities[name];
        return {
          name,
          service: cap.service,
          ttl: cap.ttl,
          autoApprove: cap.autoApprove,
          requiresReason: cap.requiresReason,
          allowRules: cap.rules?.allow || [],
          denyRules: cap.rules?.deny || [],
          mode: cap.mode,
          access: cap.access,
          allowedAgents: cap.allowedAgents,
          allowCommands: cap.allowCommands,
          env: cap.env,
          workDir: cap.workDir,
          timeout: cap.timeout,
        };
      });

      console.log(JSON.stringify({ capabilities }, null, 2));
      return;
    }

    if (capabilityNames.length === 0) {
      console.log('No capabilities configured yet.');
      console.log('');
      console.log('Add a capability:');
      console.log('  janee cap add <name> --service <service>');
      return;
    }

    console.log('');
    console.log('Capabilities:');
    for (const name of capabilityNames) {
      const cap = config.capabilities[name];
      const allowCount = cap.rules?.allow?.length || 0;
      const denyCount = cap.rules?.deny?.length || 0;
      const rules = allowCount + denyCount > 0 ? ` [${allowCount} allow, ${denyCount} deny]` : '';
      
      console.log(`  ${name}`);
      console.log(`    Service: ${cap.service}`);
      console.log(`    TTL: ${cap.ttl}`);
      if (cap.mode) console.log(`    Mode: ${cap.mode}`);
      if (cap.autoApprove !== undefined) console.log(`    Auto-approve: ${cap.autoApprove}`);
      if (cap.requiresReason !== undefined) console.log(`    Requires reason: ${cap.requiresReason}`);
      if (rules) console.log(`    Rules:${rules}`);
      if (cap.access) console.log(`    Access: ${cap.access}`);
      if (cap.allowedAgents?.length) console.log(`    Allowed agents: ${cap.allowedAgents.join(', ')}`);
      if (cap.allowCommands?.length) console.log(`    Allow commands: ${cap.allowCommands.join(', ')}`);
      if (cap.env) console.log(`    Env: ${Object.entries(cap.env).map(([k,v]) => `${k}=${v}`).join(', ')}`);
      if (cap.workDir) console.log(`    Work dir: ${cap.workDir}`);
      if (cap.timeout) console.log(`    Timeout: ${cap.timeout}ms`);
      console.log('');
    }
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

interface CapAddEditOptions {
  service?: string;
  ttl?: string;
  autoApprove?: boolean;
  requiresReason?: boolean;
  allow?: string[];
  deny?: string[];
  clearRules?: boolean;
  allowedAgents?: string[];
  clearAgents?: boolean;
  access?: string;
  clearAccess?: boolean;
  mode?: string;
  allowCommands?: string[];
  envMap?: string[];
  workDir?: string;
  timeout?: string;
  json?: boolean;
}

function applyCapabilityOptions(cap: CapabilityConfig, options: CapAddEditOptions, hadAllowedAgents = false): void {
  if (options.allowedAgents && options.clearAgents) {
    throw new Error('Conflicting options: --allowed-agents and --clear-agents cannot be used together');
  }
  if (options.access && options.clearAccess) {
    throw new Error('Conflicting options: --access and --clear-access cannot be used together');
  }

  if (options.allowedAgents) {
    cap.allowedAgents = options.allowedAgents.flatMap(a => a.split(',').map(s => s.trim()).filter(Boolean));
  }
  if (options.clearAgents) {
    delete cap.allowedAgents;
  }
  if (options.access) {
    if (options.access !== 'open' && options.access !== 'restricted') {
      throw new Error(`Invalid access policy "${options.access}" — must be "open" or "restricted"`);
    }
    if (hadAllowedAgents && !options.clearAgents && !options.allowedAgents) {
      console.error(`⚠️  This capability has allowedAgents, which take precedence over --access.`);
      console.error(`   To apply access policy, also pass --clear-agents.`);
    }
    cap.access = options.access;
  }
  if (options.clearAccess) {
    delete cap.access;
  }
  if (options.mode) {
    if (options.mode !== 'proxy' && options.mode !== 'exec') {
      throw new Error(`Invalid mode "${options.mode}" — must be "proxy" or "exec"`);
    }
    if (options.mode === 'exec' && !options.allowCommands?.length && !cap.allowCommands?.length) {
      throw new Error('Exec mode requires --allow-commands');
    }
    cap.mode = options.mode;
  }
  if (options.allowCommands) {
    cap.allowCommands = options.allowCommands;
  }
  if (options.envMap) {
    cap.env = parseEnvMap(options.envMap);
  }
  if (options.workDir) {
    cap.workDir = options.workDir;
  }
  if (options.timeout) {
    cap.timeout = parseInt(options.timeout, 10);
    if (isNaN(cap.timeout) || cap.timeout <= 0) throw new Error(`Invalid timeout "${options.timeout}"`);
  }

  const effectiveMode = cap.mode ?? 'proxy';
  if (effectiveMode === 'proxy' && (options.allowCommands || options.envMap || options.workDir || options.timeout)) {
    console.error(`⚠️  Exec-mode options (--allow-commands, --env-map, --work-dir, --timeout) have no effect on proxy-mode capabilities.`);
  }
}

export async function capabilityAddCommand(
  name: string,
  options: CapAddEditOptions
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();

    if (config.capabilities[name]) {
      cliError(`Capability "${name}" already exists. Use 'janee cap edit' to modify it.`, options.json);
    }

    if (!options.service) {
      cliError('--service is required', options.json);
    }

    if (!config.services[options.service]) {
      cliError(`Service "${options.service}" not found. Add it first with 'janee add'.`, options.json);
    }

    const ttl = options.ttl || '1h';
    validateTTL(ttl);

    const capability: CapabilityConfig = {
      service: options.service,
      ttl,
      autoApprove: options.autoApprove,
      requiresReason: options.requiresReason,
    };

    if (options.allow || options.deny) {
      capability.rules = {};
      if (options.allow) capability.rules.allow = options.allow;
      if (options.deny) capability.rules.deny = options.deny;
    }

    applyCapabilityOptions(capability, options);

    if ((capability.mode === 'exec') && capability.rules) {
      console.error(`⚠️  Path rules (--allow/--deny) have no effect on exec-mode capabilities. Use --allow-commands instead.`);
    }

    config.capabilities[name] = capability;
    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        capability: name,
        service: capability.service,
        ttl: capability.ttl,
        message: `Added capability "${name}"`
      }));
    } else {
      console.log(`✅ Added capability "${name}"`);
      console.log(`   Service: ${capability.service}`);
      console.log(`   TTL: ${capability.ttl}`);
      if (capability.mode) console.log(`   Mode: ${capability.mode}`);
      if (capability.access) console.log(`   Access: ${capability.access}`);
      if (capability.allowedAgents) console.log(`   Allowed agents: ${capability.allowedAgents.join(', ')}`);
    }

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

export async function capabilityEditCommand(
  name: string,
  options: CapAddEditOptions
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();

    if (!config.capabilities[name]) {
      cliError(`Capability "${name}" not found`, options.json);
    }

    const capability = config.capabilities[name];
    const hadAllowedAgents = !!(capability.allowedAgents?.length);

    const hasChanges = options.ttl || options.autoApprove !== undefined ||
      options.requiresReason !== undefined || options.clearRules || options.allow ||
      options.deny || options.allowedAgents || options.clearAgents || options.access ||
      options.clearAccess || options.mode || options.allowCommands || options.envMap ||
      options.workDir || options.timeout;

    if (!hasChanges) {
      cliError('No changes specified. See `janee cap edit --help` for options.', options.json);
    }

    if (options.ttl) {
      validateTTL(options.ttl);
      capability.ttl = options.ttl;
    }
    if (options.autoApprove !== undefined) capability.autoApprove = options.autoApprove;
    if (options.requiresReason !== undefined) capability.requiresReason = options.requiresReason;

    if (options.clearRules && (options.allow || options.deny)) {
      throw new Error('Conflicting options: --clear-rules and --allow/--deny cannot be used together');
    }

    if (options.clearRules) {
      delete capability.rules;
    } else if (options.allow || options.deny) {
      if (!capability.rules) capability.rules = {};
      if (options.allow) capability.rules.allow = options.allow;
      if (options.deny) capability.rules.deny = options.deny;
    }

    applyCapabilityOptions(capability, options, hadAllowedAgents);

    if ((options.allow || options.deny) && (capability.mode === 'exec')) {
      console.error(`⚠️  Path rules (--allow/--deny) have no effect on exec-mode capabilities. Use --allow-commands instead.`);
    }

    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({ ok: true, capability: name, message: `Updated capability "${name}"` }));
    } else {
      console.log(`✅ Updated capability "${name}"`);
    }

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

export async function capabilityRemoveCommand(
  name: string,
  options: { yes?: boolean; json?: boolean } = {}
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();

    if (!config.capabilities[name]) {
      cliError(`Capability "${name}" not found`, options.json);
    }

    // Confirm deletion (skip if --yes flag is set or --json)
    if (!options.yes && !options.json) {
      const readline = await import('readline/promises');
      const { stdin: input, stdout: output } = await import('process');
      const rl = readline.createInterface({ input, output });

      const answer = await rl.question(
        `Are you sure you want to remove capability "${name}"? (y/N): `
      );

      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Cancelled');
        return;
      }
    }

    // Remove capability
    delete config.capabilities[name];
    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        capability: name,
        message: `Capability "${name}" removed successfully`
      }));
    } else {
      console.log(`✅ Capability "${name}" removed successfully!`);
    }

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

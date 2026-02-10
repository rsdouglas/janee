/**
 * Capability management commands
 */

import { loadYAMLConfig, saveYAMLConfig, hasYAMLConfig, CapabilityConfig } from '../config-yaml';

export async function capabilityListCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    if (!hasYAMLConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No config found' }, null, 2));
      } else {
        console.log('No config found. Run `janee init` first.');
      }
      process.exit(1);
    }

    const config = loadYAMLConfig();
    const capabilityNames = Object.keys(config.capabilities);

    if (options.json) {
      // JSON output
      const capabilities = capabilityNames.map(name => {
        const cap = config.capabilities[name];
        return {
          name,
          service: cap.service,
          ttl: cap.ttl,
          autoApprove: cap.autoApprove,
          requiresReason: cap.requiresReason,
          allowRules: cap.rules?.allow || [],
          denyRules: cap.rules?.deny || []
        };
      });

      console.log(JSON.stringify({ capabilities }, null, 2));
      return;
    }

    // Human-readable output
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
      if (cap.autoApprove !== undefined) {
        console.log(`    Auto-approve: ${cap.autoApprove}`);
      }
      if (cap.requiresReason !== undefined) {
        console.log(`    Requires reason: ${cap.requiresReason}`);
      }
      if (rules) {
        console.log(`    Rules: ${rules}`);
      }
      console.log('');
    }
  } catch (error) {
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Unknown error occurred' }, null, 2));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

export async function capabilityAddCommand(
  name: string,
  options: {
    service?: string;
    ttl?: string;
    autoApprove?: boolean;
    requiresReason?: boolean;
    allow?: string[];
    deny?: string[];
    json?: boolean;
  }
): Promise<void> {
  try {
    if (!hasYAMLConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'No config found. Run `janee init` first.' }));
      } else {
        console.error('❌ No config found. Run `janee init` first.');
      }
      process.exit(1);
    }

    const config = loadYAMLConfig();

    // Check if capability already exists
    if (config.capabilities[name]) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: `Capability "${name}" already exists. Use 'janee cap edit' to modify it.` }));
      } else {
        console.error(`❌ Capability "${name}" already exists. Use 'janee cap edit' to modify it.`);
      }
      process.exit(1);
    }

    // Service is required
    if (!options.service) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: '--service is required' }));
      } else {
        console.error('❌ --service is required');
      }
      process.exit(1);
    }

    // Check if service exists
    if (!config.services[options.service]) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: `Service "${options.service}" not found. Add it first with 'janee add'.` }));
      } else {
        console.error(`❌ Service "${options.service}" not found. Add it first with 'janee add'.`);
      }
      process.exit(1);
    }

    // Create capability
    const capability: CapabilityConfig = {
      service: options.service,
      ttl: options.ttl || '1h',
      autoApprove: options.autoApprove,
      requiresReason: options.requiresReason
    };

    // Add rules if provided
    if (options.allow || options.deny) {
      capability.rules = {};
      if (options.allow) {
        capability.rules.allow = options.allow;
      }
      if (options.deny) {
        capability.rules.deny = options.deny;
      }
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
    }

  } catch (error) {
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: error.message }));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'Unknown error occurred' }));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

export async function capabilityEditCommand(
  name: string,
  options: {
    ttl?: string;
    autoApprove?: boolean;
    requiresReason?: boolean;
    allow?: string[];
    deny?: string[];
    clearRules?: boolean;
    json?: boolean;
  }
): Promise<void> {
  try {
    if (!hasYAMLConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'No config found. Run `janee init` first.' }));
      } else {
        console.error('❌ No config found. Run `janee init` first.');
      }
      process.exit(1);
    }

    const config = loadYAMLConfig();

    // Check if capability exists
    if (!config.capabilities[name]) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: `Capability "${name}" not found` }));
      } else {
        console.error(`❌ Capability "${name}" not found`);
      }
      process.exit(1);
    }

    const capability = config.capabilities[name];

    // Update fields if provided
    if (options.ttl) {
      capability.ttl = options.ttl;
    }
    if (options.autoApprove !== undefined) {
      capability.autoApprove = options.autoApprove;
    }
    if (options.requiresReason !== undefined) {
      capability.requiresReason = options.requiresReason;
    }

    // Handle rules
    if (options.clearRules) {
      delete capability.rules;
    } else if (options.allow || options.deny) {
      if (!capability.rules) {
        capability.rules = {};
      }
      if (options.allow) {
        capability.rules.allow = options.allow;
      }
      if (options.deny) {
        capability.rules.deny = options.deny;
      }
    }

    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        capability: name,
        message: `Updated capability "${name}"`
      }));
    } else {
      console.log(`✅ Updated capability "${name}"`);
    }

  } catch (error) {
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: error.message }));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'Unknown error occurred' }));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

export async function capabilityRemoveCommand(
  name: string,
  options: { yes?: boolean; json?: boolean } = {}
): Promise<void> {
  try {
    if (!hasYAMLConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'No config found. Run `janee init` first.' }));
      } else {
        console.error('❌ No config found. Run `janee init` first.');
      }
      process.exit(1);
    }

    const config = loadYAMLConfig();

    // Check if capability exists
    if (!config.capabilities[name]) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: `Capability "${name}" not found` }));
      } else {
        console.error(`❌ Capability "${name}" not found`);
      }
      process.exit(1);
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
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: error.message }));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'Unknown error occurred' }));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

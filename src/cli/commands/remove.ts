import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { cliError, handleCommandError, requireConfig } from '../cli-utils';
import { loadYAMLConfig, saveYAMLConfig } from '../config-yaml';

export async function removeCommand(serviceName: string, options: { yes?: boolean; json?: boolean } = {}): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();

    if (!config.services[serviceName]) {
      cliError(`Service "${serviceName}" not found`, options.json);
    }

    // Check for capabilities using this service
    const dependentCaps = Object.entries(config.capabilities)
      .filter(([_, cap]) => cap.service === serviceName)
      .map(([name, _]) => name);

    if (!options.json && dependentCaps.length > 0) {
      console.log(`⚠️  The following capabilities depend on this service:`);
      dependentCaps.forEach(cap => console.log(`   - ${cap}`));
      console.log();
    }

    // Confirm deletion (skip if --yes flag is set or --json)
    if (!options.yes && !options.json) {
      const rl = readline.createInterface({ input, output });

      const answer = await rl.question(
        `Are you sure you want to remove service "${serviceName}"? This cannot be undone. (y/N): `
      );

      rl.close();

      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Cancelled');
        return;
      }
    }

    // Remove service
    delete config.services[serviceName];

    // Remove dependent capabilities
    dependentCaps.forEach(cap => {
      delete config.capabilities[cap];
    });

    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        service: serviceName,
        dependentCapabilities: dependentCaps,
        message: `Service "${serviceName}" removed successfully`
      }));
    } else {
      console.log(`✅ Service "${serviceName}" removed successfully!`);
      if (dependentCaps.length > 0) {
        console.log(`✅ Removed ${dependentCaps.length} dependent capability(ies)`);
      }
    }

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

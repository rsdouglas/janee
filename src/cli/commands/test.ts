import {
  ServiceTestResult,
  testServiceConnection,
} from '../../core/health';
import { cliError, handleCommandError, requireConfig } from '../cli-utils';
import { loadYAMLConfig } from '../config-yaml';

export interface TestCommandOptions {
  json?: boolean;
  timeout?: string;
}

export async function testCommand(service: string | undefined, options: TestCommandOptions = {}): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();
    const serviceNames = Object.keys(config.services);

    if (serviceNames.length === 0) {
      cliError('No services configured. Run `janee add` first.', options.json);
    }

    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const testOptions = timeout ? { timeout } : {};

    let targets: string[];
    if (service) {
      if (!config.services[service]) {
        cliError(`Unknown service: ${service}. Available: ${serviceNames.join(', ')}`, options.json);
      }
      targets = [service];
    } else {
      targets = serviceNames;
    }

    if (!options.json) {
      console.log('');
      console.log(`  Testing ${targets.length === 1 ? targets[0] : `${targets.length} services`}...`);
      console.log('');
    }

    const results: ServiceTestResult[] = await Promise.all(
      targets.map(name => testServiceConnection(name, config.services[name], testOptions))
    );

    if (options.json) {
      console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
      return;
    }

    for (const r of results) {
      const icon = r.authOk ? '✅' : r.reachable ? '⚠️' : '❌';
      const status = r.authOk
        ? `ok (${r.statusCode}) ${r.latencyMs}ms`
        : r.reachable
          ? `reachable but auth failed (${r.statusCode})`
          : `unreachable`;

      console.log(`  ${icon} ${r.service}  ${status}`);
      console.log(`     GET ${r.testUrl}  [${r.authType}]`);
      if (r.error) {
        console.log(`     ${r.error}`);
      }
      if (r.responseBody) {
        // Show first line of response body for quick diagnostics
        const firstLine = r.responseBody.split('\n')[0].slice(0, 120);
        console.log(`     ${firstLine}`);
      }
      console.log('');
    }

    const failed = results.filter(r => !r.authOk);
    if (failed.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

import {
  ServiceTestResult,
  testServiceConnection,
} from '../../core/health';
import { hasConfig, loadConfig } from '../config-store';

export interface TestCommandOptions {
  json?: boolean;
  timeout?: string;
}

export async function testCommand(service: string | undefined, options: TestCommandOptions = {}): Promise<void> {
  try {
    if (!hasConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No config found' }, null, 2));
      } else {
        console.log('No config found. Run `janee init` first.');
      }
      process.exit(1);
    }

    const config = loadConfig();
    const serviceNames = Object.keys(config.services);

    if (serviceNames.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ error: 'No services configured' }, null, 2));
      } else {
        console.log('No services configured. Run `janee add` first.');
      }
      process.exit(1);
    }

    const timeout = options.timeout ? parseInt(options.timeout) : undefined;
    const testOptions = timeout ? { timeout } : {};

    let targets: string[];
    if (service) {
      if (!config.services[service]) {
        if (options.json) {
          console.log(JSON.stringify({ error: `Unknown service: ${service}` }, null, 2));
        } else {
          console.error(`❌ Unknown service: ${service}`);
          console.error(`Available: ${serviceNames.join(', ')}`);
        }
        process.exit(1);
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

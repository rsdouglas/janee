import { loadYAMLConfig, hasYAMLConfig } from '../config-yaml';

export async function listCommand(options: { json?: boolean } = {}): Promise<void> {
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
    const serviceNames = Object.keys(config.services);
    const capabilityNames = Object.keys(config.capabilities);

    if (options.json) {
      // JSON output - no secrets
      const services = serviceNames.map(name => {
        const service = config.services[name];
        return {
          name,
          baseUrl: service.baseUrl,
          authType: service.auth.type
        };
      });

      const capabilities = capabilityNames.map(name => {
        const cap = config.capabilities[name];
        return {
          name,
          service: cap.service,
          ttl: cap.ttl,
          allowRules: cap.rules?.allow?.length || 0,
          denyRules: cap.rules?.deny?.length || 0
        };
      });

      console.log(JSON.stringify({ services, capabilities }, null, 2));
      return;
    }

    // Human-readable output
    if (serviceNames.length === 0) {
      console.log('No services configured yet.');
      console.log('');
      console.log('Add a service:');
      console.log('  janee add');
      console.log('  or edit ~/.janee/config.yaml');
      return;
    }

    console.log('');
    console.log('Services:');
    for (const name of serviceNames) {
      const service = config.services[name];
      console.log(`  ${name}`);
      console.log(`    URL: ${service.baseUrl}`);
      console.log(`    Auth: ${service.auth.type}`);
    }

    console.log('');
    console.log('Capabilities:');
    if (capabilityNames.length === 0) {
      console.log('  (none configured)');
    } else {
      for (const name of capabilityNames) {
        const cap = config.capabilities[name];
        const rules = cap.rules ? ` [${cap.rules.allow?.length || 0} allow, ${cap.rules.deny?.length || 0} deny]` : '';
        console.log(`  ${name} → ${cap.service} (ttl: ${cap.ttl})${rules}`);
      }
    }
    console.log('');

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

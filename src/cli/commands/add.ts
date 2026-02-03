import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { addService } from '../config';

export async function addCommand(
  service: string,
  options: { url?: string; key?: string; description?: string }
): Promise<void> {
  try {
    const rl = readline.createInterface({ input, output });

    // Get base URL if not provided
    let baseUrl = options.url;
    if (!baseUrl) {
      baseUrl = await rl.question('Base URL (e.g., https://api.stripe.com): ');
      baseUrl = baseUrl.trim();
    }

    if (!baseUrl || !baseUrl.startsWith('http')) {
      console.error('❌ Invalid base URL. Must start with http:// or https://');
      rl.close();
      process.exit(1);
    }

    // Get API key if not provided
    let apiKey = options.key;
    if (!apiKey) {
      apiKey = await rl.question('API Key: ');
      apiKey = apiKey.trim();
    }

    if (!apiKey) {
      console.error('❌ API key is required');
      rl.close();
      process.exit(1);
    }

    // Get description
    let description = options.description;
    if (!description) {
      description = await rl.question('Description (optional): ');
      description = description.trim() || undefined;
    }

    rl.close();

    // Add service
    addService(service, baseUrl, apiKey, description);

    console.log(`✅ Service "${service}" added successfully!`);
    console.log();
    console.log('To use this service:');
    console.log(`  1. Start proxy: janee serve`);
    console.log(`  2. In your agent, use: http://localhost:9119/${service}/...`);
    console.log();
    console.log('Example:');
    console.log(`  curl http://localhost:9119/${service}/v1/endpoint`);

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

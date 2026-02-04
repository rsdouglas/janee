import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { loadYAMLConfig, saveYAMLConfig, hasYAMLConfig } from '../config-yaml';
import type { AuthConfig, ServiceConfig, CapabilityConfig } from '../config-yaml';
import { getService, searchDirectory, ServiceTemplate } from '../../core/directory';
import { validateServiceAccountCredentials, testServiceAccountAuth } from '../../core/service-account';

export async function addCommand(
  serviceName?: string,
  options: { url?: string; key?: string; description?: string } = {}
): Promise<void> {
  try {
    // Check for YAML config
    if (!hasYAMLConfig()) {
      console.error('❌ No config found. Run `janee init` first.');
      process.exit(1);
    }

    const rl = readline.createInterface({ input, output });

    // Service name
    if (!serviceName) {
      serviceName = await rl.question('Service name (or search term): ');
      serviceName = serviceName.trim();
    }

    if (!serviceName) {
      console.error('❌ Service name is required');
      rl.close();
      process.exit(1);
    }

    const config = loadYAMLConfig();

    // Check if service already exists
    if (config.services[serviceName]) {
      console.error(`❌ Service "${serviceName}" already exists`);
      rl.close();
      process.exit(1);
    }

    // Check directory for known service
    let template = getService(serviceName);
    
    // If no exact match, search and suggest
    if (!template) {
      const matches = searchDirectory(serviceName);
      if (matches.length === 1) {
        // Single match - suggest it
        const suggest = matches[0];
        const useIt = await rl.question(`Found "${suggest.name}" (${suggest.description}). Use it? (Y/n): `);
        if (!useIt || useIt.toLowerCase() === 'y' || useIt.toLowerCase() === 'yes') {
          template = suggest;
          serviceName = suggest.name;
        }
      } else if (matches.length > 1) {
        // Multiple matches - list them
        console.log(`\nFound ${matches.length} matching services:`);
        matches.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} - ${m.description}`));
        const choice = await rl.question('Enter number to use, or press Enter to configure manually: ');
        const idx = parseInt(choice) - 1;
        if (idx >= 0 && idx < matches.length) {
          template = matches[idx];
          serviceName = template.name;
        }
      }
    }

    let baseUrl: string;
    let authType: 'bearer' | 'basic' | 'hmac' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account';

    if (template) {
      // Use template from directory
      console.log(`\n📦 Using template for ${template.name}`);
      console.log(`   ${template.description}`);
      if (template.docs) {
        console.log(`   Docs: ${template.docs}`);
      }
      console.log('');
      
      baseUrl = template.baseUrl;
      authType = template.auth.type;
      
      // Handle services with placeholder URLs (like Supabase)
      if (baseUrl.includes('<')) {
        baseUrl = await rl.question(`Base URL (template: ${baseUrl}): `);
        baseUrl = baseUrl.trim();
      }
    } else {
      // Manual configuration
      console.log('\n📝 Manual service configuration');
      
      // Base URL
      baseUrl = options.url || '';
      if (!baseUrl) {
        baseUrl = await rl.question('Base URL: ');
        baseUrl = baseUrl.trim();
      }

      if (!baseUrl || !baseUrl.startsWith('http')) {
        console.error('❌ Invalid base URL. Must start with http:// or https://');
        rl.close();
        process.exit(1);
      }

      // Auth type
      const authTypeInput = await rl.question('Auth type (bearer/basic/hmac/hmac-bybit/hmac-okx/headers/service-account): ');
      authType = authTypeInput.trim().toLowerCase() as typeof authType;

      if (!['bearer', 'basic', 'hmac', 'hmac-bybit', 'hmac-okx', 'headers', 'service-account'].includes(authType)) {
        console.error('❌ Invalid auth type');
        rl.close();
        process.exit(1);
      }
    }

    // Build auth config
    let auth: AuthConfig;

    if (authType === 'bearer') {
      let apiKey = options.key;
      if (!apiKey) {
        apiKey = await rl.question('API key: ');
        apiKey = apiKey.trim();
      }

      if (!apiKey) {
        console.error('❌ API key is required');
        rl.close();
        process.exit(1);
      }

      auth = {
        type: 'bearer',
        key: apiKey
      };
    } else if (authType === 'basic') {
      const username = await rl.question('Username/Account ID: ');
      const password = await rl.question('Password/Auth Token: ');

      if (!username || !password) {
        console.error('❌ Username and password are required for basic auth');
        rl.close();
        process.exit(1);
      }

      // For basic auth, we encode credentials as a special bearer token
      // The MCP server will need to handle this
      const encoded = Buffer.from(`${username.trim()}:${password.trim()}`).toString('base64');
      auth = {
        type: 'bearer',
        key: `Basic ${encoded}`
      };
    } else if (authType === 'hmac' || authType === 'hmac-bybit') {
      const apiKey = await rl.question('API key: ');
      const apiSecret = await rl.question('API secret: ');

      if (!apiKey || !apiSecret) {
        console.error('❌ API key and secret are required for HMAC');
        rl.close();
        process.exit(1);
      }

      auth = {
        type: authType,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim()
      };
    } else if (authType === 'hmac-okx') {
      const apiKey = await rl.question('API key: ');
      const apiSecret = await rl.question('API secret: ');
      const passphrase = await rl.question('Passphrase: ');

      if (!apiKey || !apiSecret || !passphrase) {
        console.error('❌ API key, secret, and passphrase are required for OKX');
        rl.close();
        process.exit(1);
      }

      auth = {
        type: 'hmac-okx',
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        passphrase: passphrase.trim()
      };
    } else if (authType === 'service-account') {
      console.log('\n📋 Service Account Setup');
      console.log('Paste the service account JSON content (end with empty line):');
      console.log('');

      let jsonContent = '';
      while (true) {
        const line = await rl.question('');
        if (!line.trim() && jsonContent) break;
        jsonContent += line + '\n';
      }

      if (!jsonContent.trim()) {
        console.error('❌ Service account JSON is required');
        rl.close();
        process.exit(1);
      }

      // Parse and validate credentials
      let credentials;
      try {
        credentials = JSON.parse(jsonContent);
        validateServiceAccountCredentials(credentials);
      } catch (error) {
        console.error('❌ Invalid service account JSON:', error instanceof Error ? error.message : 'Unknown error');
        rl.close();
        process.exit(1);
      }

      // Ask for scopes
      console.log('\nEnter OAuth scopes (one per line, empty line to finish):');
      const scopes: string[] = [];

      while (true) {
        const scope = await rl.question('  ');
        if (!scope.trim()) break;
        scopes.push(scope.trim());
      }

      if (scopes.length === 0) {
        console.error('❌ At least one scope is required');
        rl.close();
        process.exit(1);
      }

      // Test authentication
      console.log('\n🔐 Testing authentication...');
      try {
        await testServiceAccountAuth(credentials, scopes);
        console.log('✅ Authentication successful');
      } catch (error) {
        console.error('❌ Authentication failed:', error instanceof Error ? error.message : 'Unknown error');
        rl.close();
        process.exit(1);
      }

      auth = {
        type: 'service-account',
        credentials: JSON.stringify(credentials),
        scopes
      };
    } else {
      // headers
      console.log('Enter headers as key:value pairs (empty line to finish):');
      const headers: Record<string, string> = {};

      while (true) {
        const line = await rl.question('  ');
        if (!line.trim()) break;

        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (key && value) {
          headers[key.trim()] = value;
        }
      }

      if (Object.keys(headers).length === 0) {
        console.error('❌ At least one header is required');
        rl.close();
        process.exit(1);
      }

      auth = {
        type: 'headers',
        headers
      };
    }

    // Add service to config
    config.services[serviceName] = {
      baseUrl,
      auth
    };

    saveYAMLConfig(config);

    console.log(`✅ Added service "${serviceName}"`);
    console.log();

    // Ask about capability
    const createCapAnswer = await rl.question('Create a capability for this service? (Y/n): ');
    const createCap = !createCapAnswer || createCapAnswer.toLowerCase() === 'y' || createCapAnswer.toLowerCase() === 'yes';

    if (createCap) {
      const capNameDefault = serviceName;
      const capNameInput = await rl.question(`Capability name (default: ${capNameDefault}): `);
      const capName = capNameInput.trim() || capNameDefault;

      // Check if capability already exists
      if (config.capabilities[capName]) {
        console.error(`❌ Capability "${capName}" already exists`);
        rl.close();
        process.exit(1);
      }

      const ttlInput = await rl.question('TTL (e.g., 1h, 30m): ');
      const ttl = ttlInput.trim() || '1h';

      const autoApproveInput = await rl.question('Auto-approve? (Y/n): ');
      const autoApprove = !autoApproveInput || autoApproveInput.toLowerCase() === 'y' || autoApproveInput.toLowerCase() === 'yes';

      const requiresReasonInput = await rl.question('Requires reason? (y/N): ');
      const requiresReason = requiresReasonInput.toLowerCase() === 'y' || requiresReasonInput.toLowerCase() === 'yes';

      // Add capability
      config.capabilities[capName] = {
        service: serviceName,
        ttl,
        autoApprove,
        requiresReason
      };

      saveYAMLConfig(config);

      console.log(`✅ Added capability "${capName}"`);
      console.log();
    }

    rl.close();

    console.log("Done! Run 'janee serve' to start.");

  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

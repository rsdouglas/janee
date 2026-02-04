import * as readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { select } from '@inquirer/prompts';
import { loadYAMLConfig, saveYAMLConfig, hasYAMLConfig } from '../config-yaml';
import type { AuthConfig, ServiceConfig, CapabilityConfig } from '../config-yaml';
import { getService, searchDirectory, ServiceTemplate } from '../../core/directory';
import { validateServiceAccountCredentials, testServiceAccountAuth } from '../../core/service-account';

function resolveEnvVar(varName: string, label: string): string {
  const value = process.env[varName];
  if (!value) {
    console.error(`❌ Environment variable ${varName} is not set (needed for ${label})`);
    process.exit(1);
  }
  return value.trim();
}

export async function addCommand(
  serviceName?: string,
  options: {
    url?: string;
    key?: string;
    description?: string;
    authType?: string;
    apiSecret?: string;
    passphrase?: string;
    keyFromEnv?: string;
    secretFromEnv?: string;
    passphraseFromEnv?: string;
    credentialsFile?: string;
    scope?: string | string[];
  } = {}
): Promise<void> {
  try {
    // Check for YAML config
    if (!hasYAMLConfig()) {
      console.error('❌ No config found. Run `janee init` first.');
      process.exit(1);
    }

    // Resolve --from-env flags into their direct equivalents early.
    // This way the rest of the code doesn't need to know the source.
    if (options.keyFromEnv) {
      if (options.key) {
        console.error('❌ Cannot use both --key and --key-from-env');
        process.exit(1);
      }
      options.key = resolveEnvVar(options.keyFromEnv, 'API key');
    }
    if (options.secretFromEnv) {
      if (options.apiSecret) {
        console.error('❌ Cannot use both --api-secret and --secret-from-env');
        process.exit(1);
      }
      options.apiSecret = resolveEnvVar(options.secretFromEnv, 'API secret');
    }
    if (options.passphraseFromEnv) {
      if (options.passphrase) {
        console.error('❌ Cannot use both --passphrase and --passphrase-from-env');
        process.exit(1);
      }
      options.passphrase = resolveEnvVar(options.passphraseFromEnv, 'passphrase');
    }

    // Lazy readline — only created when a prompt is actually needed.
    // Prevents the process from hanging on stdin when fully non-interactive.
    let _rl: readline.Interface | null = null;
    let prompted = false;
    function getRL(): readline.Interface {
      if (!_rl) {
        _rl = readline.createInterface({ input, output });
      }
      prompted = true;
      return _rl;
    }
    function closeRL(): void {
      if (_rl) _rl.close();
    }

    // Service name
    if (!serviceName) {
      serviceName = await getRL().question('Service name (or search term): ');
      serviceName = serviceName.trim();
    }

    if (!serviceName) {
      console.error('❌ Service name is required');
      process.exit(1);
    }

    const config = loadYAMLConfig();

    // Check if service already exists
    if (config.services[serviceName]) {
      console.error(`❌ Service "${serviceName}" already exists`);
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
        const useIt = await getRL().question(`Found "${suggest.name}" (${suggest.description}). Use it? (Y/n): `);
        if (!useIt || useIt.toLowerCase() === 'y' || useIt.toLowerCase() === 'yes') {
          template = suggest;
          serviceName = suggest.name;
        }
      } else if (matches.length > 1) {
        // Multiple matches - list them
        console.log(`\nFound ${matches.length} matching services:`);
        matches.forEach((m, i) => console.log(`  ${i + 1}. ${m.name} - ${m.description}`));
        const choice = await getRL().question('Enter number to use, or press Enter to configure manually: ');
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
        baseUrl = options.url || await getRL().question(`Base URL (template: ${baseUrl}): `);
        baseUrl = baseUrl.trim();
      }
    } else {
      // Manual configuration
      console.log('\n📝 Manual service configuration');

      // Base URL
      baseUrl = options.url || '';
      if (!baseUrl) {
        baseUrl = await getRL().question('Base URL: ');
        baseUrl = baseUrl.trim();
      }

      if (!baseUrl || !baseUrl.startsWith('http')) {
        console.error('❌ Invalid base URL. Must start with http:// or https://');
        process.exit(1);
      }

      // Auth type
      if (options.authType) {
        authType = options.authType.toLowerCase() as typeof authType;
      } else {
        authType = await select({
          message: 'Auth type:',
          choices: [
            {
              name: 'bearer — API key in Authorization header',
              value: 'bearer',
              description: 'Single API key sent as "Authorization: Bearer <key>"'
            },
            {
              name: 'service-account — Google-style OAuth2',
              value: 'service-account',
              description: 'Service account JSON for Google Analytics, Sheets, etc.'
            },
            {
              name: 'hmac — Request signing (generic)',
              value: 'hmac',
              description: 'HMAC-based request signing with API key + secret'
            },
            {
              name: 'hmac-bybit — Bybit exchange HMAC',
              value: 'hmac-bybit',
              description: 'Bybit-specific HMAC request signing'
            },
            {
              name: 'hmac-okx — OKX exchange HMAC',
              value: 'hmac-okx',
              description: 'OKX-specific HMAC with passphrase'
            },
            {
              name: 'basic — HTTP Basic Auth',
              value: 'basic',
              description: 'Username + password sent as Basic auth header'
            },
            {
              name: 'headers — Custom headers',
              value: 'headers',
              description: 'Custom key-value headers for non-standard auth'
            }
          ]
        });
      }
    }

    // Build auth config
    let auth: AuthConfig;

    if (authType === 'bearer') {
      let apiKey = options.key;
      if (!apiKey) {
        apiKey = await getRL().question('API key: ');
        apiKey = apiKey.trim();
      }

      if (!apiKey) {
        console.error('❌ API key is required');
        process.exit(1);
      }

      auth = {
        type: 'bearer',
        key: apiKey
      };
    } else if (authType === 'basic') {
      const username = await getRL().question('Username/Account ID: ');
      const password = await getRL().question('Password/Auth Token: ');

      if (!username || !password) {
        console.error('❌ Username and password are required for basic auth');
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
      let apiKey = options.key;
      let apiSecret = options.apiSecret;

      if (!apiKey) {
        apiKey = await getRL().question('API key: ');
      }
      if (!apiSecret) {
        apiSecret = await getRL().question('API secret: ');
      }

      if (!apiKey || !apiSecret) {
        console.error('❌ API key and secret are required for HMAC');
        process.exit(1);
      }

      auth = {
        type: authType,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim()
      };
    } else if (authType === 'hmac-okx') {
      let apiKey = options.key;
      let apiSecret = options.apiSecret;
      let passphrase = options.passphrase;

      if (!apiKey) {
        apiKey = await getRL().question('API key: ');
      }
      if (!apiSecret) {
        apiSecret = await getRL().question('API secret: ');
      }
      if (!passphrase) {
        passphrase = await getRL().question('Passphrase: ');
      }

      if (!apiKey || !apiSecret || !passphrase) {
        console.error('❌ API key, secret, and passphrase are required for OKX');
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

      // Get credentials file path
      let credentialsPath = options.credentialsFile;
      if (!credentialsPath) {
        credentialsPath = await getRL().question('📄 Path to service account JSON file: ');
        credentialsPath = credentialsPath.trim();
      }

      if (!credentialsPath) {
        console.error('❌ Credentials file path is required');
        process.exit(1);
      }

      // Expand ~ to home directory
      if (credentialsPath.startsWith('~/')) {
        credentialsPath = path.join(os.homedir(), credentialsPath.slice(2));
      } else if (credentialsPath === '~') {
        credentialsPath = os.homedir();
      }

      // Read and parse credentials file
      let credentials;
      try {
        const fileContent = fs.readFileSync(credentialsPath, 'utf-8');
        credentials = JSON.parse(fileContent);
        validateServiceAccountCredentials(credentials);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(`❌ File not found: ${credentialsPath}`);
        } else if (error instanceof SyntaxError) {
          console.error('❌ Invalid JSON in credentials file');
        } else {
          console.error('❌ Invalid service account JSON:', error instanceof Error ? error.message : 'Unknown error');
        }
        process.exit(1);
      }

      // Get scopes
      let scopes: string[] = [];
      if (options.scope) {
        // Non-interactive: scope provided via --scope flag(s)
        scopes = Array.isArray(options.scope) ? options.scope : [options.scope];
      } else {
        // Interactive: ask for scopes
        console.log('\nEnter OAuth scopes (one per line, empty line to finish):');

        while (true) {
          const scope = await getRL().question('  ');
          if (!scope.trim()) break;
          scopes.push(scope.trim());
        }
      }

      if (scopes.length === 0) {
        console.error('❌ At least one scope is required');
        process.exit(1);
      }

      // Test authentication
      console.log('\n🔐 Testing authentication...');
      try {
        await testServiceAccountAuth(credentials, scopes);
        console.log('✅ Authentication successful');
      } catch (error) {
        console.error('❌ Authentication failed:', error instanceof Error ? error.message : 'Unknown error');
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
        const line = await getRL().question('  ');
        if (!line.trim()) break;

        const [key, ...valueParts] = line.split(':');
        const value = valueParts.join(':').trim();

        if (key && value) {
          headers[key.trim()] = value;
        }
      }

      if (Object.keys(headers).length === 0) {
        console.error('❌ At least one header is required');
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

    // If readline was never opened, we're fully non-interactive.
    // Auto-create a capability with sensible defaults instead of prompting.
    if (!prompted) {
      if (!config.capabilities[serviceName]) {
        config.capabilities[serviceName] = {
          service: serviceName,
          ttl: '1h',
          autoApprove: true,
        };
        saveYAMLConfig(config);
        console.log(`✅ Added capability "${serviceName}" (1h TTL, auto-approve)`);
        console.log();
      }
      console.log("Done! Run 'janee serve' to start.");
      return;
    }

    // Ask about capability
    const createCapAnswer = await getRL().question('Create a capability for this service? (Y/n): ');
    const createCap = !createCapAnswer || createCapAnswer.toLowerCase() === 'y' || createCapAnswer.toLowerCase() === 'yes';

    if (createCap) {
      const capNameDefault = serviceName;
      const capNameInput = await getRL().question(`Capability name (default: ${capNameDefault}): `);
      const capName = capNameInput.trim() || capNameDefault;

      // Check if capability already exists
      if (config.capabilities[capName]) {
        console.error(`❌ Capability "${capName}" already exists`);
        process.exit(1);
      }

      const ttlInput = await getRL().question('TTL (e.g., 1h, 30m): ');
      const ttl = ttlInput.trim() || '1h';

      const autoApproveInput = await getRL().question('Auto-approve? (Y/n): ');
      const autoApprove = !autoApproveInput || autoApproveInput.toLowerCase() === 'y' || autoApproveInput.toLowerCase() === 'yes';

      const requiresReasonInput = await getRL().question('Requires reason? (y/N): ');
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

    closeRL();

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

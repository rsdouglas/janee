import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  stdin as input,
  stdout as output,
} from 'process';
import * as readline from 'readline/promises';

import { select } from '@inquirer/prompts';

import {
  getService,
  searchDirectory,
} from '../../core/directory';
import {
  testGitHubAppAuth,
  validateGitHubAppCredentials,
} from '../../core/github-app';
import {
  testServiceAccountAuth,
  validateServiceAccountCredentials,
} from '../../core/service-account';
import { handleCommandError, parseEnvMap, resolveEnvVar } from '../cli-utils';
import type {
  AuthConfig,
  CapabilityConfig,
} from '../config-yaml';
import {
  hasYAMLConfig,
  loadYAMLConfig,
  saveYAMLConfig,
} from '../config-yaml';

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
    consumerKey?: string;
    consumerSecret?: string;
    accessToken?: string;
    accessTokenSecret?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    awsRegion?: string;
    awsService?: string;
    testPath?: string;
    exec?: boolean;
    allowCommands?: string[];
    envMap?: string[];
    workDir?: string;
    timeout?: string;
    header?: string[];
    json?: boolean;
  } = {}
): Promise<void> {
  try {
    // Check for YAML config
    if (!hasYAMLConfig()) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'No config found. Run `janee init` first.' }));
      } else {
        console.error('❌ No config found. Run `janee init` first.');
      }
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

    // Exec mode validation (RFC 0001)
    if (options.exec && !options.allowCommands?.length) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: '--exec requires --allow-commands (whitelist of allowed executables)' }));
      } else {
        console.error('❌ --exec requires --allow-commands (whitelist of allowed executables)');
      }
      process.exit(1);
    }
    if (!options.exec && (options.allowCommands || options.envMap || options.workDir || options.timeout)) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: '--allow-commands, --env-map, --work-dir, and --timeout require --exec' }));
      } else {
        console.error('❌ --allow-commands, --env-map, --work-dir, and --timeout require --exec');
      }
      process.exit(1);
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
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'Service name is required' }));
        process.exit(1);
      }
      serviceName = await getRL().question('Service name (or search term): ');
      serviceName = serviceName.trim();
    }

    if (!serviceName) {
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'Service name is required' }));
      } else {
        console.error('❌ Service name is required');
      }
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
    let authType: 'bearer' | 'basic' | 'hmac-mexc' | 'hmac-bybit' | 'hmac-okx' | 'headers' | 'service-account' | 'github-app' | 'oauth1a-twitter' | 'aws-sigv4';

    if (template) {
      // Use template from directory
      if (!options.json) {
        console.log(`\n📦 Using template for ${template.name}`);
        console.log(`   ${template.description}`);
        if (template.docs) {
          console.log(`   Docs: ${template.docs}`);
        }
        console.log('');
      }

      baseUrl = template.baseUrl;
      authType = options.authType
        ? (options.authType.toLowerCase() as typeof authType)
        : template.auth.type;

      // Handle services with placeholder URLs (like Supabase)
      if (baseUrl.includes('<')) {
        baseUrl = options.url || await getRL().question(`Base URL (template: ${baseUrl}): `);
        baseUrl = baseUrl.trim();
      }
    } else {
      // Manual configuration
      if (!options.json) {
        console.log('\n📝 Manual service configuration');
      }

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
              name: 'github-app — GitHub App installation tokens',
              value: 'github-app',
              description: 'GitHub App with PEM key — mints short-lived installation tokens'
            },
            {
              name: 'hmac — Request signing (generic)',
              value: 'hmac-mexc',
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
              name: 'oauth1a-twitter — Twitter/X OAuth 1.0a',
              value: 'oauth1a-twitter',
              description: 'OAuth 1.0a per-request signing for Twitter/X API'
            },
            {
              name: 'aws-sigv4 — AWS Signature V4',
              value: 'aws-sigv4',
              description: 'AWS SigV4 per-request signing (SES, S3, etc.)'
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
    } else if (authType === 'hmac-mexc' || authType === 'hmac-bybit') {
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
    } else if (authType === 'oauth1a-twitter') {
      let consumerKey = options.consumerKey;
      let consumerSecret = options.consumerSecret;
      let accessToken = options.accessToken;
      let accessTokenSecret = options.accessTokenSecret;

      if (!consumerKey) consumerKey = await getRL().question('Consumer API key: ');
      if (!consumerSecret) consumerSecret = await getRL().question('Consumer API secret: ');
      if (!accessToken) accessToken = await getRL().question('Access token: ');
      if (!accessTokenSecret) accessTokenSecret = await getRL().question('Access token secret: ');

      if (!consumerKey || !consumerSecret || !accessToken || !accessTokenSecret) {
        console.error('❌ All four OAuth 1.0a credentials are required for Twitter/X');
        process.exit(1);
      }

      auth = {
        type: 'oauth1a-twitter',
        consumerKey: consumerKey.trim(),
        consumerSecret: consumerSecret.trim(),
        accessToken: accessToken.trim(),
        accessTokenSecret: accessTokenSecret.trim(),
      };
    } else if (authType === 'aws-sigv4') {
      let accessKeyId = options.accessKeyId;
      let secretAccessKey = options.secretAccessKey;
      let awsRegion = options.awsRegion;
      let awsService = options.awsService;

      if (!accessKeyId) accessKeyId = await getRL().question('AWS Access Key ID: ');
      if (!secretAccessKey) secretAccessKey = await getRL().question('AWS Secret Access Key: ');
      if (!awsRegion) awsRegion = await getRL().question('AWS Region (e.g. us-east-1): ');
      if (!awsService) awsService = await getRL().question('AWS Service (e.g. ses, s3): ');

      if (!accessKeyId || !secretAccessKey || !awsRegion || !awsService) {
        console.error('❌ Access key ID, secret, region, and service are required for AWS SigV4');
        process.exit(1);
      }

      auth = {
        type: 'aws-sigv4',
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        region: awsRegion.trim(),
        awsService: awsService.trim(),
      };
    } else if (authType === 'service-account') {
      if (!options.json) console.log('\n📋 Service Account Setup');

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
        if (!options.json) console.log('\nEnter OAuth scopes (one per line, empty line to finish):');

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
      if (!options.json) console.log('\n🔐 Testing authentication...');
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
    } else if (authType === 'github-app') {
      if (!options.json) console.log('\n🔑 GitHub App Setup');

      let appId = (options as any).appId;
      if (!appId) {
        appId = await getRL().question('App ID: ');
        appId = appId.trim();
      }
      if (!appId) {
        console.error('❌ App ID is required');
        process.exit(1);
      }

      let pemPath = (options as any).pemFile;
      if (!pemPath) {
        pemPath = await getRL().question('📄 Path to private key PEM file: ');
        pemPath = pemPath.trim();
      }
      if (!pemPath) {
        console.error('❌ PEM file path is required');
        process.exit(1);
      }
      if (pemPath.startsWith('~/')) {
        pemPath = path.join(os.homedir(), pemPath.slice(2));
      }

      let privateKeyPem: string;
      try {
        privateKeyPem = fs.readFileSync(pemPath, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          console.error(`❌ File not found: ${pemPath}`);
        } else {
          console.error('❌ Could not read PEM file:', error instanceof Error ? error.message : 'Unknown error');
        }
        process.exit(1);
      }

      let installationId = (options as any).installationId;
      if (!installationId) {
        installationId = await getRL().question('Installation ID: ');
        installationId = installationId.trim();
      }
      if (!installationId) {
        console.error('❌ Installation ID is required');
        process.exit(1);
      }

      const ghCreds = { appId, privateKey: privateKeyPem, installationId };
      validateGitHubAppCredentials(ghCreds);

      if (!options.json) console.log('\n🔐 Testing authentication...');
      try {
        await testGitHubAppAuth(ghCreds);
        if (!options.json) console.log('✅ Authentication successful');
      } catch (error) {
        console.error('❌ Authentication failed:', error instanceof Error ? error.message : 'Unknown error');
        process.exit(1);
      }

      auth = {
        type: 'github-app',
        appId,
        privateKey: privateKeyPem,
        installationId,
      };
    } else if (authType === 'headers' && template?.auth.fields.length === 1 && options.key) {
      // Template tells us the header name, --key provides the value
      auth = {
        type: 'headers',
        headers: { [template.auth.fields[0]]: options.key }
      };
    } else if (authType === 'headers' && options.header?.length) {
      // --header flag(s): parse name=value pairs non-interactively
      const headers: Record<string, string> = {};
      for (const pair of options.header) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx === -1) {
          if (options.json) {
            console.log(JSON.stringify({ ok: false, error: `Invalid --header format: "${pair}" (expected name=value)` }));
          } else {
            console.error(`❌ Invalid --header format: "${pair}" (expected name=value)`);
          }
          process.exit(1);
        }
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (!name) {
          if (options.json) {
            console.log(JSON.stringify({ ok: false, error: `Invalid --header format: "${pair}" (empty header name)` }));
          } else {
            console.error(`❌ Invalid --header format: "${pair}" (empty header name)`);
          }
          process.exit(1);
        }
        if (!value) {
          if (options.json) {
            console.log(JSON.stringify({ ok: false, error: `Invalid --header format: "${pair}" (empty value for ${name})` }));
          } else {
            console.error(`❌ Invalid --header format: "${pair}" (empty value for ${name})`);
          }
          process.exit(1);
        }
        headers[name] = value;
      }
      auth = {
        type: 'headers',
        headers
      };
    } else if (authType === 'headers' && options.key && !template) {
      // Single --key with no template: prompt for header name or use a sensible message
      if (options.json) {
        console.log(JSON.stringify({ ok: false, error: 'headers auth type requires --header name=value (not --key). Use: --header "api-key=<value>"' }));
      } else {
        console.error('❌ headers auth type requires --header name=value (not --key).');
        console.error('   Use: --header "api-key=<value>"');
      }
      process.exit(1);
    } else {
      // Interactive headers fallback
      if (!options.json) console.log('Enter headers as key:value pairs (empty line to finish):');
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

    // Resolve test path: CLI flag > template default > prompt
    let testPath = options.testPath;
    if (!testPath && !options.exec) {
      const templateDefault = template?.testPath;
      if (options.json && !prompted) {
        // Non-interactive JSON mode: use template default if available
        testPath = templateDefault;
      } else if (templateDefault) {
        const answer = await getRL().question(`Test endpoint [${templateDefault}]: `);
        testPath = answer.trim() || templateDefault;
      } else {
        const answer = await getRL().question('Test endpoint (auth-required GET path, e.g. /v1/balance): ');
        testPath = answer.trim() || undefined;
      }
    }

    // Add service to config
    config.services[serviceName] = {
      baseUrl,
      auth,
      ...(testPath && { testPath }),
    };

    saveYAMLConfig(config);

    // Auto-create a default capability unless one already exists
    const capCreated = !config.capabilities[serviceName];
    if (capCreated) {
      const capConfig: CapabilityConfig = {
        service: serviceName,
        ttl: '1h',
        autoApprove: true,
      };
      if (options.exec) {
        capConfig.mode = 'exec';
        if (options.allowCommands) capConfig.allowCommands = options.allowCommands;
        if (options.envMap) capConfig.env = parseEnvMap(options.envMap);
        if (options.workDir) capConfig.workDir = options.workDir;
        if (options.timeout) {
          capConfig.timeout = parseInt(options.timeout, 10);
          if (isNaN(capConfig.timeout) || capConfig.timeout <= 0) {
            throw new Error(`Invalid timeout "${options.timeout}"`);
          }
        }
      }
      config.capabilities[serviceName] = capConfig;
      saveYAMLConfig(config);
    }

    if (options.json) {
      const result: any = { ok: true, service: serviceName, message: `Added service "${serviceName}"` };
      if (capCreated) {
        result.capability = serviceName;
        result.message += ` with capability "${serviceName}"`;
      }
      console.log(JSON.stringify(result));
      closeRL();
      return;
    }

    console.log(`✅ Added service "${serviceName}"`);
    if (capCreated) {
      if (options.exec) {
        console.log(`✅ Added exec-mode capability "${serviceName}" (1h TTL, auto-approve)`);
        console.log(`   Allowed commands: ${(options.allowCommands || []).join(', ')}`);
      } else {
        console.log(`✅ Added capability "${serviceName}" (1h TTL, auto-approve)`);
      }
      console.log(`   Customize with: janee cap edit ${serviceName}`);
    } else {
      console.log(`   Existing capability "${serviceName}" unchanged`);
    }
    console.log();
    console.log("Done! Run 'janee serve' to start.");

    closeRL();

  } catch (error) {
    handleCommandError(error, options.json);
  }
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { cliError, handleCommandError, requireConfig, resolveEnvVar } from '../cli-utils';
import {
  loadYAMLConfig,
  saveYAMLConfig,
} from '../config-yaml';

function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  return p;
}

export interface ServiceEditOptions {
  url?: string;
  testPath?: string;
  key?: string;
  apiSecret?: string;
  passphrase?: string;
  pemFile?: string;
  credentialsFile?: string;
  keyFromEnv?: string;
  secretFromEnv?: string;
  passphraseFromEnv?: string;
  header?: string[];
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  json?: boolean;
}

export async function serviceEditCommand(
  name: string,
  options: ServiceEditOptions,
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();
    const service = config.services[name];
    if (!service) return cliError(`Service "${name}" not found`, options.json);

    if (options.keyFromEnv) {
      if (options.key) return cliError('Cannot use both --key and --key-from-env', options.json);
      options.key = resolveEnvVar(options.keyFromEnv, 'API key');
    }
    if (options.secretFromEnv) {
      if (options.apiSecret) return cliError('Cannot use both --api-secret and --secret-from-env', options.json);
      options.apiSecret = resolveEnvVar(options.secretFromEnv, 'API secret');
    }
    if (options.passphraseFromEnv) {
      if (options.passphrase) return cliError('Cannot use both --passphrase and --passphrase-from-env', options.json);
      options.passphrase = resolveEnvVar(options.passphraseFromEnv, 'passphrase');
    }

    const changes: string[] = [];

    if (options.url) {
      service.baseUrl = options.url;
      changes.push(`baseUrl → ${options.url}`);
    }
    if (options.testPath) {
      service.testPath = options.testPath;
      changes.push(`testPath → ${options.testPath}`);
    }

    // Secret rotation — validate against the current auth type
    const auth = service.auth;

    if (options.key) {
      if (auth.type === 'bearer') {
        auth.key = options.key;
        changes.push('bearer key rotated');
      } else if (auth.type.startsWith('hmac')) {
        auth.apiKey = options.key;
        changes.push('HMAC apiKey rotated');
      } else {
        return cliError(`--key is not applicable to auth type "${auth.type}"`, options.json);
      }
    }
    if (options.apiSecret) {
      if (!auth.type.startsWith('hmac')) return cliError(`--api-secret is not applicable to auth type "${auth.type}"`, options.json);
      auth.apiSecret = options.apiSecret;
      changes.push('HMAC apiSecret rotated');
    }
    if (options.passphrase) {
      if (auth.type !== 'hmac-okx') return cliError(`--passphrase is only applicable to hmac-okx auth`, options.json);
      auth.passphrase = options.passphrase;
      changes.push('passphrase rotated');
    }
    if (options.pemFile) {
      if (auth.type !== 'github-app') return cliError(`--pem-file is only applicable to github-app auth`, options.json);
      const pemPath = expandHome(options.pemFile);
      try {
        auth.privateKey = fs.readFileSync(pemPath, 'utf-8');
      } catch {
        return cliError(`Could not read PEM file: ${pemPath}`, options.json);
      }
      changes.push('private key rotated');
    }
    if (options.credentialsFile) {
      if (auth.type !== 'service-account') return cliError(`--credentials-file is only applicable to service-account auth`, options.json);
      const credPath = expandHome(options.credentialsFile);
      try {
        const raw = fs.readFileSync(credPath, 'utf-8');
        JSON.parse(raw); // validate JSON
        auth.credentials = raw;
      } catch {
        return cliError(`Could not read/parse credentials file: ${credPath}`, options.json);
      }
      changes.push('service account credentials rotated');
    }
    if (options.header?.length) {
      if (auth.type !== 'headers') return cliError(`--header is only applicable to headers auth`, options.json);
      if (!auth.headers) auth.headers = {};
      for (const pair of options.header) {
        const eq = pair.indexOf('=');
        if (eq <= 0) return cliError(`Invalid --header format: "${pair}" (expected name=value)`, options.json);
        auth.headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      changes.push('custom headers updated');
    }

    if (options.consumerKey) {
      if (auth.type !== 'oauth1a-twitter') return cliError(`--consumer-key is only applicable to oauth1a-twitter auth`, options.json);
      auth.consumerKey = options.consumerKey;
      changes.push('consumer key rotated');
    }
    if (options.consumerSecret) {
      if (auth.type !== 'oauth1a-twitter') return cliError(`--consumer-secret is only applicable to oauth1a-twitter auth`, options.json);
      auth.consumerSecret = options.consumerSecret;
      changes.push('consumer secret rotated');
    }
    if (options.accessToken) {
      if (auth.type !== 'oauth1a-twitter') return cliError(`--access-token is only applicable to oauth1a-twitter auth`, options.json);
      auth.accessToken = options.accessToken;
      changes.push('access token rotated');
    }
    if (options.accessTokenSecret) {
      if (auth.type !== 'oauth1a-twitter') return cliError(`--access-token-secret is only applicable to oauth1a-twitter auth`, options.json);
      auth.accessTokenSecret = options.accessTokenSecret;
      changes.push('access token secret rotated');
    }

    if (options.accessKeyId) {
      if (auth.type !== 'aws-sigv4') return cliError(`--access-key-id is only applicable to aws-sigv4 auth`, options.json);
      auth.accessKeyId = options.accessKeyId;
      changes.push('AWS access key ID rotated');
    }
    if (options.secretAccessKey) {
      if (auth.type !== 'aws-sigv4') return cliError(`--secret-access-key is only applicable to aws-sigv4 auth`, options.json);
      auth.secretAccessKey = options.secretAccessKey;
      changes.push('AWS secret access key rotated');
    }

    if (changes.length === 0) {
      return cliError('No changes specified. Use --url, --test-path, --key, etc.', options.json);
    }

    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({ ok: true, service: name, changes, message: `Updated service "${name}"` }));
    } else {
      console.log(`✅ Updated service "${name}"`);
      for (const c of changes) console.log(`   ${c}`);
    }
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

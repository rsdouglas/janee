import { cliError, handleCommandError, requireConfig } from '../cli-utils';
import { loadYAMLConfig, saveYAMLConfig } from '../config-yaml';

const VALID_KEYS: Record<string, { type: 'string' | 'number' | 'boolean'; enum?: string[] }> = {
  'server.port': { type: 'number' },
  'server.host': { type: 'string' },
  'server.logBodies': { type: 'boolean' },
  'server.strictDecryption': { type: 'boolean' },
  'server.defaultAccess': { type: 'string', enum: ['open', 'restricted'] },
};

function getNestedValue(obj: any, dotPath: string): unknown {
  const parts = dotPath.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function setNestedValue(obj: any, dotPath: string, value: unknown): void {
  const parts = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

export async function configGetCommand(
  key?: string,
  options: { json?: boolean } = {},
): Promise<void> {
  try {
    requireConfig(options.json);
    const config = loadYAMLConfig();

    if (!key) {
      // Show all gettable keys
      const result: Record<string, unknown> = {};
      for (const k of Object.keys(VALID_KEYS)) {
        result[k] = getNestedValue(config, k);
      }
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const [k, v] of Object.entries(result)) {
          console.log(`  ${k} = ${v ?? '(not set)'}`);
        }
      }
      return;
    }

    if (!VALID_KEYS[key]) {
      return cliError(`Unknown config key "${key}". Valid keys: ${Object.keys(VALID_KEYS).join(', ')}`, options.json);
    }

    const value = getNestedValue(config, key);
    if (options.json) {
      console.log(JSON.stringify({ key, value }));
    } else {
      console.log(`${key} = ${value ?? '(not set)'}`);
    }
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

export async function configSetCommand(
  key: string,
  value: string,
  options: { json?: boolean } = {},
): Promise<void> {
  try {
    requireConfig(options.json);

    const schema = VALID_KEYS[key];
    if (!schema) {
      return cliError(`Unknown config key "${key}". Valid keys: ${Object.keys(VALID_KEYS).join(', ')}`, options.json);
    }

    if (schema.enum && !schema.enum.includes(value)) {
      return cliError(`Invalid value "${value}" for ${key}. Must be one of: ${schema.enum.join(', ')}`, options.json);
    }

    let parsed: unknown;
    if (schema.type === 'boolean') {
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else return cliError(`Invalid boolean "${value}" for ${key}. Use "true" or "false".`, options.json);
    } else if (schema.type === 'number') {
      parsed = parseInt(value, 10);
      if (isNaN(parsed as number)) return cliError(`Invalid number "${value}" for ${key}`, options.json);
    } else {
      parsed = value;
    }

    const config = loadYAMLConfig();
    setNestedValue(config, key, parsed);
    saveYAMLConfig(config);

    if (options.json) {
      console.log(JSON.stringify({ ok: true, key, value: parsed, message: `Set ${key} = ${parsed}` }));
    } else {
      console.log(`✅ Set ${key} = ${parsed}`);
    }
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

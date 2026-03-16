import { hasYAMLConfig } from './config-yaml';

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error occurred';
}

export function cliError(msg: string, json?: boolean): never {
  if (json) {
    console.log(JSON.stringify({ ok: false, error: msg }));
  } else {
    console.error(`❌ ${msg}`);
  }
  process.exit(1);
}

export function handleCommandError(error: unknown, json?: boolean): never {
  const msg = getErrorMessage(error);
  if (json) {
    console.log(JSON.stringify({ ok: false, error: msg }));
  } else {
    console.error('❌ Error:', msg);
  }
  process.exit(1);
}

export function requireConfig(json?: boolean): void {
  if (!hasYAMLConfig()) {
    cliError('No config found. Run `janee init` first.', json);
  }
}

export function resolveEnvVar(varName: string, label: string): string {
  const value = process.env[varName];
  if (!value) {
    throw new Error(`Environment variable ${varName} is not set (needed for ${label})`);
  }
  return value.trim();
}

export function parseEnvMap(mappings: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const mapping of mappings) {
    const eqIdx = mapping.indexOf('=');
    if (eqIdx <= 0) {
      throw new Error(`Invalid env mapping "${mapping}" — expected KEY=value`);
    }
    result[mapping.slice(0, eqIdx).trim()] = mapping.slice(eqIdx + 1).trim();
  }
  return result;
}

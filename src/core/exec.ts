/**
 * CLI Execution for Janee
 *
 * Runs commands with credentials injected as env vars, then scrubs
 * those values from the output so the agent never sees raw secrets.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ExecCapability {
  service: string;
  mode: 'exec';
  allowCommands: string[];
  env: Record<string, string>;
  workDir?: string;
  ttl: string;
  autoApprove?: boolean;
  requiresReason?: boolean;
  timeout?: number;
}

export interface ExecRequest {
  capability: string;
  command: string[];
  stdin?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
  scrubbedStdoutHits?: number;
  scrubbedStderrHits?: number;
}

function countOccurrences(output: string, needle: string): number {
  if (!needle || needle.length < 8) return 0;
  return output.split(needle).length - 1;
}

export interface ExecAuditEvent {
  id: string;
  timestamp: string;
  type: 'cli_execution';
  service: string;
  capability: string;
  command: string[];
  exitCode: number;
  executionTimeMs: number;
  stdout: string;
  stderr: string;
  denied?: boolean;
  denyReason?: string;
  reason?: string;
}

export function validateCommand(
  command: string[],
  allowCommands: string[]
): { allowed: boolean; reason?: string } {
  if (!command || command.length === 0) {
    return { allowed: false, reason: 'Empty command' };
  }

  const executable = path.basename(command[0]);
  if (!allowCommands.includes(executable)) {
    return {
      allowed: false,
      reason: `Command '${executable}' not allowed by capability. Allowed: ${allowCommands.join(', ')}`
    };
  }

  return { allowed: true };
}

export function buildExecEnv(
  envTemplate: Record<string, string>,
  credential: string,
  extraCredentials?: { apiKey?: string; apiSecret?: string; passphrase?: string }
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(envTemplate)) {
    let resolved = value;
    resolved = resolved.replace(/{{credential}}/g, credential);
    if (extraCredentials?.apiKey) {
      resolved = resolved.replace(/{{apiKey}}/g, extraCredentials.apiKey);
    }
    if (extraCredentials?.apiSecret) {
      resolved = resolved.replace(/{{apiSecret}}/g, extraCredentials.apiSecret);
    }
    if (extraCredentials?.passphrase) {
      resolved = resolved.replace(/{{passphrase}}/g, extraCredentials.passphrase);
    }
    env[key] = resolved;
  }

  return env;
}

export function scrubCredentials(
  output: string,
  credential: string,
  extraCredentials?: { apiKey?: string; apiSecret?: string; passphrase?: string }
): string {
  let scrubbed = output;

  if (credential && credential.length >= 8) {
    scrubbed = scrubbed.replaceAll(credential, '[REDACTED]');
  }
  if (extraCredentials?.apiKey && extraCredentials.apiKey.length >= 8) {
    scrubbed = scrubbed.replaceAll(extraCredentials.apiKey, '[REDACTED]');
  }
  if (extraCredentials?.apiSecret && extraCredentials.apiSecret.length >= 8) {
    scrubbed = scrubbed.replaceAll(extraCredentials.apiSecret, '[REDACTED]');
  }
  if (extraCredentials?.passphrase && extraCredentials.passphrase.length >= 8) {
    scrubbed = scrubbed.replaceAll(extraCredentials.passphrase, '[REDACTED]');
  }

  return scrubbed;
}

export function hashPolicyFingerprint(capability: {
  name: string;
  mode?: string;
  allowCommands?: string[];
  workDir?: string;
  timeout?: number;
  env?: Record<string, string>;
}): string {
  const serialized = JSON.stringify({
    name: capability.name,
    mode: capability.mode,
    allowCommands: capability.allowCommands || [],
    workDir: capability.workDir || '',
    timeout: capability.timeout || 30000,
    envKeys: Object.keys(capability.env || {}).sort(),
  });

  let hash = 0;
  for (let i = 0; i < serialized.length; i++) {
    hash = (hash * 31 + serialized.charCodeAt(i)) >>> 0;
  }
  return `policy-${hash.toString(16)}`;
}

/**
 * When running `git` with a GH/GITHUB token in the env, create a temp
 * askpass script so git can authenticate over HTTPS automatically.
 * Returns the temp file path (caller must clean up) or null.
 */
function setupGitAskpass(
  executable: string,
  env: Record<string, string>,
): string | null {
  if (path.basename(executable) !== 'git') return null;

  const tokenVar = env.GH_TOKEN ? 'GH_TOKEN'
    : env.GITHUB_TOKEN ? 'GITHUB_TOKEN'
    : null;
  if (!tokenVar) return null;

  const askpassPath = path.join(
    process.env.TMPDIR || process.env.TMP || '/tmp',
    `janee-askpass-${randomUUID()}.sh`,
  );
  fs.writeFileSync(askpassPath, [
    '#!/bin/sh',
    `case "$1" in`,
    `  Username*|username*) echo "x-access-token" ;;`,
    `  *) echo "\${${tokenVar}}" ;;`,
    'esac',
    '',
  ].join('\n'), { mode: 0o700 });

  return askpassPath;
}

export async function executeCommand(
  command: string[],
  injectedEnv: Record<string, string>,
  options: {
    workDir?: string;
    timeout?: number;
    stdin?: string;
    credential: string;
    extraCredentials?: { apiKey?: string; apiSecret?: string; passphrase?: string };
  }
): Promise<ExecResult> {
  const timeout = options.timeout || 30000;
  const startTime = Date.now();

  const mergedEnv = { ...process.env, ...injectedEnv };
  const askpassFile = setupGitAskpass(command[0], injectedEnv);
  if (askpassFile) {
    mergedEnv.GIT_ASKPASS = askpassFile;
    mergedEnv.GIT_TERMINAL_PROMPT = '0';
  }

  return new Promise((resolve) => {
    const proc = spawn(command[0], command.slice(1), {
      env: mergedEnv,
      cwd: options.workDir || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
    }
    proc.stdin.end();

    const timeoutId = setTimeout(() => {
      proc.kill('SIGKILL');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      if (askpassFile) try { fs.unlinkSync(askpassFile); } catch { /* best effort */ }
      const executionTimeMs = Date.now() - startTime;

      const secrets = [
        options.credential,
        options.extraCredentials?.apiKey,
        options.extraCredentials?.apiSecret,
        options.extraCredentials?.passphrase,
      ].filter((v): v is string => Boolean(v));

      const scrubbedStdoutHits = secrets.reduce((sum, s) => sum + countOccurrences(stdout, s), 0);
      const scrubbedStderrHits = secrets.reduce((sum, s) => sum + countOccurrences(stderr, s), 0);

      resolve({
        stdout: scrubCredentials(stdout, options.credential, options.extraCredentials),
        stderr: scrubCredentials(stderr, options.credential, options.extraCredentials),
        exitCode: code ?? 1,
        executionTimeMs,
        scrubbedStdoutHits,
        scrubbedStderrHits,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      if (askpassFile) try { fs.unlinkSync(askpassFile); } catch { /* best effort */ }
      resolve({
        stdout: '',
        stderr: `Failed to execute command: ${error.message}`,
        exitCode: 127,
        executionTimeMs: Date.now() - startTime,
      });
    });
  });
}

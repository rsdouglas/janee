/**
 * Secure CLI Execution for Janee (RFC 0001)
 * 
 * Executes CLI commands with credentials injected via environment variables.
 * The agent specifies the command to run but never sees the actual credential.
 * Janee's core security property is preserved: agent never sees the key.
 */

import { spawn } from 'child_process';
import path from 'path';
import { randomUUID } from 'crypto';

export interface ExecCapability {
  service: string;
  mode: 'exec';
  allowCommands: string[];  // Whitelist of allowed executables
  env: Record<string, string>;  // Env var mapping, {{credential}} for secret injection
  workDir?: string;
  ttl: string;
  autoApprove?: boolean;
  requiresReason?: boolean;
  timeout?: number;  // Max execution time in ms (default: 30000)
}

export interface ExecRequest {
  capability: string;
  command: string[];  // e.g., ["bird", "tweet", "Hello from Janee!"]
  stdin?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTimeMs: number;
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

/**
 * Validate that a command is allowed by the capability's whitelist
 */
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

  // Check for shell injection patterns in arguments
  const shellMetachars = /[;&|`$(){}\\<>]/;
  for (let i = 1; i < command.length; i++) {
    if (shellMetachars.test(command[i])) {
      return {
        allowed: false,
        reason: `Argument ${i} contains shell metacharacters. Use structured arguments instead of shell syntax.`
      };
    }
  }

  return { allowed: true };
}

/**
 * Build environment variables for command execution.
 * Replaces {{credential}} placeholders with the actual secret.
 * Replaces {{apiKey}} and {{apiSecret}} for HMAC-style auth.
 */
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

/**
 * Scrub credential values from output strings.
 * Prevents accidental credential leakage in stdout/stderr.
 */
export function scrubCredentials(
  output: string,
  credential: string,
  extraCredentials?: { apiKey?: string; apiSecret?: string; passphrase?: string }
): string {
  let scrubbed = output;

  // Only scrub if credential is long enough to be meaningful
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

/**
 * Execute a CLI command with injected credentials.
 * Returns stdout/stderr/exitCode without exposing the credential.
 */
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

  return new Promise((resolve, reject) => {
    const proc = spawn(command[0], command.slice(1), {
      env: {
        ...process.env,  // Inherit base env
        ...injectedEnv,  // Override with injected credentials
        // Safety: prevent credential exfil via common env vars
        HISTFILE: '/dev/null',
        LESSHISTFILE: '/dev/null',
      },
      cwd: options.workDir || '/tmp/janee-exec',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      // Don't use shell — prevents injection
      shell: false,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      const executionTimeMs = Date.now() - startTime;

      // Scrub credentials from output
      const scrubbedStdout = scrubCredentials(
        stdout,
        options.credential,
        options.extraCredentials
      );
      const scrubbedStderr = scrubCredentials(
        stderr,
        options.credential,
        options.extraCredentials
      );

      resolve({
        stdout: scrubbedStdout,
        stderr: scrubbedStderr,
        exitCode: code ?? 1,
        executionTimeMs,
      });
    });

    proc.on('error', (error) => {
      const executionTimeMs = Date.now() - startTime;
      resolve({
        stdout: '',
        stderr: `Failed to execute command: ${error.message}`,
        exitCode: 127,
        executionTimeMs,
      });
    });
  });
}

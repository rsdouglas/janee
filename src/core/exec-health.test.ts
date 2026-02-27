import { describe, it, expect } from 'vitest';
import { checkExecHealth } from './health.js';

describe('checkExecHealth', () => {
  it('reports healthy when binary exists and no env templates', async () => {
    const result = await checkExecHealth('github', 'gh_cli', {
      allowCommands: ['node'],  // node is always available
      env: {},
    }, true);

    expect(result.healthy).toBe(true);
    expect(result.checks.binaryExists).toBe(true);
    expect(result.checks.binaryPath).toBeTruthy();
    expect(result.checks.envResolvable).toBe(true);
    expect(result.service).toBe('github');
    expect(result.capability).toBe('gh_cli');
  });

  it('reports unhealthy when binary does not exist', async () => {
    const result = await checkExecHealth('myservice', 'my_cap', {
      allowCommands: ['nonexistent_binary_xyz_12345'],
      env: {},
    }, true);

    expect(result.healthy).toBe(false);
    expect(result.checks.binaryExists).toBe(false);
    expect(result.error).toContain('nonexistent_binary_xyz_12345');
    expect(result.error).toContain('not found in PATH');
  });

  it('reports unhealthy when credential template unresolvable', async () => {
    const result = await checkExecHealth('github', 'gh_cli', {
      allowCommands: ['node'],
      env: { GITHUB_TOKEN: '{{credential}}' },
    }, false);  // credential NOT available

    expect(result.healthy).toBe(false);
    expect(result.checks.binaryExists).toBe(true);
    expect(result.checks.envResolvable).toBe(false);
    expect(result.checks.unresolvedVars).toContain('credential');
    expect(result.error).toContain('Unresolved template vars');
  });

  it('reports healthy when credential available', async () => {
    const result = await checkExecHealth('github', 'gh_cli', {
      allowCommands: ['node'],
      env: { GITHUB_TOKEN: '{{credential}}' },
    }, true);  // credential IS available

    expect(result.healthy).toBe(true);
    expect(result.checks.envResolvable).toBe(true);
  });

  it('handles empty allowCommands gracefully', async () => {
    const result = await checkExecHealth('svc', 'cap', {
      allowCommands: [],
      env: {},
    }, true);

    expect(result.healthy).toBe(false);
    expect(result.checks.binaryExists).toBe(false);
  });

  it('includes timing information', async () => {
    const result = await checkExecHealth('svc', 'cap', {
      allowCommands: ['node'],
    }, true);

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
    expect(new Date(result.checkedAt).getTime()).toBeGreaterThan(0);
  });
});

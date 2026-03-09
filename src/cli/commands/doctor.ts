import {
  forwardToolCall,
  resetAuthoritySession,
} from '../../core/runner-proxy';

interface CheckResult {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  detail: string;
}

export async function doctorRunnerCommand(
  authorityUrl: string,
  options: { runnerKey?: string; agent?: string; json?: boolean } = {},
): Promise<void> {
  const checks: CheckResult[] = [];
  const url = authorityUrl.replace(/\/$/, '');

  // 1. Authority health endpoint
  try {
    const res = await fetch(`${url}/v1/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const body = await res.json() as any;
      checks.push({ name: 'authority_reachable', status: 'PASS', detail: `${url} responded (mode: ${body.mode || 'unknown'})` });
    } else {
      checks.push({ name: 'authority_reachable', status: 'FAIL', detail: `${url} returned HTTP ${res.status}` });
    }
  } catch (err: any) {
    checks.push({ name: 'authority_reachable', status: 'FAIL', detail: `Cannot reach ${url}: ${err.message}` });
  }

  // 2. Runner key authentication
  const runnerKey = options.runnerKey || process.env.JANEE_RUNNER_KEY;
  if (!runnerKey) {
    checks.push({ name: 'runner_key', status: 'FAIL', detail: 'No runner key provided (use --runner-key or JANEE_RUNNER_KEY)' });
  } else {
    try {
      const res = await fetch(`${url}/v1/exec/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-janee-runner-key': runnerKey,
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 401) {
        checks.push({ name: 'runner_key', status: 'FAIL', detail: 'Runner key rejected by authority (401 Unauthorized)' });
      } else if (res.status === 400) {
        // 400 means auth passed but the request body was invalid — key is good
        checks.push({ name: 'runner_key', status: 'PASS', detail: 'Runner key accepted by authority' });
      } else {
        checks.push({ name: 'runner_key', status: 'PASS', detail: `Runner key accepted (status: ${res.status})` });
      }
    } catch (err: any) {
      checks.push({ name: 'runner_key', status: 'FAIL', detail: `Key check failed: ${err.message}` });
    }
  }

  // 3. MCP tool forwarding (list_services)
  resetAuthoritySession();
  const agentId = options.agent || 'doctor-probe';
  try {
    const result = await forwardToolCall(url, agentId, 'list_services', {});
    const content = (result as any)?.content;
    if (content && Array.isArray(content) && content.length > 0) {
      try {
        const parsed = JSON.parse(content[0].text);
        const count = Array.isArray(parsed) ? parsed.length : 0;
        checks.push({ name: 'tool_forwarding', status: 'PASS', detail: `list_services returned ${count} capability(s)` });
      } catch {
        checks.push({ name: 'tool_forwarding', status: 'PASS', detail: 'list_services responded successfully' });
      }
    } else {
      checks.push({ name: 'tool_forwarding', status: 'WARN', detail: 'list_services returned empty result' });
    }
  } catch (err: any) {
    checks.push({ name: 'tool_forwarding', status: 'FAIL', detail: `Tool forwarding failed: ${err.message}` });
  }

  // 4. Identity parity (whoami)
  try {
    const result = await forwardToolCall(url, agentId, 'whoami', {});
    const content = (result as any)?.content;
    if (content && Array.isArray(content) && content.length > 0) {
      try {
        const parsed = JSON.parse(content[0].text);
        if (parsed.agentId === agentId) {
          checks.push({ name: 'identity_parity', status: 'PASS', detail: `Authority sees agent as "${parsed.agentId}" (matches)` });
        } else {
          checks.push({ name: 'identity_parity', status: 'WARN', detail: `Agent sent as "${agentId}" but authority sees "${parsed.agentId}"` });
        }
      } catch {
        checks.push({ name: 'identity_parity', status: 'WARN', detail: 'Could not parse whoami response' });
      }
    } else {
      checks.push({ name: 'identity_parity', status: 'WARN', detail: 'whoami returned empty result' });
    }
  } catch (err: any) {
    checks.push({ name: 'identity_parity', status: 'FAIL', detail: `whoami forwarding failed: ${err.message}` });
  }

  // 5. explain_access (if agent specified)
  if (options.agent) {
    try {
      const result = await forwardToolCall(url, agentId, 'explain_access', { capability: '__probe__', agent: options.agent });
      const content = (result as any)?.content;
      if (content && Array.isArray(content) && content.length > 0) {
        checks.push({ name: 'explain_access_forwarding', status: 'PASS', detail: 'explain_access tool is available on authority' });
      } else {
        checks.push({ name: 'explain_access_forwarding', status: 'WARN', detail: 'explain_access returned empty' });
      }
    } catch (err: any) {
      checks.push({ name: 'explain_access_forwarding', status: 'WARN', detail: `explain_access not available: ${err.message}` });
    }
  }

  // Output
  if (options.json) {
    const overall = checks.some(c => c.status === 'FAIL') ? 'FAIL'
      : checks.some(c => c.status === 'WARN') ? 'WARN' : 'PASS';
    console.log(JSON.stringify({ overall, checks }, null, 2));
    return;
  }

  const hasPass = checks.filter(c => c.status === 'PASS').length;
  const hasWarn = checks.filter(c => c.status === 'WARN').length;
  const hasFail = checks.filter(c => c.status === 'FAIL').length;
  const overall = hasFail > 0 ? 'FAIL' : hasWarn > 0 ? 'WARN' : 'PASS';

  console.log('');
  console.log(`  Runner → Authority diagnostics (${url})`);
  console.log('');

  for (const c of checks) {
    const icon = c.status === 'PASS' ? '✓' : c.status === 'WARN' ? '⚠' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.detail}`);
  }

  console.log('');
  console.log(`  Overall: ${overall} (${hasPass} pass, ${hasWarn} warn, ${hasFail} fail)`);

  if (hasFail > 0) {
    console.log('');
    console.log('  Remediation:');
    for (const c of checks.filter(c => c.status === 'FAIL')) {
      switch (c.name) {
        case 'authority_reachable':
          console.log(`    → Verify the authority is running and the URL is correct.`);
          break;
        case 'runner_key':
          console.log(`    → Check that --runner-key matches the authority's configured key.`);
          break;
        case 'tool_forwarding':
          console.log(`    → The MCP endpoint may be unavailable. Check authority logs.`);
          break;
        case 'identity_parity':
          console.log(`    → The authority may not be receiving the correct agent identity.`);
          break;
      }
    }
  }
  console.log('');

  if (hasFail > 0) process.exit(1);
}

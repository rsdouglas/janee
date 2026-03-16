import { canAgentAccess } from '../../core/agent-scope';
import { checkRules } from '../../core/rules';
import { handleCommandError, requireConfig } from '../cli-utils';
import { loadYAMLConfig } from '../config-yaml';

interface TraceStep {
  check: string;
  result: 'pass' | 'fail' | 'skip';
  detail: string;
}

export async function diagnoseAccessCommand(
  capabilityName: string,
  options: { agent?: string; method?: string; path?: string; json?: boolean } = {},
): Promise<void> {
  try {
    requireConfig(options.json);

    const config = loadYAMLConfig();
    const agentId = options.agent || undefined;
    const defaultAccess = config.server?.defaultAccess;
    const trace: TraceStep[] = [];

    const cap = config.capabilities[capabilityName];
    if (!cap) {
      trace.push({ check: 'capability_exists', result: 'fail', detail: `Capability "${capabilityName}" not found` });
      outputResult({ agent: agentId ?? null, capability: capabilityName, allowed: false, trace, nextStep: `Run 'janee cap list' to see available capabilities.` }, options.json);
      return;
    }
    trace.push({ check: 'capability_exists', result: 'pass', detail: `Capability "${capabilityName}" exists (service: ${cap.service})` });

    // Mode
    const mode = cap.mode || 'proxy';
    trace.push({ check: 'mode', result: 'pass', detail: `Capability mode: ${mode}` });

    // allowedAgents
    if (cap.allowedAgents && cap.allowedAgents.length > 0) {
      if (!agentId) {
        trace.push({ check: 'allowed_agents', result: 'pass', detail: `No agent ID (admin/CLI) — bypasses allowedAgents` });
      } else if (cap.allowedAgents.includes(agentId)) {
        trace.push({ check: 'allowed_agents', result: 'pass', detail: `Agent "${agentId}" is in allowedAgents [${cap.allowedAgents.join(', ')}]` });
      } else {
        trace.push({ check: 'allowed_agents', result: 'fail', detail: `Agent "${agentId}" is NOT in allowedAgents [${cap.allowedAgents.join(', ')}]` });
      }
    } else {
      trace.push({ check: 'allowed_agents', result: 'skip', detail: `No allowedAgents restriction on this capability` });
    }

    // defaultAccess
    if (agentId && (!cap.allowedAgents || cap.allowedAgents.length === 0)) {
      if (defaultAccess === 'restricted') {
        trace.push({ check: 'default_access', result: 'fail', detail: `defaultAccess is "restricted" and no allowedAgents list — agent blocked` });
      } else {
        trace.push({ check: 'default_access', result: 'pass', detail: `defaultAccess is "${defaultAccess ?? 'open'}" — agent allowed` });
      }
    } else {
      trace.push({ check: 'default_access', result: 'skip', detail: agentId ? `allowedAgents list takes precedence` : `No agent ID (admin/CLI)` });
    }

    // Ownership
    const svc = config.services[cap.service];
    if (agentId && svc?.ownership) {
      if (canAgentAccess(agentId, svc.ownership)) {
        trace.push({ check: 'ownership', result: 'pass', detail: `Agent can access service` });
      } else {
        trace.push({ check: 'ownership', result: 'fail', detail: `Agent cannot access service (ownership restriction)` });
      }
    } else {
      trace.push({ check: 'ownership', result: 'skip', detail: svc?.ownership ? `No agent ID (admin/CLI)` : `No ownership restrictions on service` });
    }

    // Rules
    if (options.method && options.path && mode !== 'exec') {
      const ruleResult = checkRules(cap.rules, options.method, options.path);
      if (ruleResult.allowed) {
        trace.push({ check: 'rules', result: 'pass', detail: `${options.method} ${options.path} is allowed by rules` });
      } else {
        trace.push({ check: 'rules', result: 'fail', detail: ruleResult.reason || `${options.method} ${options.path} is denied by rules` });
      }
    } else if (mode === 'exec') {
      trace.push({ check: 'rules', result: 'skip', detail: `Exec-mode capabilities use allowCommands, not path rules` });
      if (cap.allowCommands) {
        trace.push({ check: 'allow_commands', result: 'skip', detail: `allowCommands: [${cap.allowCommands.join(', ')}]` });
      }
    } else {
      trace.push({ check: 'rules', result: 'skip', detail: `No method/path provided — use --method and --path to test rules` });
    }

    const hasFail = trace.some(t => t.result === 'fail');
    const firstFail = trace.find(t => t.result === 'fail');

    outputResult({
      agent: agentId ?? null,
      capability: capabilityName,
      allowed: !hasFail,
      trace,
      ...(hasFail && firstFail ? { nextStep: firstFail.detail } : {})
    }, options.json);
  } catch (error) {
    handleCommandError(error, options.json);
  }
}

function outputResult(result: any, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const icon = result.allowed ? '✅' : '❌';
  console.log('');
  console.log(`  ${icon} ${result.allowed ? 'ALLOWED' : 'DENIED'}: ${result.capability}`);
  if (result.agent) console.log(`  Agent: ${result.agent}`);
  console.log('');

  for (const step of result.trace) {
    const marker = step.result === 'pass' ? '✓' : step.result === 'fail' ? '✗' : '–';
    console.log(`  ${marker} ${step.check}: ${step.detail}`);
  }

  if (result.nextStep) {
    console.log('');
    console.log(`  → ${result.nextStep}`);
  }
  console.log('');
}

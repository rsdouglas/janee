import {
  canAgentAccess,
  CredentialOwnership,
} from './agent-scope.js';
import { AuditLogger } from './audit.js';
import { ExecResult, validateCommand } from './exec.js';
import { ServiceTestResult, testServiceConnection } from './health.js';
import { checkRules } from './rules.js';
import { SessionManager } from './sessions.js';
import type { APIRequest, APIResponse } from './types.js';

import type { Capability, ServiceConfig } from './mcp-server.js';
import { DenialError } from './types.js';

export interface ToolHandlerContext {
  getCapabilities: () => Capability[];
  getServices: () => Map<string, ServiceConfig>;
  defaultAccess: 'open' | 'restricted' | undefined;
  sessionManager: SessionManager;
  auditLogger: AuditLogger;
  onExecute: (session: any, request: APIRequest) => Promise<APIResponse>;
  onExecCommand?: (session: any, cap: Capability, command: string[], stdin?: string) => Promise<ExecResult>;
  onForwardToolCall?: (toolName: string, args: Record<string, unknown>, agentId?: string) => Promise<unknown>;
  onPersistOwnership?: (serviceName: string, ownership: CredentialOwnership) => void;
  resolveAgent: (extra: any, args: any) => string | undefined;
  clientSessions: Map<string, string>;
  explainAccessDenial: (agentId: string | undefined, cap: Capability, service: ServiceConfig | undefined, defaultAccess: 'open' | 'restricted' | undefined) => { reason: string; detail: string } | null;
  canAccessCapability: (agentId: string | undefined, cap: Capability, service: ServiceConfig | undefined, defaultAccess: 'open' | 'restricted' | undefined) => boolean;
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

function textResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function parseTTL(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(num) * multipliers[unit];
}

// ---------------------------------------------------------------------------
// execute
// ---------------------------------------------------------------------------
export async function handleExecute(
  ctx: ToolHandlerContext,
  args: any,
  extra: any,
): Promise<ToolResult> {
  const { capability, method, path, body, headers, reason } = args || {};
  const capabilities = ctx.getCapabilities();
  const services = ctx.getServices();

  if (!capability) throw new Error('Missing required argument: capability');
  if (!method) throw new Error('Missing required argument: method (GET, POST, PUT, DELETE, etc.)');
  if (!path) throw new Error('Missing required argument: path');

  const cap = capabilities.find(c => c.name === capability);
  if (!cap) {
    throw new DenialError(`Unknown capability: ${capability}`, {
      reasonCode: 'CAPABILITY_NOT_FOUND', capability,
      nextStep: `Run 'janee cap list' to see available capabilities, or add one with 'janee cap add'.`
    });
  }

  if (cap.mode === 'exec') {
    throw new DenialError(
      `Capability "${capability}" is an exec-mode capability. Use the 'janee_exec' tool instead.`,
      { reasonCode: 'MODE_MISMATCH', capability, nextStep: `Use the 'janee_exec' tool for exec-mode capabilities.` },
    );
  }

  if (cap.requiresReason && !reason) {
    throw new DenialError(`Capability "${capability}" requires a reason`, {
      reasonCode: 'REASON_REQUIRED', capability,
      nextStep: `Include a 'reason' argument explaining why you need this access.`
    });
  }

  const ruleCheck = checkRules(cap.rules, method, path);
  if (!ruleCheck.allowed) {
    ctx.auditLogger.logDenied(cap.service, method, path, ruleCheck.reason || 'Request denied by policy', reason);
    throw new DenialError(ruleCheck.reason || 'Request denied by policy', {
      reasonCode: 'RULE_DENY', capability,
      agentId: ctx.resolveAgent(extra, args),
      evaluatedPolicy: `rules for ${method} ${path}`,
      nextStep: `Check capability rules with 'janee cap list --json' — the path/method may be explicitly denied.`,
    });
  }

  const executeAgentId = ctx.resolveAgent(extra, args);
  const executeSvc = services.get(cap.service);
  if (!ctx.canAccessCapability(executeAgentId, cap, executeSvc, ctx.defaultAccess)) {
    const denialDetail = ctx.explainAccessDenial(executeAgentId, cap, executeSvc, ctx.defaultAccess);
    ctx.auditLogger.logDenied(cap.service, method, path, 'Agent does not have access to this capability', reason);
    throw new DenialError(
      `Access denied: capability "${capability}" is not accessible to this agent`,
      {
        reasonCode: denialDetail?.reason as any || 'AGENT_NOT_ALLOWED',
        capability, agentId: executeAgentId,
        evaluatedPolicy: denialDetail?.detail,
        nextStep: denialDetail?.reason === 'AGENT_NOT_ALLOWED'
          ? `Add this agent to allowedAgents: 'janee cap edit ${capability} --allowed-agents ${executeAgentId}'`
          : denialDetail?.reason === 'DEFAULT_ACCESS_RESTRICTED'
            ? `Either add allowedAgents to the capability or change defaultAccess to 'open'.`
            : `Check service ownership settings for the backing service.`,
      },
    );
  }

  const ttlSeconds = parseTTL(cap.ttl);
  const session = ctx.sessionManager.createSession(cap.name, cap.service, ttlSeconds, { agentId: executeAgentId, reason });

  const apiReq: APIRequest = { service: cap.service, path, method, headers: headers || {}, body };
  const response = await ctx.onExecute(session, apiReq);

  return textResult({ status: response.statusCode, body: response.body });
}

// ---------------------------------------------------------------------------
// janee_exec
// ---------------------------------------------------------------------------
export async function handleExec(
  ctx: ToolHandlerContext,
  args: any,
  extra: any,
): Promise<ToolResult> {
  if (!ctx.onExecCommand) {
    throw new Error('CLI execution not supported in this configuration');
  }

  const {
    capability: execCapName,
    command: rawExecCommand,
    cwd: execCwd,
    stdin: execStdin,
    reason: execReason,
  } = args || {};
  const capabilities = ctx.getCapabilities();
  const services = ctx.getServices();

  if (!execCapName) throw new Error('Missing required argument: capability');
  if (!rawExecCommand || (Array.isArray(rawExecCommand) && rawExecCommand.length === 0) || (typeof rawExecCommand === 'string' && rawExecCommand.trim() === '')) {
    throw new Error('Missing required argument: command');
  }

  const execCommand: string[] = Array.isArray(rawExecCommand)
    ? rawExecCommand
    : typeof rawExecCommand === 'string'
      ? rawExecCommand.trim().split(/\s+/)
      : [];

  let execCap: Capability;
  let execSession: any;

  if (ctx.onForwardToolCall) {
    execCap = { name: execCapName, service: '', ttl: '1h', mode: 'exec', workDir: execCwd } as Capability;
    execSession = { agentId: ctx.resolveAgent(extra, args) };
  } else {
    const foundCap = capabilities.find(c => c.name === execCapName);
    if (!foundCap) {
      throw new DenialError(`Unknown capability: ${execCapName}`, {
        reasonCode: 'CAPABILITY_NOT_FOUND', capability: execCapName,
        nextStep: `Run 'janee cap list' to see available capabilities, or add one with 'janee cap add'.`
      });
    }
    execCap = execCwd ? { ...foundCap, workDir: execCwd } : foundCap;

    if (execCap.mode !== 'exec') {
      throw new DenialError(
        `Capability "${execCapName}" is not an exec-mode capability. Use the 'execute' tool for API proxy capabilities.`,
        { reasonCode: 'MODE_MISMATCH', capability: execCapName, nextStep: `Use the 'execute' tool for proxy-mode capabilities.` },
      );
    }

    const execAgentId = ctx.resolveAgent(extra, args);
    const execSvc = services.get(execCap.service);
    if (!ctx.canAccessCapability(execAgentId, execCap, execSvc, ctx.defaultAccess)) {
      const execDenialDetail = ctx.explainAccessDenial(execAgentId, execCap, execSvc, ctx.defaultAccess);
      ctx.auditLogger.logDenied(execCap.service, 'EXEC', execCommand.join(' '), 'Agent does not have access to this capability', execReason);
      throw new DenialError(
        `Access denied: capability "${execCapName}" is not accessible to this agent`,
        {
          reasonCode: execDenialDetail?.reason as any || 'AGENT_NOT_ALLOWED',
          capability: execCapName, agentId: execAgentId,
          evaluatedPolicy: execDenialDetail?.detail,
          nextStep: execDenialDetail?.reason === 'AGENT_NOT_ALLOWED'
            ? `Add this agent to allowedAgents: 'janee cap edit ${execCapName} --allowed-agents ${execAgentId}'`
            : execDenialDetail?.reason === 'DEFAULT_ACCESS_RESTRICTED'
              ? `Either add allowedAgents to the capability or change defaultAccess to 'open'.`
              : `Check service ownership settings for the backing service.`,
        },
      );
    }

    if (execCap.requiresReason && !execReason) {
      throw new DenialError(`Capability "${execCapName}" requires a reason`, {
        reasonCode: 'REASON_REQUIRED', capability: execCapName,
        nextStep: `Include a 'reason' argument explaining why you need this access.`
      });
    }

    const cmdValidation = validateCommand(execCommand, execCap.allowCommands || []);
    if (!cmdValidation.allowed) {
      ctx.auditLogger.logDenied(execCap.service, 'EXEC', execCommand.join(' '), cmdValidation.reason || 'Command not allowed', execReason);
      throw new DenialError(cmdValidation.reason || 'Command not allowed', {
        reasonCode: 'COMMAND_NOT_ALLOWED', capability: execCapName, agentId: execAgentId,
        evaluatedPolicy: `allowCommands: [${(execCap.allowCommands || []).join(', ')}]`,
        nextStep: `Update allowed commands: 'janee cap edit ${execCapName} --allow-commands "new-pattern"'`,
      });
    }

    const execTtlSeconds = parseTTL(execCap.ttl);
    execSession = ctx.sessionManager.createSession(execCap.name, execCap.service, execTtlSeconds, { reason: execReason });
  }

  const execResult = await ctx.onExecCommand(execSession, execCap, execCommand, execStdin);

  ctx.auditLogger.log(
    { service: execCap.service, path: execCommand.join(' '), method: 'EXEC', headers: { 'x-janee-reason': execReason || '' } },
    { statusCode: execResult.exitCode === 0 ? 200 : 500, headers: {}, body: execResult.stdout },
    execResult.executionTimeMs,
  );

  return textResult({
    exitCode: execResult.exitCode, stdout: execResult.stdout,
    stderr: execResult.stderr, executionTimeMs: execResult.executionTimeMs,
    executionTarget: 'runner',
  });
}

// ---------------------------------------------------------------------------
// manage_credential
// ---------------------------------------------------------------------------
export async function handleManageCredential(
  ctx: ToolHandlerContext,
  args: any,
  extra: any,
): Promise<ToolResult> {
  const { action: credAction, service: credService, targetAgentId: credTarget } = args || {};
  const credAgentId = ctx.resolveAgent(extra, args);
  const services = ctx.getServices();

  if (!credService) throw new Error('Missing required argument: service');

  const svc = services.get(credService);
  if (!svc) throw new Error(`Unknown service: ${credService}`);

  if (credAction === 'view') {
    return textResult({
      service: credService,
      ownership: svc.ownership || { accessPolicy: 'all-agents', note: 'No ownership metadata (legacy credential)' },
      yourAccess: canAgentAccess(credAgentId, svc.ownership),
    });
  }

  if (!credAgentId) throw new Error('agentId is required for grant/revoke actions');
  if (!svc.ownership) throw new Error('Cannot manage access for legacy credentials without ownership metadata. Re-add the service to enable scoping.');
  if (svc.ownership.createdBy !== credAgentId) throw new Error('Only the credential owner can grant or revoke access');

  if (credAction === 'grant') {
    if (!credTarget) throw new Error('targetAgentId is required for grant action');
    const { grantAccess } = await import('./agent-scope.js');
    svc.ownership = grantAccess(svc.ownership, credTarget);
    if (ctx.onPersistOwnership) ctx.onPersistOwnership(credService, svc.ownership);
    return textResult({ success: true, message: `Granted access to ${credTarget}`, ownership: svc.ownership, persisted: !!ctx.onPersistOwnership });
  }

  if (credAction === 'revoke') {
    if (!credTarget) throw new Error('targetAgentId is required for revoke action');
    const { revokeAccess } = await import('./agent-scope.js');
    svc.ownership = revokeAccess(svc.ownership, credTarget);
    if (ctx.onPersistOwnership) ctx.onPersistOwnership(credService, svc.ownership);
    return textResult({ success: true, message: `Revoked access from ${credTarget}`, ownership: svc.ownership, persisted: !!ctx.onPersistOwnership });
  }

  throw new Error(`Unknown action: ${credAction}. Use 'view', 'grant', or 'revoke'.`);
}

// ---------------------------------------------------------------------------
// test_service
// ---------------------------------------------------------------------------
export async function handleTestService(
  ctx: ToolHandlerContext,
  args: any,
): Promise<ToolResult> {
  const { service: testSvcName, timeout: testTimeout } = (args || {}) as { service?: string; timeout?: number };
  const services = ctx.getServices();
  const testOpts = testTimeout ? { timeout: testTimeout } : {};

  let targets: [string, ServiceConfig][];
  if (testSvcName) {
    const svc = services.get(testSvcName);
    if (!svc) throw new Error(`Unknown service: ${testSvcName}. Use list_services to see available services.`);
    targets = [[testSvcName, svc]];
  } else {
    targets = Array.from(services.entries());
  }

  if (targets.length === 0) throw new Error('No services configured');

  const results: ServiceTestResult[] = await Promise.all(
    targets.map(([name, config]) => testServiceConnection(name, config, testOpts)),
  );

  return textResult(results.length === 1 ? results[0] : results);
}

// ---------------------------------------------------------------------------
// explain_access
// ---------------------------------------------------------------------------
export function handleExplainAccess(
  ctx: ToolHandlerContext,
  args: any,
  extra: any,
): ToolResult {
  const { agent: explainAgent, capability: explainCapName, method: explainMethod, path: explainPath } = args || {};
  const targetAgentId = explainAgent || ctx.resolveAgent(extra, args);
  const capabilities = ctx.getCapabilities();
  const services = ctx.getServices();

  interface TraceStep { check: string; result: 'pass' | 'fail' | 'skip'; detail: string }
  const trace: TraceStep[] = [];

  const explainCap = capabilities.find(c => c.name === explainCapName);
  if (!explainCap) {
    trace.push({ check: 'capability_exists', result: 'fail', detail: `Capability "${explainCapName}" not found` });
    return textResult({
      agent: targetAgentId ?? null, capability: explainCapName, allowed: false, trace,
      nextStep: `Run 'janee cap list' to see available capabilities.`
    });
  }
  trace.push({ check: 'capability_exists', result: 'pass', detail: `Capability "${explainCapName}" exists (service: ${explainCap.service})` });

  if (explainMethod && explainCap.mode === 'exec') {
    trace.push({ check: 'mode', result: 'fail', detail: `Capability is exec-mode but method/path were provided (use janee_exec)` });
  } else {
    trace.push({ check: 'mode', result: 'pass', detail: `Capability mode: ${explainCap.mode || 'proxy'}` });
  }

  if (explainCap.allowedAgents && explainCap.allowedAgents.length > 0) {
    if (!targetAgentId) {
      trace.push({ check: 'allowed_agents', result: 'pass', detail: `No agent ID (admin/CLI) — bypasses allowedAgents` });
    } else if (explainCap.allowedAgents.includes(targetAgentId)) {
      trace.push({ check: 'allowed_agents', result: 'pass', detail: `Agent "${targetAgentId}" is in allowedAgents [${explainCap.allowedAgents.join(', ')}]` });
    } else {
      trace.push({ check: 'allowed_agents', result: 'fail', detail: `Agent "${targetAgentId}" is NOT in allowedAgents [${explainCap.allowedAgents.join(', ')}]` });
    }
  } else {
    trace.push({ check: 'allowed_agents', result: 'skip', detail: `No allowedAgents restriction on this capability` });
  }

  if (targetAgentId && (!explainCap.allowedAgents || explainCap.allowedAgents.length === 0)) {
    const effectiveAccess = explainCap.access ?? ctx.defaultAccess;
    const source = explainCap.access ? `capability access` : `global defaultAccess`;
    if (effectiveAccess === 'restricted') {
      trace.push({ check: 'default_access', result: 'fail', detail: `${source} is "restricted" and no allowedAgents list — agent blocked` });
    } else {
      trace.push({ check: 'default_access', result: 'pass', detail: `${source} is "${effectiveAccess ?? 'open'}" — agent allowed` });
    }
  } else {
    trace.push({ check: 'default_access', result: 'skip', detail: targetAgentId ? `allowedAgents list takes precedence` : `No agent ID (admin/CLI)` });
  }

  const explainSvc = services.get(explainCap.service);
  if (targetAgentId && explainSvc?.ownership) {
    if (canAgentAccess(targetAgentId, explainSvc.ownership)) {
      trace.push({ check: 'ownership', result: 'pass', detail: `Agent can access service (ownership: ${JSON.stringify(explainSvc.ownership)})` });
    } else {
      trace.push({ check: 'ownership', result: 'fail', detail: `Agent cannot access service (ownership: ${JSON.stringify(explainSvc.ownership)})` });
    }
  } else {
    trace.push({ check: 'ownership', result: 'skip', detail: explainSvc?.ownership ? `No agent ID (admin/CLI)` : `No ownership restrictions on service` });
  }

  if (explainMethod && explainPath && explainCap.mode !== 'exec') {
    const ruleResult = checkRules(explainCap.rules, explainMethod, explainPath);
    if (ruleResult.allowed) {
      trace.push({ check: 'rules', result: 'pass', detail: `${explainMethod} ${explainPath} is allowed by rules` });
    } else {
      trace.push({ check: 'rules', result: 'fail', detail: ruleResult.reason || `${explainMethod} ${explainPath} is denied by rules` });
    }
  } else if (explainCap.mode === 'exec') {
    trace.push({ check: 'rules', result: 'skip', detail: `Exec-mode capabilities use allowCommands, not path rules` });
  } else {
    trace.push({ check: 'rules', result: 'skip', detail: `No method/path provided for rules evaluation` });
  }

  if (explainCap.mode === 'exec') {
    trace.push({ check: 'allow_commands', result: 'skip', detail: `allowCommands: [${(explainCap.allowCommands || []).join(', ')}] — provide a specific command to validate` });
  }

  const hasFail = trace.some(t => t.result === 'fail');
  const firstFail = trace.find(t => t.result === 'fail');

  return textResult({
    agent: targetAgentId ?? null, capability: explainCapName, allowed: !hasFail, trace,
    ...(hasFail && firstFail ? { nextStep: firstFail.detail } : {})
  });
}

// ---------------------------------------------------------------------------
// whoami
// ---------------------------------------------------------------------------
export function handleWhoami(
  ctx: ToolHandlerContext,
  args: any,
  extra: any,
): ToolResult {
  const whoamiAgentId = ctx.resolveAgent(extra, args);
  const capabilities = ctx.getCapabilities();
  const services = ctx.getServices();

  const accessibleCaps = capabilities
    .filter(cap => ctx.canAccessCapability(whoamiAgentId, cap, services.get(cap.service), ctx.defaultAccess))
    .map(cap => cap.name);

  const deniedCaps = capabilities
    .filter(cap => !ctx.canAccessCapability(whoamiAgentId, cap, services.get(cap.service), ctx.defaultAccess))
    .map(cap => cap.name);

  return textResult({
    agentId: whoamiAgentId ?? null,
    identitySource: whoamiAgentId
      ? ((extra?.sessionId && ctx.clientSessions.has(extra.sessionId)) || ctx.clientSessions.has('__default__')
        ? 'transport (clientInfo.name)'
        : 'client-asserted (untrusted)')
      : 'none',
    defaultAccessPolicy: ctx.defaultAccess ?? 'open',
    capabilities: { accessible: accessibleCaps, denied: deniedCaps },
  });
}

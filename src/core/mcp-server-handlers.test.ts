/**
 * Integration tests for MCP Server agent-scoped credential handlers.
 * Tests actual tool call behavior through Server + Client over InMemoryTransport.
 */

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  agentCreatedOwnership,
  cliCreatedOwnership,
  CredentialOwnership,
} from './agent-scope';
import { AuditLogger } from './audit';
import {
  Capability,
  captureClientInfo,
  createMCPServer,
  ServiceConfig,
} from './mcp-server';
import { SessionManager } from './sessions';

// Helper to create a connected client+server pair
async function createTestPair(overrides: {
  clientName?: string;
  capabilities?: Capability[];
  services?: Map<string, ServiceConfig>;
  defaultAccess?: 'open' | 'restricted';
  onPersistOwnership?: (service: string, ownership: CredentialOwnership) => void;
  onForwardToolCall?: (toolName: string, args: Record<string, unknown>, agentId?: string) => Promise<unknown>;
  onExecCommand?: (session: any, cap: Capability, cmd: string[], stdin?: string) => Promise<any>;
  onDoctorRunner?: (agentId?: string) => Promise<any>;
} = {}) {
  const capabilities = overrides.capabilities ?? [{
    name: 'test-cap',
    service: 'test-service',
    ttl: '1h',
    autoApprove: true
  }];

  const services = overrides.services ?? new Map<string, ServiceConfig>([
    ['test-service', {
      baseUrl: 'https://api.test.com',
      auth: { type: 'bearer', key: 'test-key' }
    }]
  ]);

  const { server, clientSessions } = createMCPServer({
    capabilities,
    services,
    sessionManager: new SessionManager(),
    auditLogger: { log: vi.fn(), logDenied: vi.fn() } as unknown as AuditLogger,
    defaultAccess: overrides.defaultAccess,
    onExecute: vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}'
    }),
    onExecCommand: overrides.onExecCommand,
    onPersistOwnership: overrides.onPersistOwnership,
    onForwardToolCall: overrides.onForwardToolCall,
    onDoctorRunner: overrides.onDoctorRunner,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({
    name: overrides.clientName || 'test-client',
    version: '1.0.0'
  });

  // Connect server first, then wrap transport, then connect client.
  // This ensures captureClientInfo intercepts the initialize handshake.
  await server.connect(serverTransport);
  captureClientInfo(serverTransport, clientSessions);
  await client.connect(clientTransport);

  return { client, server, clientTransport, serverTransport, clientSessions };
}

function extractText(result: any): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

function extractJSON(result: any): any {
  return JSON.parse(extractText(result));
}

describe('MCP Handler Integration — Agent-Scoped Credentials', () => {
  describe('list_services', () => {
    it('should list all services when no ownership is set (legacy behavior)', async () => {
      const { client } = await createTestPair();

      const result = await client.callTool({ name: 'list_services', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('test-cap');
      expect(parsed[0].service).toBe('test-service');
    });

    it('should filter agent-owned services from other agents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['shared-service', {
          baseUrl: 'https://api.shared.com',
          auth: { type: 'bearer', key: 'key1' },
        }],
        ['agent-a-service', {
          baseUrl: 'https://api.a.com',
          auth: { type: 'bearer', key: 'key2' },
          ownership: agentCreatedOwnership('agent-a'),
        }],
        ['agent-b-service', {
          baseUrl: 'https://api.b.com',
          auth: { type: 'bearer', key: 'key3' },
          ownership: agentCreatedOwnership('agent-b'),
        }],
      ]);

      const capabilities: Capability[] = [
        { name: 'shared-cap', service: 'shared-service', ttl: '1h', autoApprove: true },
        { name: 'cap-a', service: 'agent-a-service', ttl: '1h', autoApprove: true },
        { name: 'cap-b', service: 'agent-b-service', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({ clientName: 'agent-a', services, capabilities });

      const result = await client.callTool({
        name: 'list_services',
        arguments: {}
      });
      const parsed = extractJSON(result);

      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('shared-cap');
      expect(names).toContain('cap-a');
      expect(names).toContain('cap-b');

      const accessible = (name: string) => parsed.find((s: any) => s.name === name)?.accessible;
      expect(accessible('shared-cap')).toBe(true);
      expect(accessible('cap-a')).toBe(true);
      expect(accessible('cap-b')).toBe(false);
    });

    it('should show CLI-created services to all agents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['cli-service', {
          baseUrl: 'https://api.cli.com',
          auth: { type: 'bearer', key: 'key1' },
          ownership: cliCreatedOwnership(),
        }],
      ]);

      const capabilities: Capability[] = [
        { name: 'cli-cap', service: 'cli-service', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({ clientName: 'random-agent', services, capabilities });

      const result = await client.callTool({
        name: 'list_services',
        arguments: {}
      });
      const parsed = extractJSON(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('cli-cap');
    });
  });

  describe('execute — agent access control', () => {
    it('should deny execution when agent lacks access to the service', async () => {
      const services = new Map<string, ServiceConfig>([
        ['protected-service', {
          baseUrl: 'https://api.protected.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('owner-agent'),
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'protected-cap',
        service: 'protected-service',
        ttl: '1h',
        autoApprove: true,
      }];

      const { client } = await createTestPair({ clientName: 'intruder-agent', services, capabilities });

      const result = await client.callTool({
        name: 'execute',
        arguments: {
          capability: 'protected-cap',
          method: 'GET',
          path: '/data',
        }
      });

      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.error).toContain('Access denied');
    });

    it('should allow execution when agent owns the service', async () => {
      const services = new Map<string, ServiceConfig>([
        ['my-service', {
          baseUrl: 'https://api.mine.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('my-agent'),
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'my-cap',
        service: 'my-service',
        ttl: '1h',
        autoApprove: true,
      }];

      const { client } = await createTestPair({ clientName: 'my-agent', services, capabilities });

      const result = await client.callTool({
        name: 'execute',
        arguments: {
          capability: 'my-cap',
          method: 'GET',
          path: '/data',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.status).toBe(200);
    });

    it('should allow any agent to execute when no ownership is set (legacy)', async () => {
      const services = new Map<string, ServiceConfig>([
        ['legacy-service', {
          baseUrl: 'https://api.legacy.com',
          auth: { type: 'bearer', key: 'key' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'legacy-cap',
        service: 'legacy-service',
        ttl: '1h',
        autoApprove: true,
      }];

      const { client } = await createTestPair({ clientName: 'random-agent', services, capabilities });

      const result = await client.callTool({
        name: 'execute',
        arguments: {
          capability: 'legacy-cap',
          method: 'GET',
          path: '/open',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.status).toBe(200);
    });
  });

  describe('manage_credential — owner-only operations', () => {
    it('should deny non-owner grant attempts', async () => {
      const services = new Map<string, ServiceConfig>([
        ['owned-service', {
          baseUrl: 'https://api.owned.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('real-owner'),
        }],
      ]);

      const { client } = await createTestPair({ clientName: 'not-the-owner', services });

      const result = await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'grant',
          service: 'owned-service',
          targetAgentId: 'some-friend',
        }
      });

      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.error).toContain('Only the credential owner');
    });

    it('should allow owner to grant access', async () => {
      const persistFn = vi.fn();
      const services = new Map<string, ServiceConfig>([
        ['owned-service', {
          baseUrl: 'https://api.owned.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('real-owner'),
        }],
      ]);

      const { client } = await createTestPair({
        clientName: 'real-owner',
        services,
        onPersistOwnership: persistFn,
      });

      const result = await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'grant',
          service: 'owned-service',
          targetAgentId: 'friend-agent',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain('Granted access to friend-agent');
    });

    it('should persist ownership changes when callback is provided', async () => {
      const persistFn = vi.fn();
      const services = new Map<string, ServiceConfig>([
        ['persist-service', {
          baseUrl: 'https://api.persist.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('owner'),
        }],
      ]);

      const { client } = await createTestPair({
        clientName: 'owner',
        services,
        onPersistOwnership: persistFn,
      });

      await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'grant',
          service: 'persist-service',
          targetAgentId: 'new-agent',
        }
      });

      expect(persistFn).toHaveBeenCalledWith(
        'persist-service',
        expect.objectContaining({
          sharedWith: expect.arrayContaining(['new-agent']),
        })
      );
    });

    it('should allow owner to revoke access', async () => {
      const persistFn = vi.fn();
      const services = new Map<string, ServiceConfig>([
        ['revoke-service', {
          baseUrl: 'https://api.revoke.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: {
            ...agentCreatedOwnership('owner'),
            allowedAgents: ['grantee'],
          },
        }],
      ]);

      const { client } = await createTestPair({
        clientName: 'owner',
        services,
        onPersistOwnership: persistFn,
      });

      const result = await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'revoke',
          service: 'revoke-service',
          targetAgentId: 'grantee',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.success).toBe(true);
      expect(parsed.message).toContain('Revoked access from grantee');
    });

    it('should show ownership info with view action', async () => {
      const services = new Map<string, ServiceConfig>([
        ['view-service', {
          baseUrl: 'https://api.view.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('view-owner'),
        }],
      ]);

      const { client } = await createTestPair({ clientName: 'view-owner', services });

      const result = await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'view',
          service: 'view-service',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.service).toBe('view-service');
      expect(parsed.ownership.createdBy).toBe('view-owner');
      expect(parsed.yourAccess).toBe(true);
    });

    it('should show access denied in view for non-accessible services', async () => {
      const services = new Map<string, ServiceConfig>([
        ['private-service', {
          baseUrl: 'https://api.private.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: agentCreatedOwnership('private-owner'),
        }],
      ]);

      const { client } = await createTestPair({ clientName: 'outsider', services });

      const result = await client.callTool({
        name: 'manage_credential',
        arguments: {
          action: 'view',
          service: 'private-service',
        }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.yourAccess).toBe(false);
    });
  });

  describe('grant → execute flow (end-to-end)', () => {
    it('should allow execution after being granted access', async () => {
      let currentOwnership: CredentialOwnership = agentCreatedOwnership('owner');

      const makeServices = () => new Map<string, ServiceConfig>([
        ['e2e-service', {
          baseUrl: 'https://api.e2e.com',
          auth: { type: 'bearer', key: 'secret' },
          ownership: currentOwnership,
        }],
      ]);

      const caps: Capability[] = [{
        name: 'e2e-cap',
        service: 'e2e-service',
        ttl: '1h',
        autoApprove: true,
      }];

      // Friend should be denied before grant
      const { client: friendBefore } = await createTestPair({
        clientName: 'friend',
        services: makeServices(),
        capabilities: caps,
      });

      const denied = await friendBefore.callTool({
        name: 'execute',
        arguments: { capability: 'e2e-cap', method: 'GET', path: '/data' }
      });
      expect(denied.isError).toBe(true);

      // Owner grants access to friend — capture the updated ownership via persist callback
      const { client: ownerClient } = await createTestPair({
        clientName: 'owner',
        services: makeServices(),
        capabilities: caps,
        onPersistOwnership: (_svc, updated) => { currentOwnership = updated; },
      });

      const grant = await ownerClient.callTool({
        name: 'manage_credential',
        arguments: { action: 'grant', service: 'e2e-service', targetAgentId: 'friend' }
      });
      expect(grant.isError).toBeFalsy();

      // Friend should now be able to execute (using the persisted ownership)
      const { client: friendAfter } = await createTestPair({
        clientName: 'friend',
        services: makeServices(),
        capabilities: caps,
      });

      const allowed = await friendAfter.callTool({
        name: 'execute',
        arguments: { capability: 'e2e-cap', method: 'GET', path: '/data' }
      });
      expect(allowed.isError).toBeFalsy();
      const parsed = extractJSON(allowed);
      expect(parsed.status).toBe(200);
    });
  });

  describe('capability-level allowedAgents', () => {
    it('should allow an agent listed in allowedAgents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['github-service', {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', key: 'secret' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'github-cap',
        service: 'github-service',
        ttl: '1h',
        autoApprove: true,
        allowedAgents: ['agent-a'],
      }];

      const { client } = await createTestPair({ clientName: 'agent-a', services, capabilities });

      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'github-cap', method: 'GET', path: '/user' }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.status).toBe(200);
    });

    it('should deny an agent not listed in allowedAgents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['github-service', {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', key: 'secret' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'github-cap',
        service: 'github-service',
        ttl: '1h',
        autoApprove: true,
        allowedAgents: ['agent-a'],
      }];

      const { client } = await createTestPair({ clientName: 'agent-b', services, capabilities });

      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'github-cap', method: 'GET', path: '/user' }
      });

      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.error).toContain('Access denied');
    });

    it('should hide restricted capabilities from list_services', async () => {
      const services = new Map<string, ServiceConfig>([
        ['github-service', {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', key: 'key1' },
        }],
        ['devto-service', {
          baseUrl: 'https://dev.to/api',
          auth: { type: 'bearer', key: 'key2' },
        }],
      ]);

      const capabilities: Capability[] = [
        { name: 'github-cap', service: 'github-service', ttl: '1h', autoApprove: true, allowedAgents: ['agent-a'] },
        { name: 'devto-cap', service: 'devto-service', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({ clientName: 'agent-b', services, capabilities });

      const result = await client.callTool({
        name: 'list_services',
        arguments: {}
      });
      const parsed = extractJSON(result);
      const names = parsed.map((c: any) => c.name);

      expect(names).toContain('devto-cap');
      expect(names).toContain('github-cap');

      const accessible = (name: string) => parsed.find((c: any) => c.name === name)?.accessible;
      expect(accessible('devto-cap')).toBe(true);
      expect(accessible('github-cap')).toBe(false);
    });
  });

  describe('defaultAccess policy', () => {
    it('should deny all agents when defaultAccess is "restricted" and no allowedAgents set', async () => {
      const services = new Map<string, ServiceConfig>([
        ['open-service', {
          baseUrl: 'https://api.open.com',
          auth: { type: 'bearer', key: 'key' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'open-cap',
        service: 'open-service',
        ttl: '1h',
        autoApprove: true,
      }];

      const { client } = await createTestPair({
        clientName: 'some-agent',
        services,
        capabilities,
        defaultAccess: 'restricted',
      });

      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'open-cap', method: 'GET', path: '/data' }
      });

      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.error).toContain('Access denied');
    });

    it('should allow agents when defaultAccess is "open" and no allowedAgents set', async () => {
      const services = new Map<string, ServiceConfig>([
        ['open-service', {
          baseUrl: 'https://api.open.com',
          auth: { type: 'bearer', key: 'key' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'open-cap',
        service: 'open-service',
        ttl: '1h',
        autoApprove: true,
      }];

      const { client } = await createTestPair({
        clientName: 'some-agent',
        services,
        capabilities,
        defaultAccess: 'open',
      });

      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'open-cap', method: 'GET', path: '/data' }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.status).toBe(200);
    });

    it('should still allow explicitly listed agents even with defaultAccess restricted', async () => {
      const services = new Map<string, ServiceConfig>([
        ['github-service', {
          baseUrl: 'https://api.github.com',
          auth: { type: 'bearer', key: 'key' },
        }],
      ]);

      const capabilities: Capability[] = [{
        name: 'github-cap',
        service: 'github-service',
        ttl: '1h',
        autoApprove: true,
        allowedAgents: ['agent-a'],
      }];

      const { client } = await createTestPair({
        clientName: 'agent-a',
        services,
        capabilities,
        defaultAccess: 'restricted',
      });

      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'github-cap', method: 'GET', path: '/user' }
      });

      expect(result.isError).toBeFalsy();
      const parsed = extractJSON(result);
      expect(parsed.status).toBe(200);
    });

    it('should hide all capabilities from list_services when defaultAccess is restricted', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc-a', { baseUrl: 'https://a.com', auth: { type: 'bearer', key: 'k1' } }],
        ['svc-b', { baseUrl: 'https://b.com', auth: { type: 'bearer', key: 'k2' } }],
      ]);

      const capabilities: Capability[] = [
        { name: 'cap-a', service: 'svc-a', ttl: '1h', autoApprove: true },
        { name: 'cap-b', service: 'svc-b', ttl: '1h', autoApprove: true, allowedAgents: ['agent-x'] },
      ];

      const { client } = await createTestPair({
        clientName: 'agent-x',
        services,
        capabilities,
        defaultAccess: 'restricted',
      });

      const result = await client.callTool({
        name: 'list_services',
        arguments: {}
      });
      const parsed = extractJSON(result);
      const names = parsed.map((c: any) => c.name);

      expect(names).toContain('cap-b');
      expect(names).toContain('cap-a');

      const accessible = (name: string) => parsed.find((c: any) => c.name === name)?.accessible;
      expect(accessible('cap-b')).toBe(true);
      expect(accessible('cap-a')).toBe(false);
    });
  });

  describe('per-capability access override', () => {
    it('should allow access to cap with access:"open" even when global defaultAccess is restricted', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [
        { name: 'open-cap', service: 'svc', ttl: '1h', autoApprove: true, access: 'open' },
        { name: 'default-cap', service: 'svc', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({
        clientName: 'any-agent', services, capabilities, defaultAccess: 'restricted',
      });

      const openResult = await client.callTool({
        name: 'execute', arguments: { capability: 'open-cap', method: 'GET', path: '/data' }
      });
      expect(openResult.isError).toBeFalsy();

      const defaultResult = await client.callTool({
        name: 'execute', arguments: { capability: 'default-cap', method: 'GET', path: '/data' }
      });
      expect(defaultResult.isError).toBe(true);
    });

    it('should deny access to cap with access:"restricted" even when global defaultAccess is open', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [
        { name: 'locked-cap', service: 'svc', ttl: '1h', autoApprove: true, access: 'restricted' },
        { name: 'normal-cap', service: 'svc', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({
        clientName: 'any-agent', services, capabilities, defaultAccess: 'open',
      });

      const lockedResult = await client.callTool({
        name: 'execute', arguments: { capability: 'locked-cap', method: 'GET', path: '/data' }
      });
      expect(lockedResult.isError).toBe(true);
      const parsed = extractJSON(lockedResult);
      expect(parsed.denial.reasonCode).toBe('DEFAULT_ACCESS_RESTRICTED');

      const normalResult = await client.callTool({
        name: 'execute', arguments: { capability: 'normal-cap', method: 'GET', path: '/data' }
      });
      expect(normalResult.isError).toBeFalsy();
    });

    it('should still respect allowedAgents on a restricted capability', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'stripe-cap', service: 'svc', ttl: '1h', autoApprove: true,
        access: 'restricted', allowedAgents: ['billing-bot'],
      }];

      const { client: allowed } = await createTestPair({
        clientName: 'billing-bot', services, capabilities,
      });
      const allowedResult = await allowed.callTool({
        name: 'execute', arguments: { capability: 'stripe-cap', method: 'GET', path: '/balance' }
      });
      expect(allowedResult.isError).toBeFalsy();

      const { client: denied } = await createTestPair({
        clientName: 'other-agent', services, capabilities,
      });
      const deniedResult = await denied.callTool({
        name: 'execute', arguments: { capability: 'stripe-cap', method: 'GET', path: '/balance' }
      });
      expect(deniedResult.isError).toBe(true);
    });

    it('should show cap-level access in list_services', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [
        { name: 'serp', service: 'svc', ttl: '1h', autoApprove: true, access: 'open' },
        { name: 'stripe', service: 'svc', ttl: '1h', autoApprove: true, access: 'restricted' },
      ];

      const { client } = await createTestPair({
        clientName: 'any-agent', services, capabilities, defaultAccess: 'restricted',
      });

      const result = await client.callTool({ name: 'list_services', arguments: {} });
      const parsed = extractJSON(result);
      const accessible = (name: string) => parsed.find((c: any) => c.name === name)?.accessible;
      expect(accessible('serp')).toBe(true);
      expect(accessible('stripe')).toBe(false);
    });

    it('should trace cap-level access override in explain_access', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [
        { name: 'open-cap', service: 'svc', ttl: '1h', autoApprove: true, access: 'open' },
        { name: 'locked-cap', service: 'svc', ttl: '1h', autoApprove: true, access: 'restricted' },
      ];

      const { client } = await createTestPair({
        clientName: 'agent-x', services, capabilities, defaultAccess: 'restricted',
      });

      const openTrace = await client.callTool({
        name: 'explain_access', arguments: { capability: 'open-cap' }
      });
      const openParsed = extractJSON(openTrace);
      expect(openParsed.allowed).toBe(true);
      const openStep = openParsed.trace.find((t: any) => t.check === 'default_access');
      expect(openStep.result).toBe('pass');
      expect(openStep.detail).toContain('capability access');

      const lockedTrace = await client.callTool({
        name: 'explain_access', arguments: { capability: 'locked-cap' }
      });
      const lockedParsed = extractJSON(lockedTrace);
      expect(lockedParsed.allowed).toBe(false);
      const lockedStep = lockedParsed.trace.find((t: any) => t.check === 'default_access');
      expect(lockedStep.result).toBe('fail');
      expect(lockedStep.detail).toContain('capability access');
    });
  });

  describe('whoami', () => {
    it('should return the resolved agent identity and accessible capabilities', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.example.com', auth: { type: 'bearer', key: 'k' } }],
      ]);

      const capabilities: Capability[] = [
        { name: 'open-cap', service: 'svc', ttl: '1h', autoApprove: true },
        { name: 'restricted-cap', service: 'svc', ttl: '1h', autoApprove: true, allowedAgents: ['agent-a'] },
      ];

      const { client } = await createTestPair({ clientName: 'agent-a', services, capabilities });
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.agentId).toBe('agent-a');
      expect(parsed.identitySource).toBe('transport (clientInfo.name)');
      expect(parsed.capabilities.accessible).toContain('open-cap');
      expect(parsed.capabilities.accessible).toContain('restricted-cap');
      expect(parsed.capabilities.denied).toHaveLength(0);
    });

    it('should show denied capabilities for an unrecognized agent', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.example.com', auth: { type: 'bearer', key: 'k' } }],
      ]);

      const capabilities: Capability[] = [
        { name: 'open-cap', service: 'svc', ttl: '1h', autoApprove: true },
        { name: 'restricted-cap', service: 'svc', ttl: '1h', autoApprove: true, allowedAgents: ['agent-a'] },
      ];

      const { client } = await createTestPair({ clientName: 'agent-b', services, capabilities });
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.agentId).toBe('agent-b');
      expect(parsed.capabilities.accessible).toContain('open-cap');
      expect(parsed.capabilities.denied).toContain('restricted-cap');
    });

    it('should report defaultAccessPolicy', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.example.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [
        { name: 'cap', service: 'svc', ttl: '1h', autoApprove: true },
      ];

      const { client } = await createTestPair({ clientName: 'agent-x', services, capabilities, defaultAccess: 'restricted' });
      const result = await client.callTool({ name: 'whoami', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.agentId).toBe('agent-x');
      expect(parsed.defaultAccessPolicy).toBe('restricted');
      expect(parsed.capabilities.denied).toContain('cap');
    });

    it('should forward whoami in runner mode', async () => {
      const forwardResult = {
        content: [{ type: 'text', text: JSON.stringify({ agentId: 'authority-agent' }) }],
      };
      const onForwardToolCall = vi.fn().mockResolvedValue(forwardResult);

      const { client } = await createTestPair({
        clientName: 'runner-agent',
        onForwardToolCall,
      });

      const result = await client.callTool({ name: 'whoami', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.agentId).toBe('authority-agent');
      expect(onForwardToolCall).toHaveBeenCalledWith('whoami', {}, 'runner-agent');
    });
  });

  describe('Structured denial codes', () => {
    it('should return CAPABILITY_NOT_FOUND for unknown capability on execute', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'nonexistent', method: 'GET', path: '/test' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('CAPABILITY_NOT_FOUND');
      expect(parsed.denial.capability).toBe('nonexistent');
      expect(parsed.denial.nextStep).toContain('janee cap list');
    });

    it('should return AGENT_NOT_ALLOWED when agent is not in allowedAgents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'restricted-cap', service: 'svc', ttl: '1h', autoApprove: true,
        allowedAgents: ['agent-a']
      }];

      const { client } = await createTestPair({ clientName: 'agent-b', services, capabilities });
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'restricted-cap', method: 'GET', path: '/test' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('AGENT_NOT_ALLOWED');
      expect(parsed.denial.agentId).toBe('agent-b');
      expect(parsed.denial.nextStep).toContain('janee cap edit');
    });

    it('should return DEFAULT_ACCESS_RESTRICTED when defaultAccess blocks agent', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'open-cap', service: 'svc', ttl: '1h', autoApprove: true
      }];

      const { client } = await createTestPair({
        clientName: 'some-agent', services, capabilities, defaultAccess: 'restricted'
      });
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'open-cap', method: 'GET', path: '/test' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('DEFAULT_ACCESS_RESTRICTED');
    });

    it('should return MODE_MISMATCH when using execute for exec-mode capability', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'exec-cap', service: 'svc', ttl: '1h', autoApprove: true, mode: 'exec'
      }];

      const { client } = await createTestPair({ services, capabilities });
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'exec-cap', method: 'GET', path: '/test' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('MODE_MISMATCH');
    });

    it('should return REASON_REQUIRED when reason is missing', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'audit-cap', service: 'svc', ttl: '1h', autoApprove: true, requiresReason: true
      }];

      const { client } = await createTestPair({ services, capabilities });
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'audit-cap', method: 'GET', path: '/test' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('REASON_REQUIRED');
    });

    it('should return RULE_DENY when path-based rules deny the request', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'ruled-cap', service: 'svc', ttl: '1h', autoApprove: true,
        rules: { deny: ['DELETE /**'] }
      }];

      const { client } = await createTestPair({ services, capabilities });
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'ruled-cap', method: 'DELETE', path: '/anything' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('RULE_DENY');
      expect(parsed.denial.nextStep).toContain('janee cap list');
    });

    it('should return CAPABILITY_NOT_FOUND for janee_exec with unknown capability', async () => {
      const mockExec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      const { client } = await createTestPair({ onExecCommand: mockExec });
      const result = await client.callTool({
        name: 'janee_exec',
        arguments: { capability: 'ghost', command: 'ls' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('CAPABILITY_NOT_FOUND');
    });

    it('should return MODE_MISMATCH for janee_exec on a proxy capability', async () => {
      const mockExec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      const { client } = await createTestPair({ onExecCommand: mockExec });
      const result = await client.callTool({
        name: 'janee_exec',
        arguments: { capability: 'test-cap', command: 'ls' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('MODE_MISMATCH');
    });

    it('should return COMMAND_NOT_ALLOWED for janee_exec with disallowed command', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'exec-cap', service: 'svc', ttl: '1h', autoApprove: true,
        mode: 'exec', allowCommands: ['ls', 'cat']
      }];

      const mockExec = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
      const { client } = await createTestPair({ services, capabilities, onExecCommand: mockExec });
      const result = await client.callTool({
        name: 'janee_exec',
        arguments: { capability: 'exec-cap', command: 'rm -rf /' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.denial).toBeDefined();
      expect(parsed.denial.reasonCode).toBe('COMMAND_NOT_ALLOWED');
      expect(parsed.denial.nextStep).toContain('janee cap edit');
    });

    it('should NOT include denial field for non-denial errors', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'execute',
        arguments: { capability: 'test-cap', method: 'GET' }
      });
      expect(result.isError).toBe(true);
      const parsed = extractJSON(result);
      expect(parsed.error).toContain('Missing required argument: path');
      expect(parsed.denial).toBeUndefined();
    });
  });

  describe('explain_access', () => {
    it('should show full trace for an allowed capability', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'my-cap', service: 'svc', ttl: '1h', autoApprove: true
      }];

      const { client } = await createTestPair({ clientName: 'agent-a', services, capabilities });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'my-cap' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(true);
      expect(parsed.agent).toBe('agent-a');
      expect(parsed.capability).toBe('my-cap');
      expect(parsed.trace).toEqual(expect.arrayContaining([
        expect.objectContaining({ check: 'capability_exists', result: 'pass' }),
      ]));
    });

    it('should report capability not found', async () => {
      const { client } = await createTestPair();
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'nonexistent' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(false);
      expect(parsed.trace[0].check).toBe('capability_exists');
      expect(parsed.trace[0].result).toBe('fail');
      expect(parsed.nextStep).toBeDefined();
    });

    it('should show AGENT_NOT_ALLOWED when agent is not in allowedAgents', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'restricted', service: 'svc', ttl: '1h', autoApprove: true,
        allowedAgents: ['agent-a']
      }];

      const { client } = await createTestPair({ clientName: 'agent-b', services, capabilities });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'restricted' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(false);
      const agentStep = parsed.trace.find((t: any) => t.check === 'allowed_agents');
      expect(agentStep.result).toBe('fail');
      expect(agentStep.detail).toContain('agent-b');
    });

    it('should trace defaultAccess restricted', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'cap', service: 'svc', ttl: '1h', autoApprove: true
      }];

      const { client } = await createTestPair({
        clientName: 'agent-x', services, capabilities, defaultAccess: 'restricted'
      });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'cap' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(false);
      const step = parsed.trace.find((t: any) => t.check === 'default_access');
      expect(step.result).toBe('fail');
      expect(step.detail).toContain('restricted');
    });

    it('should evaluate rules when method/path provided', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'ruled-cap', service: 'svc', ttl: '1h', autoApprove: true,
        rules: { deny: ['DELETE /**'] }
      }];

      const { client } = await createTestPair({ services, capabilities });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'ruled-cap', method: 'DELETE', path: '/anything' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(false);
      const ruleStep = parsed.trace.find((t: any) => t.check === 'rules');
      expect(ruleStep.result).toBe('fail');
    });

    it('should show allowed=true for rules that pass', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'ruled-cap', service: 'svc', ttl: '1h', autoApprove: true,
        rules: { deny: ['DELETE /**'] }
      }];

      const { client } = await createTestPair({ services, capabilities });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'ruled-cap', method: 'GET', path: '/ok' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(true);
      const ruleStep = parsed.trace.find((t: any) => t.check === 'rules');
      expect(ruleStep.result).toBe('pass');
    });

    it('should allow specifying a different agent via args', async () => {
      const services = new Map<string, ServiceConfig>([
        ['svc', { baseUrl: 'https://api.test.com', auth: { type: 'bearer', key: 'k' } }],
      ]);
      const capabilities: Capability[] = [{
        name: 'cap', service: 'svc', ttl: '1h', autoApprove: true,
        allowedAgents: ['special-agent']
      }];

      const { client } = await createTestPair({ clientName: 'admin', services, capabilities });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'cap', agent: 'special-agent' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(true);
      expect(parsed.agent).toBe('special-agent');
    });

    it('should be forwarded in runner mode', async () => {
      const forwardResult = {
        content: [{ type: 'text', text: JSON.stringify({ allowed: true, agent: 'test', trace: [] }) }],
      };
      const onForwardToolCall = vi.fn().mockResolvedValue(forwardResult);

      const { client } = await createTestPair({ clientName: 'runner-agent', onForwardToolCall });
      const result = await client.callTool({
        name: 'explain_access',
        arguments: { capability: 'test-cap' }
      });
      const parsed = extractJSON(result);

      expect(parsed.allowed).toBe(true);
      expect(onForwardToolCall).toHaveBeenCalledWith(
        'explain_access',
        expect.objectContaining({ capability: 'test-cap' }),
        'runner-agent'
      );
    });
  });

  describe('doctor (MCP tool)', () => {
    it('should return doctor results when onDoctorRunner is provided', async () => {
      const mockDoctor = vi.fn().mockResolvedValue({
        overall: 'PASS',
        checks: [
          { name: 'authority_reachable', status: 'PASS', detail: 'OK' },
          { name: 'runner_key', status: 'PASS', detail: 'Accepted' },
        ]
      });

      const { client } = await createTestPair({
        clientName: 'test-agent',
        onDoctorRunner: mockDoctor,
      });

      const result = await client.callTool({ name: 'doctor', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.overall).toBe('PASS');
      expect(parsed.checks).toHaveLength(2);
      expect(mockDoctor).toHaveBeenCalledWith('test-agent');
    });

    it('should not be available without onDoctorRunner', async () => {
      const { client } = await createTestPair();

      const tools = await client.listTools();
      const doctorTool = tools.tools.find((t: any) => t.name === 'doctor');
      expect(doctorTool).toBeUndefined();
    });

    it('should not be forwarded in runner mode', async () => {
      const mockDoctor = vi.fn().mockResolvedValue({
        overall: 'PASS',
        checks: [{ name: 'test', status: 'PASS', detail: 'ok' }]
      });
      const onForwardToolCall = vi.fn();

      const { client } = await createTestPair({
        clientName: 'runner-agent',
        onForwardToolCall,
        onDoctorRunner: mockDoctor,
      });

      const result = await client.callTool({ name: 'doctor', arguments: {} });
      const parsed = extractJSON(result);

      expect(parsed.overall).toBe('PASS');
      expect(mockDoctor).toHaveBeenCalled();
      expect(onForwardToolCall).not.toHaveBeenCalled();
    });
  });
});

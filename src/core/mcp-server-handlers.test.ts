/**
 * Integration tests for MCP Server agent-scoped credential handlers.
 * Tests actual tool call behavior through Server + Client over InMemoryTransport.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMCPServer, captureClientInfo, Capability, ServiceConfig } from './mcp-server';
import { SessionManager } from './sessions';
import { AuditLogger } from './audit';
import { CredentialOwnership, agentCreatedOwnership, cliCreatedOwnership } from './agent-scope';

// Helper to create a connected client+server pair
async function createTestPair(overrides: {
  clientName?: string;
  capabilities?: Capability[];
  services?: Map<string, ServiceConfig>;
  defaultAccess?: 'open' | 'restricted';
  onPersistOwnership?: (service: string, ownership: CredentialOwnership) => void;
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
    onPersistOwnership: overrides.onPersistOwnership,
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
});

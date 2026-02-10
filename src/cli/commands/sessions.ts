import { getConfigDir } from '../config-yaml';
import fs from 'fs';
import path from 'path';

interface Session {
  id: string;
  capability: string;
  service: string;
  agentId?: string;
  reason?: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

export async function sessionsCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    const sessionsFile = path.join(getConfigDir(), 'sessions.json');

    if (!fs.existsSync(sessionsFile)) {
      if (options.json) {
        console.log(JSON.stringify({ sessions: [] }, null, 2));
      } else {
        console.log('No active sessions');
        console.log('');
        console.log('Sessions will appear when agents access APIs via MCP.');
      }
      return;
    }

    const data = fs.readFileSync(sessionsFile, 'utf8');
    const sessions: Session[] = JSON.parse(data);

    // Filter active sessions
    const now = new Date();
    const active = sessions.filter(s => {
      return !s.revoked && new Date(s.expiresAt) > now;
    });

    if (options.json) {
      // JSON output
      const output = active.map(session => {
        const expires = new Date(session.expiresAt);
        const ttl = Math.floor((expires.getTime() - now.getTime()) / 1000);
        
        return {
          id: session.id,
          capability: session.capability,
          service: session.service,
          agentId: session.agentId,
          reason: session.reason,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          ttlSeconds: ttl
        };
      });
      
      console.log(JSON.stringify({ sessions: output }, null, 2));
      return;
    }

    // Human-readable output
    if (active.length === 0) {
      console.log('No active sessions');
      return;
    }

    console.log('');
    console.log('Active sessions:');
    console.log('');

    active.forEach(session => {
      const expires = new Date(session.expiresAt);
      const ttl = Math.floor((expires.getTime() - now.getTime()) / 1000);
      const ttlStr = formatTTL(ttl);

      console.log(`  ${session.id.substring(0, 20)}...`);
      console.log(`    Capability: ${session.capability}`);
      console.log(`    Service: ${session.service}`);
      if (session.agentId) {
        console.log(`    Agent: ${session.agentId}`);
      }
      if (session.reason) {
        console.log(`    Reason: ${session.reason}`);
      }
      console.log(`    Expires: ${ttlStr}`);
      console.log('');
    });

    console.log(`Total: ${active.length} active session${active.length === 1 ? '' : 's'}`);
    console.log('');

  } catch (error) {
    if (error instanceof Error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error('❌ Error:', error.message);
      }
    } else {
      if (options.json) {
        console.log(JSON.stringify({ error: 'Unknown error occurred' }, null, 2));
      } else {
        console.error('❌ Unknown error occurred');
      }
    }
    process.exit(1);
  }
}

function formatTTL(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

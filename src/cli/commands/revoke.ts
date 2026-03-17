import fs from 'fs';
import path from 'path';
import type { SerializedSession } from '../../core/sessions';
import { handleCommandError } from '../cli-utils';
import { getConfigDir } from '../config-yaml';

export async function revokeCommand(sessionIdPrefix: string): Promise<void> {
  try {
    const sessionsFile = path.join(getConfigDir(), 'sessions.json');

    if (!fs.existsSync(sessionsFile)) {
      console.error('❌ No sessions file found');
      process.exit(1);
    }

    const data = fs.readFileSync(sessionsFile, 'utf8');
    const sessions: SerializedSession[] = JSON.parse(data);

    const matches = sessions.filter(s => s.id.startsWith(sessionIdPrefix));

    if (matches.length === 0) {
      console.error(`❌ Session not found: ${sessionIdPrefix}`);
      console.error('');
      console.error('Run: janee sessions');
      process.exit(1);
    }

    if (matches.length > 1) {
      console.error(`❌ Ambiguous prefix "${sessionIdPrefix}" matches ${matches.length} sessions. Be more specific.`);
      for (const m of matches) {
        console.error(`   ${m.id.substring(0, 24)}... (${m.capability})`);
      }
      process.exit(1);
    }

    const session = matches[0];

    if (session.revoked) {
      console.log(`⚠️  Session already revoked: ${session.id.substring(0, 20)}...`);
      return;
    }

    // Revoke session
    session.revoked = true;

    // Save back
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2), { mode: 0o600 });

    console.log(`✅ Session revoked: ${session.id.substring(0, 20)}...`);
    console.log('');
    console.log(`   Capability: ${session.capability}`);
    console.log(`   Service: ${session.service}`);
    if (session.agentId) {
      console.log(`   Agent: ${session.agentId}`);
    }
    console.log('');
    console.log('Agent will lose access immediately on next request.');

  } catch (error) {
    handleCommandError(error);
  }
}

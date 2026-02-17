import { getConfigDir, getAuditDir, hasYAMLConfig, loadYAMLConfig } from '../config-yaml';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

interface Session {
  id: string;
  capability: string;
  service: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
}

interface StatusInfo {
  version: string;
  configDir: string;
  configExists: boolean;
  encrypted: boolean;
  services: number;
  capabilities: number;
  activeSessions: number;
  totalSessions: number;
  auditLogEntries: number;
  auditLogSize: string;
}

export async function statusCommand(options: { json?: boolean } = {}): Promise<void> {
  try {
    const configDir = getConfigDir();
    const auditDir = getAuditDir();

    // Read version from package.json
    const packageJsonPath = join(__dirname, '../../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version || '0.0.0';

    const configExists = hasYAMLConfig();
    let services = 0;
    let capabilities = 0;
    let encrypted = false;

    if (configExists) {
      const config = loadYAMLConfig();
      services = Object.keys(config.services).length;
      capabilities = Object.keys(config.capabilities).length;
      encrypted = !!config.masterKey;
    }

    // Count sessions
    const sessionsFile = join(configDir, 'sessions.json');
    let activeSessions = 0;
    let totalSessions = 0;

    if (existsSync(sessionsFile)) {
      const data = readFileSync(sessionsFile, 'utf8');
      const sessions: Session[] = JSON.parse(data);
      totalSessions = sessions.length;
      const now = new Date();
      activeSessions = sessions.filter(
        s => !s.revoked && new Date(s.expiresAt) > now
      ).length;
    }

    // Count audit logs
    let auditLogEntries = 0;
    let auditLogBytes = 0;

    if (existsSync(auditDir)) {
      const files = readdirSync(auditDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = join(auditDir, file);
        const stat = statSync(filePath);
        auditLogBytes += stat.size;
        const content = readFileSync(filePath, 'utf8');
        auditLogEntries += content.split('\n').filter(line => line.trim()).length;
      }
    }

    const status: StatusInfo = {
      version,
      configDir,
      configExists,
      encrypted,
      services,
      capabilities,
      activeSessions,
      totalSessions,
      auditLogEntries,
      auditLogSize: formatBytes(auditLogBytes),
    };

    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    // Human-readable output
    console.log('');
    console.log(`  Janee v${version}`);
    console.log('');

    if (!configExists) {
      console.log('  ⚠️  Not initialized');
      console.log('');
      console.log('  Run `janee init` to get started.');
      console.log('');
      return;
    }

    console.log(`  Config:       ${configDir}`);
    console.log(`  Encryption:   ${encrypted ? '🔒 enabled' : '⚠️  disabled'}`);
    console.log('');
    console.log(`  Services:     ${services}`);
    console.log(`  Capabilities: ${capabilities}`);
    console.log(`  Sessions:     ${activeSessions} active${totalSessions > activeSessions ? ` (${totalSessions} total)` : ''}`);
    console.log('');
    console.log(`  Audit log:    ${auditLogEntries} entries (${formatBytes(auditLogBytes)})`);
    console.log('');

    // Show health hints
    if (services === 0) {
      console.log('  💡 Add a service: janee add');
    }
    if (capabilities === 0 && services > 0) {
      console.log('  💡 Add a capability: edit ~/.janee/config.yaml');
    }
    if (activeSessions === 0 && services > 0) {
      console.log('  💡 Start serving: janee serve');
    }
    if (services === 0 || capabilities === 0 || activeSessions === 0) {
      console.log('');
    }

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

import fs from 'fs';
import path from 'path';

import { getConfigDir, getAuditDir, hasConfig, initConfig } from '../config-store';

export async function initCommand(): Promise<void> {
  try {
    const configDir = getConfigDir();
    const logsDir = getAuditDir();

    // Ensure directories exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { mode: 0o700, recursive: true });
    }
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { mode: 0o700, recursive: true });
    }

    // Check if config already exists
    if (hasConfig()) {
      const dbPath = path.join(configDir, 'config.db');
      console.error('❌ Config already exists at:', dbPath);
      console.error('');
      console.error('To start fresh, remove the existing config:');
      console.error(`  rm ${dbPath}`);
      process.exit(1);
    }

    // Create a fresh config store
    const config = initConfig();

    console.log('✅ Janee initialized successfully!');
    console.log();
    console.log(`Config database: ${path.join(configDir, 'config.db')}`);
    console.log(`Logs directory: ${logsDir}`);
    console.log(`\nMaster key: ${config.masterKey}`);
    console.log(`\n⚠️  Save this key somewhere safe — you will need it to recover\n   your config if you move to another machine or lose ~/.janee/`);
    console.log();
    console.log('Next steps:');
    console.log('  1. Add services:    janee add <service-name>');
    console.log('  2. Add capabilities: janee capability add <name>');
    console.log('  3. Start the MCP server: janee serve');
    console.log('  4. Connect your agent (Claude Desktop, etc.)');
    console.log();
  } catch (error) {
    if (error instanceof Error) {
      console.error('❌ Error:', error.message);
    } else {
      console.error('❌ Unknown error occurred');
    }
    process.exit(1);
  }
}

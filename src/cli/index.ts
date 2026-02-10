#!/usr/bin/env node

/**
 * Janee CLI
 * Secrets management for AI agents
 */

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { addCommand } from './commands/add';
import { removeCommand } from './commands/remove';
import { serveCommand } from './commands/serve';
import { listCommand } from './commands/list';
import { logsCommand } from './commands/logs';
import { sessionsCommand } from './commands/sessions';
import { revokeCommand } from './commands/revoke';
import { searchCommand } from './commands/search';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json
const packageJsonPath = join(__dirname, '../../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version || '0.0.0';

const program = new Command();

program
  .name('janee')
  .description('Secrets management for AI agents')
  .version(version);

// Commands
program
  .command('init')
  .description('Initialize Janee configuration with example config')
  .action(initCommand);

program
  .command('add [service]')
  .description('Add a service to Janee (interactive if no args)')
  .option('-u, --url <url>', 'Base URL of the service')
  .option('-k, --key <key>', 'API key for the service')
  .option('--auth-type <type>', 'Authentication type (bearer/basic/hmac/hmac-bybit/hmac-okx/headers/service-account)')
  .option('--api-secret <secret>', 'API secret (for hmac auth types)')
  .option('--passphrase <passphrase>', 'Passphrase (for hmac-okx)')
  .option('--key-from-env <var>', 'Read API key from environment variable')
  .option('--secret-from-env <var>', 'Read API secret from environment variable')
  .option('--passphrase-from-env <var>', 'Read passphrase from environment variable')
  .option('--credentials-file <path>', 'Path to service account JSON file (for service-account auth type)')
  .option('--scope <scope...>', 'OAuth scope(s) for service-account auth type')
  .action(addCommand);

program
  .command('remove <service>')
  .description('Remove a service from Janee')
  .action(removeCommand);

program
  .command('serve')
  .description('Start Janee MCP server')
  .action(serveCommand);

program
  .command('list')
  .description('List configured services')
  .action(listCommand);

program
  .command('logs')
  .description('View audit logs')
  .option('-f, --follow', 'Follow logs in real-time')
  .option('-n, --lines <count>', 'Number of recent logs to show', '20')
  .option('-s, --service <name>', 'Filter by service')
  .action(logsCommand);

program
  .command('sessions')
  .description('List active sessions')
  .action(sessionsCommand);

program
  .command('revoke <session>')
  .description('Revoke a session immediately')
  .action(revokeCommand);

program
  .command('search [query]')
  .description('Search the service directory')
  .option('-v, --verbose', 'Show full details for each service')
  .action((query, options) => searchCommand(query, options.verbose));

program.parse();

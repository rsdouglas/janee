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
import {
  capabilityListCommand,
  capabilityAddCommand,
  capabilityEditCommand,
  capabilityRemoveCommand
} from './commands/capability';
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
  .option('--auth-type <type>', 'Authentication type (bearer/basic/hmac-mexc/hmac-bybit/hmac-okx/headers/service-account)')
  .option('--api-secret <secret>', 'API secret (for hmac auth types)')
  .option('--passphrase <passphrase>', 'Passphrase (for hmac-okx)')
  .option('--key-from-env <var>', 'Read API key from environment variable')
  .option('--secret-from-env <var>', 'Read API secret from environment variable')
  .option('--passphrase-from-env <var>', 'Read passphrase from environment variable')
  .option('--credentials-file <path>', 'Path to service account JSON file (for service-account auth type)')
  .option('--scope <scope...>', 'OAuth scope(s) for service-account auth type')
  .option('--json', 'Output as JSON')
  .action(addCommand);

program
  .command('remove <service>')
  .description('Remove a service from Janee')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(removeCommand);

program
  .command('serve')
  .description('Start Janee MCP server')
  .option('-t, --transport <type>', 'Transport type (stdio|http)', 'stdio')
  .option('-p, --port <number>', 'Port for network transport (default: 9100)', '9100')
  .option('--host <host>', 'Host to bind to (default: localhost)', 'localhost')
  .action(serveCommand);

program
  .command('list')
  .description('List configured services')
  .option('--json', 'Output as JSON')
  .action(listCommand);

program
  .command('logs')
  .description('View audit logs')
  .option('-f, --follow', 'Follow logs in real-time')
  .option('-n, --lines <count>', 'Number of recent logs to show', '20')
  .option('-s, --service <name>', 'Filter by service')
  .option('--json', 'Output as JSON (not supported with --follow)')
  .action(logsCommand);

program
  .command('sessions')
  .description('List active sessions')
  .option('--json', 'Output as JSON')
  .action(sessionsCommand);

program
  .command('revoke <session>')
  .description('Revoke a session immediately')
  .action(revokeCommand);

program
  .command('search [query]')
  .description('Search the service directory')
  .option('-v, --verbose', 'Show full details for each service')
  .option('--json', 'Output as JSON')
  .action((query, options) => searchCommand(query, options));

// Capability management subcommands
const cap = program.command('cap').description('Manage capabilities');

cap
  .command('list')
  .description('List all capabilities')
  .option('--json', 'Output as JSON')
  .action(capabilityListCommand);

cap
  .command('add <name>')
  .description('Add a new capability')
  .requiredOption('-s, --service <service>', 'Service to use')
  .option('-t, --ttl <duration>', 'TTL (e.g., 1h, 30m)', '1h')
  .option('--auto-approve', 'Auto-approve requests')
  .option('--no-auto-approve', 'Require manual approval')
  .option('--requires-reason', 'Require reason for requests')
  .option('--no-requires-reason', 'Do not require reason')
  .option('--allow <pattern...>', 'Allow rules (e.g., "GET /v1/*")')
  .option('--deny <pattern...>', 'Deny rules (e.g., "DELETE *")')
  .option('--json', 'Output as JSON')
  .action(capabilityAddCommand);

cap
  .command('edit <name>')
  .description('Edit an existing capability')
  .option('-t, --ttl <duration>', 'Update TTL (e.g., 1h, 30m)')
  .option('--auto-approve', 'Enable auto-approve')
  .option('--no-auto-approve', 'Disable auto-approve')
  .option('--requires-reason', 'Require reason for requests')
  .option('--no-requires-reason', 'Do not require reason')
  .option('--allow <pattern...>', 'Replace allow rules')
  .option('--deny <pattern...>', 'Replace deny rules')
  .option('--clear-rules', 'Clear all rules')
  .option('--json', 'Output as JSON')
  .action(capabilityEditCommand);

cap
  .command('remove <name>')
  .description('Remove a capability')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(capabilityRemoveCommand);

program.parse();

#!/usr/bin/env node

/**
 * Janee CLI
 * Secrets management for AI agents
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

import { addCommand } from './commands/add';
import { authorityCommand } from './commands/authority';
import {
  capabilityAddCommand,
  capabilityEditCommand,
  capabilityListCommand,
  capabilityRemoveCommand,
} from './commands/capability';
import { configGetCommand, configSetCommand } from './commands/config';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { logsCommand } from './commands/logs';
import { removeCommand } from './commands/remove';
import { revokeCommand } from './commands/revoke';
import { searchCommand } from './commands/search';
import { serveCommand } from './commands/serve';
import { serviceEditCommand } from './commands/service-edit';
import { sessionsCommand } from './commands/sessions';
import { statusCommand } from './commands/status';
import { testCommand } from './commands/test';
import { whoamiCommand } from './commands/whoami';

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
  .option('--auth-type <type>', 'Authentication type (bearer/basic/hmac-mexc/hmac-bybit/hmac-okx/headers/service-account/github-app). Use --header with headers type')
  .option('--api-secret <secret>', 'API secret (for hmac auth types)')
  .option('--passphrase <passphrase>', 'Passphrase (for hmac-okx)')
  .option('--key-from-env <var>', 'Read API key from environment variable')
  .option('--secret-from-env <var>', 'Read API secret from environment variable')
  .option('--passphrase-from-env <var>', 'Read passphrase from environment variable')
  .option('--credentials-file <path>', 'Path to service account JSON file (for service-account auth type)')
  .option('--scope <scope...>', 'OAuth scope(s) for service-account auth type')
  .option('--header <pairs...>', 'Custom auth headers (name=value, repeatable)')
  .option('--pem-file <path>', 'Path to private key PEM file (for github-app auth type)')
  .option('--app-id <id>', 'GitHub App ID (for github-app auth type)')
  .option('--installation-id <id>', 'GitHub App installation ID (for github-app auth type)')
  .option('--test-path <path>', 'Auth-required GET endpoint for testing credentials (e.g. /v1/balance)')
  .option('--exec', 'Add as exec-mode service (CLI tool wrapper, RFC 0001)')
  .option('--allow-commands <cmds...>', 'Allowed executables for exec mode (e.g., bird gh)')
  .option('--env-map <mappings...>', 'Env var mappings (KEY=value or KEY={{credential}})')
  .option('--work-dir <dir>', 'Working directory for exec-mode commands')
  .option('--timeout <ms>', 'Max execution time in ms for exec mode (default: 30000)')
  .option('--json', 'Output as JSON')
  .action(addCommand);

program
  .command('remove <service>')
  .description('Remove a service from Janee')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(removeCommand);

// Service management subcommands
const service = program.command('service').description('Manage services');

service
  .command('edit <name>')
  .description('Edit an existing service (update URL, test path, or rotate secrets)')
  .option('-u, --url <url>', 'Update base URL')
  .option('--test-path <path>', 'Update test path')
  .option('-k, --key <key>', 'Rotate bearer key or HMAC apiKey')
  .option('--api-secret <secret>', 'Rotate HMAC secret')
  .option('--passphrase <passphrase>', 'Rotate OKX passphrase')
  .option('--pem-file <path>', 'Rotate GitHub App private key from PEM file')
  .option('--credentials-file <path>', 'Rotate service account credentials from JSON file')
  .option('--key-from-env <var>', 'Read key from environment variable')
  .option('--secret-from-env <var>', 'Read secret from environment variable')
  .option('--passphrase-from-env <var>', 'Read passphrase from environment variable')
  .option('--header <pairs...>', 'Update custom auth headers (name=value)')
  .option('--json', 'Output as JSON')
  .action(serviceEditCommand);

// Config get/set
const configCmd = program.command('config').description('View or update server and LLM settings');

configCmd
  .command('get [key]')
  .description('Show config value(s)')
  .option('--json', 'Output as JSON')
  .action(configGetCommand);

configCmd
  .command('set <key> <value>')
  .description('Set a config value (e.g. server.port 9200, llm.model gpt-4o)')
  .option('--json', 'Output as JSON')
  .action(configSetCommand);

program
  .command('serve')
  .description('Start Janee MCP server')
  .option('-t, --transport <type>', 'Transport type (stdio|http)', 'stdio')
  .option('-p, --port <number>', 'Port for network transport (default: 9100)', '9100')
  .option('--host <host>', 'Host to bind to (default: localhost)', 'localhost')
  .option('--authority <url>', 'Authority URL for runner mode (e.g., https://janee.example.com)')
  .option('--runner-key <key>', 'Runner shared key for authority mode (or JANEE_RUNNER_KEY)')
  .option('--runner-id <id>', 'Runner identity (or JANEE_RUNNER_ID)', 'local-runner')
  .option('--runner-env <env>', 'Runner environment label (or JANEE_RUNNER_ENV)', 'dev')
  .option('--runner-host-label <label>', 'Runner host label (or JANEE_RUNNER_HOST)')
  .action(serveCommand);


program
  .command('authority')
  .description('Start Janee authority server (runner control plane API)')
  .option('-p, --port <number>', 'Port for authority server (default: 9120)', '9120')
  .option('--host <host>', 'Host to bind to (default: 127.0.0.1)', '127.0.0.1')
  .option('--runner-key <key>', 'Shared runner API key (or JANEE_RUNNER_KEY)')
  .action(authorityCommand);

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
  .command('status')
  .description('Show Janee configuration and health status')
  .option('--json', 'Output as JSON')
  .action(statusCommand);

program
  .command('whoami')
  .description('Show your agent identity and accessible capabilities')
  .option('--agent <name>', 'Preview access for a specific agent identity')
  .option('--json', 'Output as JSON')
  .action(whoamiCommand);

program
  .command('test [service]')
  .description('Test service connectivity and authentication')
  .option('--timeout <ms>', 'Request timeout in ms (default: 10000)')
  .option('--json', 'Output as JSON')
  .action((service, options) => testCommand(service, options));

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
  .option('--allowed-agents <agents...>', 'Restrict to specific agent IDs')
  .option('--mode <mode>', 'Execution mode: proxy or exec')
  .option('--allow-commands <cmds...>', 'Allowed executables for exec mode')
  .option('--env-map <mappings...>', 'Env var mappings (KEY=value or KEY={{credential}})')
  .option('--work-dir <dir>', 'Working directory for exec mode')
  .option('--timeout <ms>', 'Execution timeout in ms')
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
  .option('--allowed-agents <agents...>', 'Restrict to specific agent IDs')
  .option('--clear-agents', 'Remove all agent restrictions')
  .option('--mode <mode>', 'Execution mode: proxy or exec')
  .option('--allow-commands <cmds...>', 'Allowed executables for exec mode')
  .option('--env-map <mappings...>', 'Env var mappings (KEY=value or KEY={{credential}})')
  .option('--work-dir <dir>', 'Working directory for exec mode')
  .option('--timeout <ms>', 'Execution timeout in ms')
  .option('--json', 'Output as JSON')
  .action(capabilityEditCommand);

cap
  .command('remove <name>')
  .description('Remove a capability')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--json', 'Output as JSON')
  .action(capabilityRemoveCommand);

program.parse();

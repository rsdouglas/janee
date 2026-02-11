import { serveMCPCommand, ServeMCPOptions } from './serve-mcp';

/**
 * Serve command - starts Janee MCP server
 * This is the only interface now (no HTTP proxy)
 */
export async function serveCommand(options: ServeMCPOptions = {}): Promise<void> {
  await serveMCPCommand(options);
}

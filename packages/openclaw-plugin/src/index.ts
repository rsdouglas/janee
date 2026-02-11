import { Type } from "@sinclair/typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let mcpClient: Client | null = null;
let isConnecting = false;
let pluginConfig: { url?: string } = {};

async function connect(api: any): Promise<Client> {
  let transport;

  if (pluginConfig.url) {
    // Network transport: connect to remote Janee instance via StreamableHTTP
    try {
      const url = new URL(pluginConfig.url);
      // Validate protocol
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Invalid protocol: ${url.protocol} (expected http: or https:)`);
      }
      // Warn if missing /mcp endpoint (check normalized pathname, ignoring trailing slash)
      const normalizedPath = url.pathname.replace(/\/$/, '') || '/';
      if (normalizedPath === '/') {
        api.log?.warn?.(`URL missing /mcp endpoint - connection may fail. Expected: ${url.origin}/mcp`);
      }
      api.log?.info?.(`Connecting to Janee at ${pluginConfig.url}`);
      transport = new StreamableHTTPClientTransport(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid URL';
      throw new Error(`Failed to parse Janee URL "${pluginConfig.url}": ${message}`);
    }
  } else {
    // Local transport: spawn janee serve as subprocess (current behavior)
    api.log?.info?.("Starting local Janee MCP server");
    transport = new StdioClientTransport({
      command: "janee",
      args: ["serve"]
    });
  }

  const client = new Client(
    { name: "openclaw-janee", version: "0.1.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  api.log?.info?.("Connected to Janee MCP server");
  return client;
}

async function ensureConnected(api: any): Promise<Client> {
  // If we have a client, try to use it
  if (mcpClient) {
    return mcpClient;
  }
  
  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    while (isConnecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (mcpClient) return mcpClient;
  }
  
  isConnecting = true;
  
  try {
    mcpClient = await connect(api);
    return mcpClient;
  } catch (error) {
    api.log?.error?.(`Failed to connect to Janee MCP server: ${error}`);
    throw error;
  } finally {
    isConnecting = false;
  }
}

async function callWithReconnect(api: any, fn: (client: Client) => Promise<any>): Promise<any> {
  try {
    const client = await ensureConnected(api);
    return await fn(client);
  } catch (error: any) {
    // If connection failed, reset and retry once
    if (error?.message?.includes('Not connected') || error?.message?.includes('closed')) {
      api.log?.warn?.("Connection lost, reconnecting...");
      mcpClient = null;
      const client = await ensureConnected(api);
      return await fn(client);
    }
    throw error;
  }
}

export default function(api: any, config?: { url?: string }) {
  // Store config for use in connect function
  pluginConfig = config || {};

  api.registerTool({
    name: "janee_list_services",
    description: "List available API services managed by Janee. Shows which services have stored credentials.",
    parameters: Type.Object({}),
    async execute() {
      return await callWithReconnect(api, async (client) => {
        const result = await client.callTool({ name: "list_services", arguments: {} });
        return { content: result.content };
      });
    }
  });

  api.registerTool({
    name: "janee_execute", 
    description: "Execute an API request through Janee with stored credentials. Use janee_list_services first to see available services. All requests are logged for audit.",
    parameters: Type.Object({
      service: Type.String({ description: "Service name from janee_list_services (e.g., 'stripe', 'github', 'bybit')" }),
      method: Type.String({ description: "HTTP method: GET, POST, PUT, DELETE, PATCH" }),
      path: Type.String({ description: "API path (e.g., '/v1/customers' for Stripe)" }),
      body: Type.Optional(Type.String({ description: "Request body as JSON string" })),
      reason: Type.Optional(Type.String({ description: "Reason for this request (for audit logs, may be required for sensitive operations)" })),
    }),
    async execute(_id: string, params: any) {
      return await callWithReconnect(api, async (client) => {
        const result = await client.callTool({ 
          name: "execute", 
          arguments: {
            capability: params.service,
            method: params.method,
            path: params.path,
            body: params.body,
            reason: params.reason,
          }
        });
        return { content: result.content };
      });
    }
  });

  api.registerTool({
    name: "janee_reload_config",
    description: "Reload Janee configuration from disk. Use after adding or modifying services in ~/.janee/config.yaml to pick up changes without restarting.",
    parameters: Type.Object({}),
    async execute() {
      return await callWithReconnect(api, async (client) => {
        const result = await client.callTool({ name: "reload_config", arguments: {} });
        return { content: result.content };
      });
    }
  });

  // Clean up on shutdown
  api.on?.("shutdown", async () => {
    if (mcpClient) {
      await mcpClient.close();
      mcpClient = null;
    }
  });
}

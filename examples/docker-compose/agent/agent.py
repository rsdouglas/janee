"""
Minimal agent that connects to Janee over HTTP.

This demonstrates the MCP Streamable HTTP transport —
the agent calls Janee's MCP tools to access APIs
without ever having the credentials.
"""

import os
import json
import httpx

JANEE_URL = os.environ.get("JANEE_URL", "http://localhost:9100")


def mcp_call(method: str, params: dict | None = None) -> dict:
    """Send a JSON-RPC request to Janee's MCP endpoint."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params or {},
    }
    resp = httpx.post(f"{JANEE_URL}/mcp", json=payload, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    # 1. List available services
    print("=== Available services ===")
    result = mcp_call("tools/call", {
        "name": "list_services",
        "arguments": {}
    })
    print(json.dumps(result, indent=2))

    # 2. Make an API call through Janee (example: Stripe balance)
    print("\n=== Calling Stripe API through Janee ===")
    result = mcp_call("tools/call", {
        "name": "execute",
        "arguments": {
            "capability": "stripe",
            "method": "GET",
            "path": "/v1/balance",
            "reason": "Check account balance"
        }
    })
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

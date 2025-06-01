# SPDX-License-Identifier: Apache-2.0

import os
import asyncio
from typing import Dict, Any, List
from agntcy_mcp import MultiServerMCPClient
from rich.console import Console
from rich.panel import Panel

console = Console()

async def get_github_tools() -> List[Dict[str, Any]]:
    """Get GitHub tools from MCP server."""
    try:
        server_path = os.getenv("GITHUB_SERVER_PATH", "./agent_github/protocol_bindings/mcp_server/mcp_github/server.py")
        console.print(f"[info]Launching MCP server at: {server_path}[/info]")

        github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN")
        if not github_token:
            raise ValueError("GITHUB_PERSONAL_ACCESS_TOKEN must be set as an environment variable.")

        github_api_url = os.getenv("GITHUB_API_URL", "https://api.github.com")
        if not github_api_url:
            raise ValueError("GITHUB_API_URL must be set as an environment variable.")

        client = MultiServerMCPClient(
            {
                "github": {
                    "command": "uv",
                    "args": ["run", server_path],
                    "env": {
                        "GITHUB_PERSONAL_ACCESS_TOKEN": github_token,
                        "GITHUB_API_URL": github_api_url,
                        "GITHUB_VERIFY_SSL": "true"
                    },
                    "transport": "stdio",
                }
            }
        )
        tools = await client.get_tools()
        console.print("[success]Successfully retrieved GitHub tools[/success]")
        return tools
    except Exception as e:
        console.print(Panel(
            f"[error]Error getting GitHub tools: {str(e)}[/error]",
            title="[error]Error[/error]",
            border_style="error"
        ))
        return []

if __name__ == "__main__":
    async def main():
        tools = await get_github_tools()
        if tools:
            console.print("\n[info]Available GitHub Tools:[/info]")
            for tool in tools:
                console.print(f"- {tool.get('name', 'Unknown')}: {tool.get('description', 'No description')}")

    asyncio.run(main())

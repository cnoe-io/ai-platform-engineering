import asyncio
import os
from mcp.server.fastmcp import FastMCP
from langchain_mcp_adapters.tools import to_fastmcp
from core import utils
from core.agent.tools import ALL_READ_TOOLS

logging = utils.get_logger("mcp-server")

# Convert langchain tools to MCP tools
mcp_tools = [to_fastmcp(tool) for tool in ALL_READ_TOOLS]

class MCPServer:
    """
    MCP server for the Nexus graph database tools.
    This server provides an interface to the graph database tools via MCP.
    """
    def __init__(self):
        self.server = FastMCP("Graph database tools", tools=mcp_tools, host="0.0.0.0", port=os.getenv("MCP_PORT", 8999))

    async def start(self, transport: str = "stdio"):
        """
        Start the MCP server with the specified transport.
        :param transport: The transport method to use (default is 'stdio').
        """
        if transport == "stdio":
            logging.info("Running MCP server with stdio transport...")
            await self.server.run_stdio_async()
        elif transport == "sse":
            logging.info("Running MCP server with SSE transport...")
            await self.server.run_sse_async()
        elif transport == "streamable-http":
            logging.info("Running MCP server with streamable HTTP transport...")
            await self.server.run_streamable_http_async()
        else:
            raise ValueError(f"Unsupported transport method: {transport}")

def run():
    mcp = MCPServer()
    asyncio.run(mcp.start(transport="sse"))

if __name__ == "__main__":
    run()
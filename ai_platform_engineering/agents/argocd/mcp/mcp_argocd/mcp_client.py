import asyncio
from fastmcp import Client
from fastmcp.client.transports import SSETransport
import pprint
import json

async def list_tools():
  async with Client(
    transport=SSETransport("http://127.0.0.1:8000/sse")
  ) as client:
    # await client.ping()
    async with client:
        tools = await client.list_tools()
        for tool in tools:
            print(f"Tool Name: {tool.name}")
            print(f"Tool Description: {tool.description}")
            print("-" * 40)
        result = await client.call_tool("version_service__version")
        pprint.pprint(json.loads(result[0].text))

if __name__ == "__main__":
  asyncio.run(list_tools())
import os

from mcp import ClientSession, StdioServerParameters
from mcp.client.sse import sse_client

# Create server parameters for stdio connection
server_params = StdioServerParameters(
    command="python",  # Executable
    args=["example_server.py"],  # Optional command line arguments
    env=None,  # Optional environment variables
)


async def run():
    async with sse_client(
        url="http://localhost:8000/sse",
    ) as (read, write), ClientSession(read, write) as session:
        # Initialize the connection
        await session.initialize()

        # List available tools
        tools = await session.list_tools()
        print(tools)

        # Call a tool
        result = await session.call_tool("echo", arguments={"message": "Hello, world!"})
        print(result)

        # List available resources
        resources = await session.list_resources()
        print(resources)

        # Read a resource
        resource = await session.read_resource("example://resource")
        print(resource)

        # List available prompts
        prompts = await session.list_prompts()
        print(prompts)

        # Get a prompt
        prompt = await session.get_prompt("example_prompt", arguments={"arg1": "value"})
        print(prompt)


if __name__ == "__main__":
    import asyncio

    asyncio.run(run())
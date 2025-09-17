from fastmcp import FastMCP
from typing import Optional
import os

from tools import (
    BudgetDuration,
    create_user,
    generate_key,
    list_models,
    list_model_names,
    list_projects,
)
from resources import list_users


def main():
    """Main entry point for the MCP server."""
    # Get MCP configuration from environment variables
    MCP_MODE = os.getenv("MCP_MODE", "STDIO")

    # Get host and port for server
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    SERVER_NAME = os.getenv("SERVER_NAME", "LITELLM")

    # Create server instance
    if MCP_MODE.lower() in ["sse", "http"]:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server")


    @mcp.tool()
    async def create_litellm_user(name: str, email: str) -> str:
        """Create a new user in LiteLLM."""
        return await create_user(name, email)


    @mcp.tool()
    async def list_litellm_projects(user_id: Optional[str] = None) -> str:
        """List all projects/teams in LiteLLM with optional user filtering."""
        return await list_projects(user_id)


    @mcp.tool()
    async def generate_litellm_key(
        user_id: str,
        team_id: str,
        model: str,
        budget: float = 50.0,
        duration: str = "monthly",
    ) -> str:
        """Generate a new API key in LiteLLM with budget and duration limits."""
        # Convert string duration to enum
        try:
            duration_enum = BudgetDuration(duration.lower())
        except ValueError:
            valid_durations = [d.value for d in BudgetDuration]
            return f'{{"success": false, "error": "Invalid duration. Must be one of: {valid_durations}"}}'

        return await generate_key(user_id, team_id, model, budget, duration_enum)


    @mcp.tool()
    async def list_litellm_models() -> str:
        """List all available models in LiteLLM with detailed information."""
        return await list_models()


    @mcp.tool()
    async def list_litellm_model_names() -> str:
        """List only the names of available models in LiteLLM (simplified output)."""
        return await list_model_names()


    @mcp.resource("litellm://users")
    async def get_users_resource() -> str:
        """Resource: Get all users."""
        return await list_users()


    # Run the MCP server
    mcp.run(transport=MCP_MODE.lower())



if __name__ == "__main__":
    main()

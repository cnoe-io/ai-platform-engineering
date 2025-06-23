# AUTO-GENERATED CODE - DO NOT MODIFY
# Generated on May 16th using openapi_mcp_generator package
# Modified for enhanced environment variable support

#!/usr/bin/env python3
"""
Petstore MCP Server

This server provides a Model Context Protocol (MCP) interface to the Petstore,
allowing large language models and AI assistants to interact with the service.
"""
import logging
import os
import sys
from dotenv import load_dotenv, find_dotenv

from mcp.server.fastmcp import FastMCP

# Import tools
from mcp_petstore.tools import pet
from mcp_petstore.tools import pet_findByStatus
from mcp_petstore.tools import pet_findByTags
from mcp_petstore.tools import store_inventory
from mcp_petstore.tools import store_order
from mcp_petstore.tools import user
from mcp_petstore.tools import user_createWithList
from mcp_petstore.tools import user_login
from mcp_petstore.tools import user_logout

# Start server when run directly
def main():
    # Load environment variables from all possible .env locations
    # env_path = find_dotenv(usecwd=True)
    # if env_path:
    #     logging.info(f"Loading environment variables from: {env_path}")
    #     load_dotenv(env_path)
    # else:
    #     logging.warning("No .env file found, using default environment variables")
    #     load_dotenv()  # Still try the default locations
    #
    #Going to hardcode the environment variables for logic testing purposes

    # Configure logging
    logging.basicConfig(level=logging.DEBUG)

    # Get MCP configuration from environment variables
    MCP_MODE = "STDIO"#os.getenv("MCP_MODE", "STDIO")
    
    # Get host and port for server
    MCP_HOST = "localhost"#os.getenv("MCP_HOST", "localhost")
    MCP_PORT = "8000"#int(os.getenv("MCP_PORT", "8000"))
    
    logging.info(f"Starting Pet Store MCP server in {MCP_MODE} mode on {MCP_HOST}:{MCP_PORT}")
    
    # Get agent name from environment variables
    AGENT_NAME = "Petstore"#os.getenv("AGENT_NAME", "Pet Store")
    logging.info(f"Agent name: {AGENT_NAME}")
    
    # Set MCP environment variables from PetStore environment variables if they exist
    petstore_api_key = "special-key"#os.getenv("PETSTORE_API_KEY")
    # if petstore_api_key and not os.getenv("MCP_API_KEY"):
    #     os.environ["MCP_API_KEY"] = petstore_api_key
    #     logging.info("Using PETSTORE_API_KEY as MCP_API_KEY")

    petstore_api_url = "https://petstore.swagger.io/v2"#os.getenv("PETSTORE_API_URL")
    # if petstore_api_url and not os.getenv("MCP_API_URL"):
    #     os.environ["MCP_API_URL"] = petstore_api_url
    #     logging.info("Using PETSTORE_API_URL as MCP_API_URL")
    
    # Log all relevant environment variables for debugging
    logging.debug(f"MCP_MODE: {MCP_MODE}")
    logging.debug(f"MCP_HOST: {MCP_HOST}")
    logging.debug(f"MCP_PORT: {MCP_PORT}")
    logging.debug(f"MCP_API_URL: {petstore_api_url}")#{os.getenv('MCP_API_URL', 'Not set')}")
    logging.debug(f"PETSTORE_API_URL: {petstore_api_url}")#{os.getenv('PETSTORE_API_URL', 'Not set')}")

    # Create server instance based on mode
    if MCP_MODE == "SSE":
        mcp = FastMCP(f"{AGENT_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
        logging.info(f"Started MCP server in SSE mode at http://{MCP_HOST}:{MCP_PORT}")
    else:
        mcp = FastMCP(f"{AGENT_NAME} MCP Server")
        logging.info(f"Started MCP server in STDIO mode")
    
    # Register pet tools
    mcp.tool()(pet.updatePet)
    mcp.tool()(pet.addPet)
    
    # Register pet_findByStatus tools
    mcp.tool()(pet_findByStatus.findPetsByStatus)
    
    # Register pet_findByTags tools
    mcp.tool()(pet_findByTags.findPetsByTags)
    
    # Register store_inventory tools
    mcp.tool()(store_inventory.getInventory)
    
    # Register store_order tools
    mcp.tool()(store_order.placeOrder)
    
    # Register user tools
    mcp.tool()(user.createUser)
    
    # Register user_createWithList tools
    mcp.tool()(user_createWithList.createUsersWithListInput)
    
    # Register user_login tools
    mcp.tool()(user_login.loginUser)
    
    # Register user_logout tools
    mcp.tool()(user_logout.logoutUser)
    
    # Log that all tools are registered
    logging.info("All PetStore tools registered successfully")
    
    # Run the MCP server
    logging.info("Starting the MCP server loop")
    mcp.run()

if __name__ == "__main__":
    main()

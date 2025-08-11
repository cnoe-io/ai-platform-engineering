#!/usr/bin/env python3
"""
Slack MCP Server

This server provides a Model Context Protocol (MCP) interface to the Slack API,
allowing large language models and AI assistants to interact with Slack channels,
messages, and users through a standardized tool interface.
"""
import os
import logging
from dotenv import load_dotenv
from fastmcp import FastMCP

# Import tools
from mcp_slack.tools import channels
from mcp_slack.tools import messages
from mcp_slack.tools import files
from mcp_slack.tools import users


def main():
    """
    Main entry point for the Slack MCP server.
    This function initializes the server, loads configuration from environment variables,
    and registers the necessary tools for managing PagerDuty resources.
    """

    # Load environment variables from .env file
    load_dotenv()

    # Configure logging
    logging.basicConfig(level=logging.DEBUG)

    # Get MCP configuration from environment variables
    MCP_MODE = os.getenv("MCP_MODE", "STDIO")

    # Get host and port for server
    MCP_HOST = os.getenv("MCP_HOST", "localhost")
    MCP_PORT = int(os.getenv("MCP_PORT", "8000"))

    logging.info(f"Starting MCP server in {MCP_MODE} mode on {MCP_HOST}:{MCP_PORT}")

    # Get agent name from environment variables
    SERVER_NAME = os.getenv("AGENT_NAME", "Slack")
    logging.info('*'*40)
    logging.info(f"MCP Server name: {SERVER_NAME}")
    logging.info('*'*40)

    # Create server instance
    if MCP_MODE.lower() in ["sse", "http"]:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server")


    # Register channel tools
    mcp.tool()(channels.list_channels)
    mcp.tool()(channels.join_channel)
    mcp.tool()(channels.leave_channel)
    mcp.tool()(channels.get_channel_info)

    # Register message tools
    mcp.tool()(messages.list_messages)
    mcp.tool()(messages.post_message)
    mcp.tool()(messages.reply_to_thread)
    mcp.tool()(messages.update_message)
    mcp.tool()(messages.delete_message)
    mcp.tool()(messages.add_reaction)
    mcp.tool()(messages.remove_reaction)

    # Register file tools
    mcp.tool()(files.list_files)
    mcp.tool()(files.upload_file)
    mcp.tool()(files.get_file_info)
    mcp.tool()(files.delete_file)

    # Register user tools
    mcp.tool()(users.list_users)
    mcp.tool()(users.get_user_info)
    mcp.tool()(users.set_user_status)

    # Run the MCP server
    logging.info("="*40)
    mcp.run(transport=MCP_MODE.lower())
    logging.info("="*40)

# Start server when run directly
if __name__ == "__main__":
    main()
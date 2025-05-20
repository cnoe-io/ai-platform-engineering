#!/usr/bin/env python3
"""
Slack MCP Server

This server provides a Model Context Protocol (MCP) interface to the Slack API,
allowing large language models and AI assistants to interact with Slack channels,
messages, and users through a standardized tool interface.
"""

import logging
import os
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# Import tools
from agent_slack.protocol_bindings.mcp_server.mcp_slack.tools import channels
from agent_slack.protocol_bindings.mcp_server.mcp_slack.tools import messages
from agent_slack.protocol_bindings.mcp_server.mcp_slack.tools import files
from agent_slack.protocol_bindings.mcp_server.mcp_slack.tools import users



# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.INFO)

# Create server instance
mcp = FastMCP("Slack MCP Server")

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

# Start server when run directly
if __name__ == "__main__":
    mcp.run(transport="stdio")
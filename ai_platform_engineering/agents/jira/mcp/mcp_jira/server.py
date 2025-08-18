#!/usr/bin/env python3
"""
Jira MCP Server

This server provides a Model Context Protocol (MCP) interface to the Jira API,
allowing large language models and AI assistants to manage Jira resources.
"""
import os
import logging
from dotenv import load_dotenv
from fastmcp import FastMCP

# Import tools
from mcp_jira.tools.jira import attachments
from mcp_jira.tools.jira import issues
from mcp_jira.tools.jira import users
from mcp_jira.tools.jira import search
from mcp_jira.tools.jira import transitions
from mcp_jira.tools.jira import worklog
from mcp_jira.tools.jira import boards
from mcp_jira.tools.jira import sprints
from mcp_jira.tools.jira import links

def main():
    # Load environment variables
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
    SERVER_NAME = os.getenv("SERVER_NAME", "JIRA")
    logging.info('*'*40)
    logging.info(f"MCP Server name: {SERVER_NAME}")
    logging.info('*'*40)

    # Create server instance
    if MCP_MODE.lower() in ["sse", "http"]:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server", host=MCP_HOST, port=MCP_PORT)
    else:
        mcp = FastMCP(f"{SERVER_NAME} MCP Server")

    # Register Jira tools
    mcp.tool()(attachments.upload_attachment)
    mcp.tool()(attachments.download_attachment)
    mcp.tool()(attachments.get_issue_attachments)
    mcp.tool()(users.get_current_user_account_id)
    mcp.tool()(users.handle_user_operations)
    mcp.tool()(issues.get_issue)
    mcp.tool()(issues.get_board_issues)
    mcp.tool()(issues.get_project_issues)
    mcp.tool()(issues.create_issue)
    mcp.tool()(issues.create_issue_link)
    mcp.tool()(issues.remove_issue_link)
    mcp.tool()(search.search)
    mcp.tool()(search.search_fields)
    mcp.tool()(transitions.get_transitions)
    mcp.tool()(transitions.transition_issue)
    mcp.tool()(worklog.get_worklog)
    mcp.tool()(worklog.add_worklog)
    mcp.tool()(boards.get_agile_boards)
    mcp.tool()(sprints.get_sprints_from_board)
    mcp.tool()(sprints.create_sprint)
    mcp.tool()(sprints.update_sprint)
    mcp.tool()(links.get_link_types)
    mcp.tool()(links.link_to_epic)
    mcp.tool()(issues.create_issue)

    # Run the MCP server
    mcp.run(transport=MCP_MODE.lower())
    logging.info("="*40)
    logging.info(f"{SERVER_NAME} MCP server started successfully.")
    logging.info("="*40)

# Start server when run directly
if __name__ == "__main__":
    main()
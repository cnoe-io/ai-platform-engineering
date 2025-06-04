#!/usr/bin/env python3
"""
Atlassian MCP Server

This server provides a Model Context Protocol (MCP) interface to the Atlassian API,
allowing large language models and AI assistants to manage Atlassian resources.
"""
import logging
from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP

# Import tools
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import attachments
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import issues
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import users
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import search
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import transitions
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import worklog
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import boards
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import sprints
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import links


from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import comments
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import labels
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import search as search_confluence
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import pages


'''
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import epics
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import comments
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import fields
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import formatting
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import projects
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.jira import protocols
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import spaces
from agent_atlassian.protocol_bindings.mcp_server.mcp_atlassian.tools.confluence import utils'''


# Load environment variables from .env file
load_dotenv()

# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Create server instance
mcp = FastMCP("atlassian MCP Server")

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


# Register Confluence tools

mcp.tool()(pages.get_page)
mcp.tool()(pages.create_page)
mcp.tool()(pages.update_page)
mcp.tool()(pages.delete_page)
mcp.tool()(pages.get_page_children)
mcp.tool()(comments.get_comments)
mcp.tool()(comments.add_comment)
mcp.tool()(labels.add_label)
mcp.tool()(labels.get_labels)
mcp.tool()(search_confluence.search_confluence)


'''
mcp.tool()(boards.get_board_details)
mcp.tool()(epics.get_epic)
mcp.tool()(epics.link_issue_to_epic)
mcp.tool()(comments.get_comments)
mcp.tool()(comments.add_comment)
mcp.tool()(fields.get_fields)
mcp.tool()(formatting.format_issue)
mcp.tool()(issues.get_issues)
mcp.tool()(issues.create_issue)
mcp.tool()(issues.update_issue)
mcp.tool()(links.create_link)
mcp.tool()(projects.get_projects)
mcp.tool()(protocols.execute_protocol)
mcp.tool()(search.search_issues)
mcp.tool()(sprints.start_sprint)
mcp.tool()(sprints.complete_sprint)
mcp.tool()(users.search_users)
mcp.tool()(worklog.get_worklogs)'''

'''


mcp.tool()(spaces.get_spaces)
mcp.tool()(spaces.get_space_details)
mcp.tool()(utils.format_page)'''

# Start server when run directly
if __name__ == "__main__":
    mcp.run() 
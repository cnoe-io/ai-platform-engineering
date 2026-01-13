"""
Multi-agent tools package.

Contains shared tools used across multiple agents.
"""

from ai_platform_engineering.multi_agents.tools.reflect_on_output import reflect_on_output
from ai_platform_engineering.multi_agents.tools.format_markdown import format_markdown
from ai_platform_engineering.multi_agents.tools.fetch_url import fetch_url
from ai_platform_engineering.multi_agents.tools.get_current_date import get_current_date
from ai_platform_engineering.multi_agents.tools.workspace_ops import (
    write_workspace_file,
    read_workspace_file,
    list_workspace_files,
    clear_workspace
)
# Note: git_* tools moved to ai_platform_engineering/agents/github/agent_github/tools.py
from ai_platform_engineering.multi_agents.tools.grep_tool import (
    grep_search,
    grep_count
)
from ai_platform_engineering.multi_agents.tools.wget_tool import (
    wget_download,
    wget_mirror
)
from ai_platform_engineering.multi_agents.tools.curl_tool import (
    curl_request,
    curl_download
)
from ai_platform_engineering.multi_agents.tools.glob_tool import (
    glob_find,
    glob_expand,
    glob_test
)

__all__ = [
    'reflect_on_output',
    'format_markdown',
    'fetch_url',
    'get_current_date',
    'write_workspace_file',
    'read_workspace_file',
    'list_workspace_files',
    'clear_workspace',
    # git_* tools moved to github agent
    'grep_search',
    'grep_count',
    'wget_download',
    'wget_mirror',
    'curl_request',
    'curl_download',
    'glob_find',
    'glob_expand',
    'glob_test'
]










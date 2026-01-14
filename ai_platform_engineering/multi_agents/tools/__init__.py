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
# Import git_* tools from utils (supports both GitHub and GitLab authentication)
# This allows chaining: git_clone → grep_search → glob_find workflows
from ai_platform_engineering.utils.git_tools import (
    git_clone,
    git_status,
    git_log,
    git_branch,
    git_diff,
    git_show,
    git_remote,
    git_pull,
    git_fetch,
)
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
    # git_* tools (from utils - supports GitHub and GitLab auth)
    'git_clone',
    'git_status',
    'git_log',
    'git_branch',
    'git_diff',
    'git_show',
    'git_remote',
    'git_pull',
    'git_fetch',
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










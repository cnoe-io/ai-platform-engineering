"""
Multi-agent tools package.

Contains shared tools used across multiple agents.

Command-line tools are in utils/agent_tools/ for use by all agents:
- git: Run any git command with auto auth
- curl: Run any curl command
- wget: Run any wget command
- grep: Run any grep command
- glob_find: Find files with glob patterns
- fetch_url: Fetch content from public URLs
- jq: Process JSON data
- yq: Process YAML data
- read_file, write_file, append_file, list_files: File I/O
"""

from ai_platform_engineering.multi_agents.tools.reflect_on_output import reflect_on_output
from ai_platform_engineering.multi_agents.tools.format_markdown import format_markdown
from ai_platform_engineering.multi_agents.tools.get_current_date import get_current_date
from ai_platform_engineering.multi_agents.tools.request_user_input import request_user_input
from ai_platform_engineering.multi_agents.tools.workspace_ops import (
    write_workspace_file,
    read_workspace_file,
    list_workspace_files,
    clear_workspace
)

# Command-line tools from utils/agent_tools/ (available to all agents)
from ai_platform_engineering.utils.agent_tools import (
    git,
    curl,
    wget,
    grep,
    glob_find,
    fetch_url,
    jq,
    yq,
    read_file,
    write_file,
    append_file,
    list_files,
)

__all__ = [
    # Core utilities
    'reflect_on_output',
    'format_markdown',
    'fetch_url',
    'get_current_date',
    'request_user_input',  # Structured user input tool
    'write_workspace_file',
    'read_workspace_file',
    'list_workspace_files',
    'clear_workspace',

    # Command-line tools (pass full shell command)
    'git',          # git("git clone https://github.com/org/repo")
    'curl',         # curl("curl -sL https://example.com/api")
    'wget',         # wget("wget -O out.txt https://example.com")
    'grep',         # grep("grep -rn pattern /path")
    'glob_find',    # glob_find("**/*.py")

    # Data processing tools
    'jq',           # jq("jq '.items[].name' data.json")
    'yq',           # yq("yq '.spec.replicas' deployment.yaml")

    # File I/O tools
    'read_file',    # read_file("/tmp/data.json")
    'write_file',   # write_file("/tmp/out.json", content)
    'append_file',  # append_file("/tmp/log.txt", "entry\n")
    'list_files',   # list_files("/tmp/repo", pattern="*.yaml")
]

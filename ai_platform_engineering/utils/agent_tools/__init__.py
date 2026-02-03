# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Agent Tools - Common command-line tools for all agents.

These tools are available to all agents (argocd, github, jira, etc.)
for executing shell commands, fetching URLs, file I/O, and data processing.

Usage:
    from ai_platform_engineering.utils.agent_tools import (
        git, curl, wget, grep, glob_find, fetch_url, jq, yq,
        read_file, write_file, append_file, list_files
    )
"""

from ai_platform_engineering.utils.agent_tools.git_tool import git
from ai_platform_engineering.utils.agent_tools.curl_tool import curl
from ai_platform_engineering.utils.agent_tools.wget_tool import wget
from ai_platform_engineering.utils.agent_tools.grep_tool import grep
from ai_platform_engineering.utils.agent_tools.glob_tool import glob_find
from ai_platform_engineering.utils.agent_tools.fetch_url_tool import fetch_url
from ai_platform_engineering.utils.agent_tools.jq_tool import jq
from ai_platform_engineering.utils.agent_tools.yq_tool import yq
from ai_platform_engineering.utils.agent_tools.file_tool import (
    read_file,
    write_file,
    append_file,
    list_files,
    edit_file,
)

__all__ = [
    # Network/Download tools
    'git',        # git("git clone https://...", cwd=...)
    'curl',       # curl("curl -s https://...")
    'wget',       # wget("wget -O file.txt https://...")
    'fetch_url',  # fetch_url("https://docs.example.com")

    # Search/Find tools
    'grep',       # grep("grep -r pattern .")
    'glob_find',  # glob_find("**/*.py")

    # Data processing tools
    'jq',         # jq("jq '.items[].name' data.json")
    'yq',         # yq("yq '.spec.replicas' deployment.yaml")

    # File I/O tools
    'read_file',   # read_file("/tmp/data.json")
    'write_file',  # write_file("/tmp/out.json", content)
    'append_file', # append_file("/tmp/log.txt", "entry\n")
    'list_files',  # list_files("/tmp/repo", pattern="*.yaml")
    'edit_file',   # edit_file("/tmp/config.yaml", "old: value", "new: value")
]

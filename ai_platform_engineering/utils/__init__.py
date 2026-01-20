# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
AI Platform Engineering Utilities

This package contains common utilities, base classes, and shared functionality
for AI Platform Engineering agents and applications.

Command-line tools (available to all agents):
  from ai_platform_engineering.utils.agent_tools import git, curl, wget, grep, glob_find, fetch_url

Base classes:
  from ai_platform_engineering.utils.a2a_common.base_agent import BaseLangGraphAgent
  from ai_platform_engineering.utils.a2a_common.base_strands_agent import BaseStrandsAgent
"""

# Re-export agent_tools for convenience
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
    # Command-line tools (from agent_tools/)
    'git',
    'curl',
    'wget',
    'grep',
    'glob_find',
    'fetch_url',
    'jq',
    'yq',
    # File I/O tools
    'read_file',
    'write_file',
    'append_file',
    'list_files',
]

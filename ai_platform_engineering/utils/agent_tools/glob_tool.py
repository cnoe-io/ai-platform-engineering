# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Glob Tool - File pattern matching.

Provides a single `glob_find` tool for finding files using glob patterns.
Available to all agents (argocd, github, jira, etc.).

Based on UNIX glob(7) specification:
- '?' matches any single character
- '*' matches any string
- '**' matches directories recursively
- '[abc]' matches character class
- '[!abc]' matches complement
"""

import glob as glob_module
import os
from pathlib import Path
from typing import Optional

from langchain_core.tools import tool


@tool
def glob_find(
    pattern: str,
    cwd: Optional[str] = None,
    recursive: bool = True,
    include_hidden: bool = False,
    files_only: bool = False,
    dirs_only: bool = False,
    limit: int = 1000,
) -> str:
    """
    Find files and directories matching a glob pattern.

    Args:
        pattern: Glob pattern (e.g., "*.py", "**/*.js")
        cwd: Directory to search in (default: current directory)
        recursive: Enable ** for recursive matching (default: True)
        include_hidden: Include hidden files (default: False)
        files_only: Return only files (default: False)
        dirs_only: Return only directories (default: False)
        limit: Maximum results (default: 1000)

    Returns:
        Newline-separated list of matching paths. "No matches found" if none.
        "ERROR: <message>" on error.

    Examples:
        glob_find("**/*.py")
        glob_find("*.yaml", cwd="/path/to/config")
        glob_find("**/test_*.py")
    """
    try:
        original_cwd = os.getcwd()
        if cwd:
            os.chdir(cwd)

        try:
            matches = glob_module.glob(pattern, recursive=recursive)

            # Filter hidden files
            if not include_hidden:
                matches = [
                    m for m in matches
                    if not any(part.startswith('.') for part in Path(m).parts)
                ]

            # Filter by type
            if files_only:
                matches = [m for m in matches if os.path.isfile(m)]
            elif dirs_only:
                matches = [m for m in matches if os.path.isdir(m)]

            # Sort and limit
            matches.sort()
            truncated = len(matches) > limit
            matches = matches[:limit]

            # Convert to absolute if we changed cwd
            if cwd:
                matches = [os.path.abspath(m) for m in matches]

            if not matches:
                return "No matches found"

            result = '\n'.join(matches)
            if truncated:
                result += f"\n... (truncated, showing {limit} of more results)"
            return result

        finally:
            if cwd:
                os.chdir(original_cwd)

    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['glob_find']

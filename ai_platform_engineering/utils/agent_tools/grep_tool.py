# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Grep Tool - Generic text pattern search executor.

Provides a single `grep` tool that can run any grep command.
Available to all agents (argocd, github, jira, etc.).
"""

import shlex
import subprocess

from langchain_core.tools import tool


GREP_TIMEOUT = 60  # 1 minute default


@tool
def grep(
    command: str,
    timeout: int = GREP_TIMEOUT,
) -> str:
    """
    Execute any grep command for text pattern searching.

    Args:
        command: Grep command to run (e.g., "grep -r TODO .")
        timeout: Command timeout in seconds (default: 60)

    Returns:
        Matching lines as string. "No matches found" if none. "ERROR: <message>" on error.

    Examples:
        grep("grep -r 'TODO' src/")
        grep("grep -rn 'function' *.py")
        grep("grep -ri 'error' /var/log/")

    Common Options:
        -r, --recursive    Search directories recursively
        -i, --ignore-case  Case-insensitive search
        -n, --line-number  Show line numbers
        -l, --files-with-matches  Show only filenames
        -c, --count        Count matches per file
    """
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Failed to parse command: {e}"

    # Ensure command starts with 'grep'
    if not args or args[0] != 'grep':
        args = ['grep'] + args

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        output = result.stdout.strip()

        # grep returns 0 for matches, 1 for no matches, >1 for errors
        if result.returncode > 1:
            return f"ERROR: {result.stderr}" if result.stderr else "ERROR: grep command failed"

        if result.returncode == 1:
            return "No matches found"

        return output if output else "No matches found"

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: grep command not found - ensure grep is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['grep']

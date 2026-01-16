# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Wget Tool - Generic file download executor.

Provides a single `wget` tool that can run any wget command.
Available to all agents (argocd, github, jira, etc.).
"""

import shlex
import subprocess

from langchain_core.tools import tool


WGET_TIMEOUT = 600  # 10 minutes default


@tool
def wget(
    command: str,
    timeout: int = WGET_TIMEOUT,
) -> str:
    """
    Execute any wget command for downloading files.

    Args:
        command: Wget command to run (e.g., "wget https://example.com/file.zip")
        timeout: Command timeout in seconds (default: 600)

    Returns:
        Command output as string. On error, returns "ERROR: <message>"

    Examples:
        wget("wget https://example.com/file.zip")
        wget("wget -O /tmp/myfile.zip https://example.com/file.zip")
        wget("wget -q https://example.com/file.zip")

    Common Options:
        -O, --output-document   Write to specified file
        -P, --directory-prefix  Save to specified directory
        -q, --quiet            Quiet mode (no output)
        -c, --continue         Resume partial download
    """
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Failed to parse command: {e}"

    # Ensure command starts with 'wget'
    if not args or args[0] != 'wget':
        args = ['wget'] + args

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        # wget outputs to stderr by default
        output = result.stdout
        if result.stderr:
            if output:
                output += '\n' + result.stderr
            else:
                output = result.stderr

        if result.returncode != 0:
            return f"ERROR: {output}" if output else "ERROR: Download failed"

        return output if output else "Success (download completed)"

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: wget command not found - ensure wget is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['wget']

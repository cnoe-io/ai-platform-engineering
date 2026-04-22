# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Curl Tool - Generic HTTP request executor.

Provides a single `curl` tool that can run any curl command.
Available to all agents (argocd, github, jira, etc.).
"""

import shlex
import subprocess

from langchain_core.tools import tool


CURL_TIMEOUT = 300  # 5 minutes default


@tool
def curl(
    command: str,
    timeout: int = CURL_TIMEOUT,
) -> str:
    """
    Execute any curl command for HTTP requests.

    Args:
        command: Curl command to run (e.g., "curl -s https://api.example.com/users")
        timeout: Command timeout in seconds (default: 300)

    Returns:
        Command output as string. On error, returns "ERROR: <message>"

    Examples:
        curl("curl -s https://api.example.com/users")
        curl("curl -sL https://example.com/redirect")
        curl("curl -s -X POST -H 'Content-Type: application/json' -d '{\"name\":\"test\"}' https://api.example.com/users")

    Common Options:
        -s, --silent      Silent mode (no progress)
        -L, --location    Follow redirects
        -X, --request     HTTP method (GET, POST, PUT, DELETE, etc.)
        -H, --header      Add header
        -d, --data        POST data
        -o, --output      Write output to file
    """
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Failed to parse command: {e}"

    # Ensure command starts with 'curl'
    if not args or args[0] != 'curl':
        args = ['curl'] + args

    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        output = result.stdout
        if result.stderr:
            if output:
                output += '\n' + result.stderr
            else:
                output = result.stderr

        if result.returncode != 0:
            return f"ERROR: {output}" if output else "ERROR: Command failed"

        return output if output else "Success (no output)"

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: curl command not found - ensure curl is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['curl']

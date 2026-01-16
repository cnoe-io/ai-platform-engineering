# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
jq Tool - JSON processor.

Provides a single `jq` tool that can run any jq command.
Useful for parsing JSON output from APIs, kubectl, etc.
Available to all agents (argocd, github, jira, etc.).
"""

import shlex
import subprocess

from langchain_core.tools import tool


JQ_TIMEOUT = 60  # 1 minute default


@tool
def jq(
    command: str,
    timeout: int = JQ_TIMEOUT,
) -> str:
    """
    Execute any jq command for JSON processing.

    Args:
        command: jq command to run (e.g., "jq '.items[] | .name' file.json")
        timeout: Command timeout in seconds (default: 60)

    Returns:
        Processed JSON output as string. On error, returns "ERROR: <message>"

    Examples:
        jq("jq '.' data.json")
        jq("jq '.items[].metadata.name' pods.json")
        jq("echo '{\"name\":\"test\"}' | jq '.name'")
        jq("jq -r '.status' response.json")

    Common Options:
        -r, --raw-output    Output raw strings (no quotes)
        -c, --compact       Compact output (one line)
        -s, --slurp         Read entire input into array
        -e, --exit-status   Exit with error if output is null/false
    """
    try:
        # Handle piped commands differently
        if '|' in command and not command.strip().startswith('jq'):
            # This is a shell pipeline like "echo '...' | jq ..."
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
        else:
            args = shlex.split(command)
            # Ensure command starts with 'jq'
            if not args or args[0] != 'jq':
                args = ['jq'] + args

            result = subprocess.run(
                args,
                capture_output=True,
                text=True,
                timeout=timeout
            )

        output = result.stdout.strip()

        if result.returncode != 0:
            error = result.stderr.strip() if result.stderr else "Unknown error"
            return f"ERROR: {error}"

        return output if output else "(empty result)"

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: jq command not found - ensure jq is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['jq']

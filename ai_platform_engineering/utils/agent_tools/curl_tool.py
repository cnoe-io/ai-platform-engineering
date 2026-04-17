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

# Flags that write to disk or read curl config files — disallow to prevent
# filesystem side-effects from LLM-generated commands.
_BLOCKED_FLAGS: frozenset[str] = frozenset({
    "-o", "--output",
    "--config", "-K",
})


def _validate_curl_args(args: list[str]) -> str | None:
    """Return an error string if args contain blocked flags or non-HTTPS URLs."""
    for token in args:
        # Block dangerous flags (exact token match handles both "-o file" and "--output=file")
        flag = token.split("=")[0]
        if flag in _BLOCKED_FLAGS:
            return f"ERROR: Flag '{flag}' is not allowed"

        # Block any non-HTTPS URL (anything containing a scheme)
        if "://" in token and not token.startswith("https://"):
            return f"ERROR: Only https:// URLs are allowed (got '{token.split('?')[0]}')"

    return None


@tool
def curl(
    command: str,
    timeout: int = CURL_TIMEOUT,
    strip_html: bool = False,
) -> str:
    """
    Execute any curl command for HTTP requests (https:// only).

    Args:
        command: Curl command to run (e.g., "curl -s https://api.example.com/users")
        timeout: Command timeout in seconds (default: 300)
        strip_html: If True, strip HTML tags and return plain text (useful for web pages)

    Returns:
        Command output as string. On error, returns "ERROR: <message>"

    Examples:
        curl("curl -s https://api.example.com/users")
        curl("curl -sL https://example.com/redirect")
        curl("curl -s -X POST -H 'Content-Type: application/json' -d '{\"name\":\"test\"}' https://api.example.com/users")
        curl("curl -s https://docs.example.com/guide", strip_html=True)

    Common Options:
        -s, --silent      Silent mode (no progress)
        -L, --location    Follow redirects
        -X, --request     HTTP method (GET, POST, PUT, DELETE, etc.)
        -H, --header      Add header
        -d, --data        POST data
    """
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Failed to parse command: {e}"

    # Ensure command starts with 'curl'
    if not args or args[0] != 'curl':
        args = ['curl'] + args

    error = _validate_curl_args(args[1:])
    if error:
        return error

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

        if not output:
            return "Success (no output)"

        if strip_html:
            try:
                from bs4 import BeautifulSoup  # noqa: PLC0415
                soup = BeautifulSoup(output, 'html.parser')
                for tag in soup(["script", "style"]):
                    tag.decompose()
                return soup.get_text(separator='\n', strip=True)
            except ImportError:
                pass  # bs4 not available, return raw output

        return output

    except subprocess.TimeoutExpired:
        return f"ERROR: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return "ERROR: curl command not found - ensure curl is installed"
    except Exception as e:
        return f"ERROR: {e}"


__all__ = ['curl']

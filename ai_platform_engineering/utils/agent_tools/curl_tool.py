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

def _validate_curl_args(args: list[str]) -> str | None:
    """Return a detailed user-facing message if args contain non-HTTPS URLs."""
    for token in args:
        if "://" in token and not token.startswith("https://"):
            scheme = token.split("://")[0] + "://"
            return (
                f"The URL scheme '{scheme}' is not supported.\n\n"
                "**Only `https://` URLs are allowed.** This tool does not support:\n"
                "- `http://` — unencrypted HTTP\n"
                "- `file://` — local filesystem access\n"
                "- `ftp://`, `gopher://`, or other protocols\n\n"
                f"Please use an `https://` endpoint instead of `{token.split('?')[0]}`."
            )

    return None


@tool
def curl(
    command: str,
    timeout: int = CURL_TIMEOUT,
    strip_html: bool = False,
) -> str:
    """
    Execute any curl command for HTTP requests (https:// only).

    Use this for all HTTP operations: GET, POST, PUT, PATCH, DELETE, file downloads,
    and fetching web page content.

    Args:
        command: Curl command to run (e.g., "curl -s https://api.example.com/users")
        timeout: Command timeout in seconds (default: 300)
        strip_html: If True, strip HTML tags and return plain text (useful for reading web pages)

    Returns:
        Command output as string. On error, returns "ERROR: <message>"

    Examples:
        # GET request
        curl("curl -s https://api.example.com/users")

        # PUT request with JSON body
        curl("curl -s -X PUT https://api.example.com/resource -H 'Content-Type: application/json' -d '{\"status\":\"done\"}'")

        # POST with auth header
        curl("curl -s -X POST https://api.example.com/items -H 'Authorization: Bearer TOKEN' -d '{\"name\":\"test\"}'")

        # Download a file (wget equivalent)
        curl("curl -sL -o /tmp/file.zip https://example.com/file.zip")

        # Read a web page as plain text (fetch_markdown equivalent)
        curl("curl -sL https://docs.example.com/guide", strip_html=True)

        # Follow redirects
        curl("curl -sL https://example.com/redirect")

    Common Options:
        -s, --silent      Silent mode (no progress bar)
        -L, --location    Follow redirects
        -X, --request     HTTP method (GET, POST, PUT, PATCH, DELETE)
        -H, --header      Add request header
        -d, --data        Request body
        -o, --output      Save response to file (wget-style download)
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

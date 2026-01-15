# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Git Tool - Generic git command executor with automatic authentication.

Provides a single `git` tool that can run any git command with automatic
GitHub/GitLab authentication for private repositories.

Supports:
- GitHub: Uses GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN
- GitLab: Uses GITLAB_PERSONAL_ACCESS_TOKEN or GITLAB_TOKEN

Security:
- All tokens are automatically sanitized from output
- Never logs or returns sensitive credentials
"""

import logging
import os
import re
import shlex
import subprocess
from typing import Any, Dict, List, Optional  # Dict/Any still used by _run_git_command
from urllib.parse import urlparse

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# Maximum execution time for git commands
GIT_TIMEOUT = int(os.getenv("GIT_MAX_EXECUTION_TIME", "300"))


def _get_all_tokens() -> List[str]:
    """Collect all configured tokens for sanitization."""
    tokens = []
    for env_var in [
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "GITHUB_TOKEN",
        "GITLAB_PERSONAL_ACCESS_TOKEN",
        "GITLAB_TOKEN",
        "GIT_TOKEN",
        "GH_TOKEN",
    ]:
        token = os.getenv(env_var)
        if token and len(token) > 4:
            tokens.append(token)
    return tokens


def _sanitize_output(text: str, tokens: Optional[List[str]] = None) -> str:
    """
    Remove authentication tokens from text to prevent credential leakage.

    CRITICAL: Called on ALL output before returning to LLM/agent.
    """
    if not text:
        return text

    if tokens is None:
        tokens = _get_all_tokens()

    sanitized = text
    for token in tokens:
        if token and token in sanitized:
            sanitized = sanitized.replace(token, "[REDACTED]")

    # Redact x-access-token patterns in URLs
    sanitized = re.sub(r'x-access-token:[^@]+@', 'x-access-token:[REDACTED]@', sanitized)

    return sanitized


def _detect_git_provider(url: str) -> str:
    """Detect git provider from URL: 'github', 'gitlab', or 'unknown'."""
    url_lower = url.lower()
    if 'github.com' in url_lower or 'github' in url_lower:
        return 'github'
    elif 'gitlab.com' in url_lower or 'gitlab' in url_lower:
        return 'gitlab'
    elif 'bitbucket' in url_lower:
        return 'bitbucket'
    return 'unknown'


def _get_auth_token(provider: str) -> Optional[str]:
    """Get authentication token for a git provider."""
    if provider == 'github':
        return os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITHUB_TOKEN")
    elif provider == 'gitlab':
        return os.getenv("GITLAB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITLAB_TOKEN")
    return (
        os.getenv("GIT_TOKEN") or
        os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or
        os.getenv("GITLAB_PERSONAL_ACCESS_TOKEN")
    )


def _inject_token_into_url(url: str, token: str) -> str:
    """
    Inject auth token into git HTTPS URL.

    Transforms: https://github.com/owner/repo.git
    Into: https://x-access-token:TOKEN@github.com/owner/repo.git
    """
    parsed = urlparse(url)
    if parsed.scheme in ('http', 'https') and not parsed.username:
        netloc_with_auth = f"x-access-token:{token}@{parsed.netloc}"
        return parsed._replace(netloc=netloc_with_auth).geturl()
    return url


def _find_urls_in_args(args: List[str]) -> List[str]:
    """Find git repository URLs in command arguments."""
    urls = []
    url_patterns = [
        r'https?://[^\s]+\.git',
        r'https?://github\.com/[^\s]+',
        r'https?://gitlab\.com/[^\s]+',
        r'git@[^\s]+:[^\s]+\.git',
    ]
    for arg in args:
        for pattern in url_patterns:
            if re.match(pattern, arg):
                urls.append(arg)
                break
    return urls


def _run_git_command(
    args: List[str],
    cwd: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Run git command with automatic authentication.

    Detects URLs in the command and injects auth tokens automatically.
    All output is sanitized to prevent credential leakage.
    """
    tokens_to_redact = _get_all_tokens()

    try:
        cmd_args = list(args)

        # Find and authenticate URLs in the command
        urls = _find_urls_in_args(cmd_args)
        for url in urls:
            provider = _detect_git_provider(url)
            token = _get_auth_token(provider)
            if token:
                authenticated_url = _inject_token_into_url(url, token)
                # Replace URL with authenticated version
                for i, arg in enumerate(cmd_args):
                    if arg == url:
                        cmd_args[i] = authenticated_url
                        break
                logger.debug(f"Using {provider} token for authentication")

        result = subprocess.run(
            cmd_args,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT
        )

        return {
            'success': result.returncode == 0,
            'stdout': _sanitize_output(result.stdout.strip(), tokens_to_redact),
            'stderr': _sanitize_output(result.stderr.strip(), tokens_to_redact),
            'return_code': result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'stdout': '',
            'stderr': f'Command timed out after {GIT_TIMEOUT} seconds',
            'return_code': -1
        }
    except Exception as e:
        return {
            'success': False,
            'stdout': '',
            'stderr': _sanitize_output(str(e), tokens_to_redact),
            'return_code': -1
        }


@tool
def git(
    command: str,
    cwd: Optional[str] = None,
) -> str:
    """
    Execute any git command with automatic authentication for private repos.

    Automatically detects GitHub/GitLab URLs in the command and injects
    authentication tokens. All output is sanitized to prevent credential leakage.

    Args:
        command: Git command to run (e.g., "git clone https://github.com/...",
                 "git status", "git log --oneline -5")
        cwd: Working directory for the command (optional, defaults to current dir)

    Returns:
        Command output as string. On error, returns "ERROR: <message>"

    Examples:
        git("git clone https://github.com/owner/repo.git /tmp/repo")
        git("git status", cwd="/tmp/repo")
        git("git log --oneline -10", cwd="/tmp/repo")
        git("git diff HEAD~1", cwd="/tmp/repo")
        git("git branch -a", cwd="/tmp/repo")
        git("git show HEAD:README.md", cwd="/tmp/repo")

    Security:
        - Authentication tokens are never logged or returned in output
        - Private GitHub/GitLab repos are automatically authenticated
        - Uses GITHUB_TOKEN/GITHUB_PERSONAL_ACCESS_TOKEN for GitHub
        - Uses GITLAB_TOKEN/GITLAB_PERSONAL_ACCESS_TOKEN for GitLab
    """
    # Parse the command string into args
    try:
        args = shlex.split(command)
    except ValueError as e:
        return f"ERROR: Failed to parse command: {e}"

    # Ensure command starts with 'git'
    if not args or args[0] != 'git':
        args = ['git'] + args

    result = _run_git_command(args, cwd=cwd)

    # Combine stdout and stderr
    output = result['stdout']
    if result['stderr']:
        if output:
            output += '\n' + result['stderr']
        else:
            output = result['stderr']

    # Return error prefix for failures
    if not result['success']:
        return f"ERROR: {output}" if output else "ERROR: Command failed"

    return output if output else "Success (no output)"


# Export
__all__ = ['git']

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Git Operations Tools

Shared git operations that support both GitHub and GitLab authentication.
Auto-detects which token to use based on the repository URL.

Supports:
- GitHub: Uses GITHUB_PERSONAL_ACCESS_TOKEN
- GitLab: Uses GITLAB_PERSONAL_ACCESS_TOKEN

This module is used by:
- ai_platform_engineering/agents/github/agent_github/tools.py
- ai_platform_engineering/agents/gitlab/agent_gitlab/tools.py
- ai_platform_engineering/multi_agents/tools/__init__.py
"""

import logging
import os
import re
import subprocess
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# Maximum execution time for git commands
GIT_TIMEOUT = int(os.getenv("GIT_MAX_EXECUTION_TIME", "300"))

# Token patterns to sanitize from output (never log or send to LLM)
_SENSITIVE_TOKENS: List[str] = []


def _get_all_tokens() -> List[str]:
    """
    Collect all configured tokens for sanitization.
    Called once per command to build the list of tokens to redact.
    """
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
        if token and len(token) > 4:  # Only add non-trivial tokens
            tokens.append(token)
    return tokens


def _sanitize_output(text: str, tokens: Optional[List[str]] = None) -> str:
    """
    Remove any authentication tokens from text to prevent credential leakage.

    CRITICAL: This function MUST be called on ALL output before:
    - Logging
    - Returning to LLM/agent
    - Including in error messages

    Args:
        text: Text that may contain sensitive tokens
        tokens: List of tokens to redact (if None, uses _get_all_tokens())

    Returns:
        Sanitized text with tokens replaced by [REDACTED]
    """
    if not text:
        return text

    if tokens is None:
        tokens = _get_all_tokens()

    sanitized = text
    for token in tokens:
        if token and token in sanitized:
            sanitized = sanitized.replace(token, "[REDACTED]")

    # Also redact any x-access-token patterns that might appear in URLs
    # Pattern: x-access-token:ANYTHING@
    sanitized = re.sub(r'x-access-token:[^@]+@', 'x-access-token:[REDACTED]@', sanitized)

    return sanitized


def _detect_git_provider(url: str) -> str:
    """
    Detect the git provider from a repository URL.

    Args:
        url: Repository URL (HTTPS or SSH)

    Returns:
        Provider name: 'github', 'gitlab', or 'unknown'
    """
    url_lower = url.lower()

    if 'github.com' in url_lower or 'github' in url_lower:
        return 'github'
    elif 'gitlab.com' in url_lower or 'gitlab' in url_lower:
        return 'gitlab'
    elif 'bitbucket' in url_lower:
        return 'bitbucket'
    else:
        return 'unknown'


def _get_auth_token(provider: str) -> Optional[str]:
    """
    Get the authentication token for a git provider.

    Args:
        provider: Git provider name ('github', 'gitlab', etc.)

    Returns:
        Authentication token or None if not configured
    """
    if provider == 'github':
        return os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITHUB_TOKEN")
    elif provider == 'gitlab':
        return os.getenv("GITLAB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITLAB_TOKEN")
    else:
        # Try common token names as fallback
        return (
            os.getenv("GIT_TOKEN") or
            os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or
            os.getenv("GITLAB_PERSONAL_ACCESS_TOKEN")
        )


def _inject_token_into_url(url: str, token: str) -> str:
    """
    Inject authentication token into a git HTTPS URL.

    Transforms: https://github.com/owner/repo.git
    Into: https://x-access-token:TOKEN@github.com/owner/repo.git

    Args:
        url: Original repository URL
        token: Authentication token

    Returns:
        URL with embedded token for authentication
    """
    parsed = urlparse(url)
    if parsed.scheme in ('http', 'https') and not parsed.username:
        # Inject token into URL
        netloc_with_auth = f"x-access-token:{token}@{parsed.netloc}"
        authenticated_url = parsed._replace(netloc=netloc_with_auth).geturl()
        return authenticated_url
    return url


def _run_git_command(
    args: List[str],
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
    repo_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Internal helper to run git commands safely with authentication.

    Automatically detects the git provider (GitHub/GitLab) from the URL
    and uses the appropriate authentication token by injecting it into the URL.

    SECURITY: All output is sanitized to remove tokens before returning.
    Never log the authenticated URL or include tokens in error messages.

    Args:
        args: List of command arguments (e.g., ['git', 'status'])
        cwd: Working directory for the command
        env: Additional environment variables to set
        repo_url: Repository URL (used to detect provider for auth)

    Returns:
        Dict with success, stdout, stderr, and return_code (all sanitized)
    """
    # Collect tokens once for sanitization
    tokens_to_redact = _get_all_tokens()

    try:
        # Merge environment variables
        cmd_env = os.environ.copy()
        if env:
            cmd_env.update(env)

        # Clone the args list so we can modify it
        cmd_args = list(args)

        # Set up authentication if repo_url is provided
        if repo_url:
            provider = _detect_git_provider(repo_url)
            token = _get_auth_token(provider)

            if token:
                # Inject token into URL for reliable authentication
                authenticated_url = _inject_token_into_url(repo_url, token)
                # Replace the original URL in args with the authenticated one
                for i, arg in enumerate(cmd_args):
                    if arg == repo_url:
                        cmd_args[i] = authenticated_url
                        break
                # SECURITY: Never log the authenticated URL - only log that auth is being used
                logger.debug(f"Using {provider} token for authentication")
            else:
                logger.debug(f"No token found for {provider}, proceeding without auth")

        result = subprocess.run(
            cmd_args,
            cwd=cwd,
            env=cmd_env,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT
        )

        # SECURITY: Sanitize all output before returning
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
        # SECURITY: Sanitize exception message in case it contains token
        return {
            'success': False,
            'stdout': '',
            'stderr': _sanitize_output(str(e), tokens_to_redact),
            'return_code': -1
        }


@tool
def git_clone(
    repo_url: str,
    dest_path: str,
    branch: Optional[str] = None,
    depth: Optional[int] = None
) -> Dict[str, Any]:
    """
    Clone a git repository. Supports authenticated cloning for private GitHub and GitLab repos.

    Automatically detects the provider (GitHub/GitLab) from the URL and uses
    the appropriate authentication token (GITHUB_PERSONAL_ACCESS_TOKEN or GITLAB_PERSONAL_ACCESS_TOKEN).

    Args:
        repo_url: URL of the git repository to clone (GitHub or GitLab)
        dest_path: Destination path where repository should be cloned
        branch: Optional specific branch to clone
        depth: Optional depth for shallow clone (e.g., 1 for latest commit only)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - message: Human-readable status message
        - output: Command output
        - error: Error message (if failed)
        - provider: Detected git provider (github/gitlab)

    Example:
        # Clone a GitHub repository
        result = git_clone("https://github.com/example/repo.git", "/tmp/repo")

        # Clone a GitLab repository
        result = git_clone("https://gitlab.com/example/repo.git", "/tmp/repo")

        # Clone specific branch with shallow history
        result = git_clone(
            "https://github.com/example/repo.git",
            "/tmp/repo",
            branch="main",
            depth=1
        )
    """
    provider = _detect_git_provider(repo_url)
    logger.info(f"Cloning from {provider}: {repo_url}")

    args = ['git', 'clone']

    if branch:
        args.extend(['--branch', branch])

    if depth:
        args.extend(['--depth', str(depth)])

    args.extend([repo_url, dest_path])

    result = _run_git_command(args, repo_url=repo_url)

    if result['success']:
        return {
            'success': True,
            'message': f'Successfully cloned {repo_url} to {dest_path}',
            'output': result['stdout'] or result['stderr'],
            'provider': provider
        }
    else:
        return {
            'success': False,
            'message': f'Failed to clone repository: {result["stderr"]}',
            'error': result['stderr'],
            'output': result['stdout'],
            'provider': provider
        }


@tool
def git_status(repo_path: str) -> Dict[str, Any]:
    """
    Get the status of a git repository.

    Args:
        repo_path: Path to the git repository

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - status: Git status output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_status("/tmp/repo")
        print(result['status'])
    """
    result = _run_git_command(['git', 'status'], cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'status': result['stdout'],
            'message': 'Successfully retrieved git status'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to get git status: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_log(
    repo_path: str,
    max_count: int = 10,
    oneline: bool = True
) -> Dict[str, Any]:
    """
    View git commit history.

    Args:
        repo_path: Path to the git repository
        max_count: Maximum number of commits to show (default: 10)
        oneline: Show compact one-line format (default: True)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - log: Git log output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_log("/tmp/repo", max_count=5)
        print(result['log'])
    """
    args = ['git', 'log', f'--max-count={max_count}']

    if oneline:
        args.append('--oneline')

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'log': result['stdout'],
            'message': f'Successfully retrieved last {max_count} commits'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to get git log: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_branch(
    repo_path: str,
    list_all: bool = False
) -> Dict[str, Any]:
    """
    List git branches.

    Args:
        repo_path: Path to the git repository
        list_all: List all branches including remote (default: False)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - branches: List of branches
        - current_branch: Currently checked out branch
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_branch("/tmp/repo", list_all=True)
        print(result['branches'])
    """
    args = ['git', 'branch']

    if list_all:
        args.append('-a')

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        branches = result['stdout'].split('\n')
        current_branch = None

        for branch_item in branches:
            if branch_item.startswith('*'):
                current_branch = branch_item.strip('* ')
                break

        return {
            'success': True,
            'branches': result['stdout'],
            'current_branch': current_branch,
            'message': 'Successfully retrieved branch list'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to list branches: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_diff(
    repo_path: str,
    file_path: Optional[str] = None,
    cached: bool = False
) -> Dict[str, Any]:
    """
    Show changes in the repository.

    Args:
        repo_path: Path to the git repository
        file_path: Optional specific file to show diff for
        cached: Show staged changes (default: False)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - diff: Diff output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_diff("/tmp/repo")
        print(result['diff'])
    """
    args = ['git', 'diff']

    if cached:
        args.append('--cached')

    if file_path:
        args.append(file_path)

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'diff': result['stdout'],
            'message': 'Successfully retrieved diff'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to get diff: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_show(
    repo_path: str,
    commit: str = "HEAD",
    file_path: Optional[str] = None
) -> Dict[str, Any]:
    """
    Show details of a commit or file at a specific commit.

    Args:
        repo_path: Path to the git repository
        commit: Commit reference (default: HEAD)
        file_path: Optional specific file to show

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - content: Show output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_show("/tmp/repo", "HEAD", "README.md")
        print(result['content'])
    """
    args = ['git', 'show', commit]

    if file_path:
        args.append(file_path)

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'content': result['stdout'],
            'message': f'Successfully retrieved content for {commit}'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to show commit: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_remote(
    repo_path: str,
    verbose: bool = True
) -> Dict[str, Any]:
    """
    List remote repositories.

    Args:
        repo_path: Path to the git repository
        verbose: Show remote URLs (default: True)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - remotes: Remote repository information
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_remote("/tmp/repo")
        print(result['remotes'])
    """
    args = ['git', 'remote']

    if verbose:
        args.append('-v')

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'remotes': result['stdout'],
            'message': 'Successfully retrieved remote list'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to list remotes: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_pull(
    repo_path: str,
    remote: str = "origin",
    branch: Optional[str] = None
) -> Dict[str, Any]:
    """
    Pull latest changes from remote repository.

    Args:
        repo_path: Path to the git repository
        remote: Remote name (default: origin)
        branch: Branch to pull (default: current branch)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - output: Pull output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_pull("/tmp/repo")
        result = git_pull("/tmp/repo", remote="origin", branch="main")
    """
    args = ['git', 'pull', remote]

    if branch:
        args.append(branch)

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'output': result['stdout'],
            'message': 'Successfully pulled latest changes'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to pull: {result["stderr"]}',
            'error': result['stderr']
        }


@tool
def git_fetch(
    repo_path: str,
    remote: str = "origin",
    prune: bool = False
) -> Dict[str, Any]:
    """
    Fetch updates from remote repository without merging.

    Args:
        repo_path: Path to the git repository
        remote: Remote name (default: origin)
        prune: Remove remote-tracking references that no longer exist

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - output: Fetch output
        - message: Human-readable status message
        - error: Error message (if failed)

    Example:
        result = git_fetch("/tmp/repo")
        result = git_fetch("/tmp/repo", prune=True)
    """
    args = ['git', 'fetch', remote]

    if prune:
        args.append('--prune')

    result = _run_git_command(args, cwd=repo_path)

    if result['success']:
        return {
            'success': True,
            'output': result['stdout'] or 'Fetch completed (no new changes)',
            'message': 'Successfully fetched from remote'
        }
    else:
        return {
            'success': False,
            'message': f'Failed to fetch: {result["stderr"]}',
            'error': result['stderr']
        }


# Export for use in agent tool lists
__all__ = [
    'git_clone',
    'git_status',
    'git_log',
    'git_branch',
    'git_diff',
    'git_show',
    'git_remote',
    'git_pull',
    'git_fetch',
    # Internal helpers (not tools, but useful for custom implementations)
    '_run_git_command',
    '_detect_git_provider',
    '_get_auth_token',
]

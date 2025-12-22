# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Git Operations Tool

This tool provides capabilities to perform git operations, useful for:
- Cloning repositories
- Checking repository status
- Adding and committing changes
- Viewing commit history
- Managing branches
- Working with remotes
"""

from typing import Dict, Any, Optional, List
from langchain_core.tools import tool
import subprocess
import os
import shlex


def _run_git_command(
    args: List[str],
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Internal helper to run git commands safely.

    Args:
        args: List of command arguments (e.g., ['git', 'status'])
        cwd: Working directory for the command
        env: Environment variables to set

    Returns:
        Dict with success, stdout, stderr, and return_code
    """
    try:
        # Merge environment variables
        cmd_env = os.environ.copy()
        if env:
            cmd_env.update(env)

        result = subprocess.run(
            args,
            cwd=cwd,
            env=cmd_env,
            capture_output=True,
            text=True,
            timeout=300  # 5 minute timeout
        )

        return {
            'success': result.returncode == 0,
            'stdout': result.stdout.strip(),
            'stderr': result.stderr.strip(),
            'return_code': result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'stdout': '',
            'stderr': 'Command timed out after 300 seconds',
            'return_code': -1
        }
    except Exception as e:
        return {
            'success': False,
            'stdout': '',
            'stderr': str(e),
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
    Clone a git repository.

    Args:
        repo_url: URL of the git repository to clone
        dest_path: Destination path where repository should be cloned
        branch: Optional specific branch to clone
        depth: Optional depth for shallow clone (e.g., 1 for latest commit only)

    Returns:
        Dict containing:
        - success: Whether the operation succeeded
        - message: Human-readable status message
        - output: Command output
        - error: Error message (if failed)

    Example:
        # Clone a repository
        result = git_clone("https://github.com/example/repo.git", "/tmp/repo")

        # Clone specific branch with shallow history
        result = git_clone(
            "https://github.com/example/repo.git",
            "/tmp/repo",
            branch="main",
            depth=1
        )
    """
    args = ['git', 'clone']

    if branch:
        args.extend(['--branch', branch])

    if depth:
        args.extend(['--depth', str(depth)])

    args.extend([repo_url, dest_path])

    result = _run_git_command(args)

    if result['success']:
        return {
            'success': True,
            'message': f'Successfully cloned {repo_url} to {dest_path}',
            'output': result['stdout'] or result['stderr']
        }
    else:
        return {
            'success': False,
            'message': f'Failed to clone repository: {result["stderr"]}',
            'error': result['stderr'],
            'output': result['stdout']
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

        for branch in branches:
            if branch.startswith('*'):
                current_branch = branch.strip('* ')
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


# Export for use in agent tool lists
__all__ = [
    'git_clone',
    'git_status',
    'git_log',
    'git_branch',
    'git_diff',
    'git_show',
    'git_remote'
]





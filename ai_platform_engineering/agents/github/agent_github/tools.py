# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Custom tools for GitHub Agent including gh CLI execution and git operations."""

import asyncio
import logging
import os
import re
import shlex
import subprocess
from typing import Any, Dict, List, Optional

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# Dangerous commands that should be blocked by default
BLOCKED_COMMAND_PATTERNS = [
    r"delete\s",
    r"repo\s+delete",
    r"secret\s+delete",
    r"api\s+--method\s+(DELETE|PUT|POST|PATCH)",
    r"issue\s+delete",
    r"pr\s+close",
    r"release\s+delete",
    r"workflow\s+disable",
]

# Maximum execution time for gh CLI commands
GH_CLI_TIMEOUT = int(os.getenv("GH_CLI_MAX_EXECUTION_TIME", "30"))

# Maximum output size - keep small to avoid context overflow
# 50KB is roughly ~12K tokens, safe for log retrieval
MAX_OUTPUT_SIZE = int(os.getenv("GH_CLI_MAX_OUTPUT_SIZE", "50000"))

# Concurrency control - limit parallel gh CLI calls
MAX_CONCURRENT_GH_CALLS = int(os.getenv("MAX_CONCURRENT_GH_CALLS", "10"))
_gh_cli_semaphore = asyncio.Semaphore(MAX_CONCURRENT_GH_CALLS)


class GHCLIToolInput(BaseModel):
    """Input schema for gh CLI tool."""

    command: str = Field(
        description=(
            "The gh CLI command to execute. Should be a valid gh CLI command "
            "without the 'gh' prefix. Examples: 'run view 123 --repo org/repo --log', "
            "'pr list --repo org/repo', 'issue list --repo org/repo'. "
            "The command will be executed with the GITHUB_TOKEN from environment."
        )
    )


class GHCLITool(BaseTool):
    """
    Tool for executing gh CLI commands (READ-ONLY).

    This tool provides secure read-only access to GitHub via gh CLI:
    - Only read operations allowed (list, view, status)
    - No create, update, delete, or modify operations
    - Timeout protection
    - Output size limits

    Enable by setting USE_GH_CLI_AS_TOOL=true in environment.
    """

    name: str = "gh_cli_execute"
    description: str = (
        "Execute gh CLI read-only commands to query GitHub resources. "
        "Supports workflow runs, pull requests, issues, releases, etc. "
        "The command should NOT include the 'gh' prefix - just the subcommand and arguments. "
        "Examples: 'run view 123 --repo org/repo --log', 'pr list --repo org/repo --state open'. "
        "Write operations (delete, close, disable) are blocked. "
        "Use this tool to fetch GitHub Actions logs from workflow run URLs."
    )
    args_schema: type[BaseModel] = GHCLIToolInput

    # Configuration
    allow_write_operations: bool = False

    def __init__(self, allow_write_operations: bool = False, **kwargs: Any):
        """
        Initialize the gh CLI tool.

        Args:
            allow_write_operations: If True, allows write/modify operations.
                                   If False (default), only read operations are allowed.
        """
        super().__init__(**kwargs)
        self.allow_write_operations = allow_write_operations

    def _validate_command(self, command: str) -> tuple[bool, str]:
        """
        Validate gh CLI command for safety.

        Args:
            command: The gh CLI command to validate (without 'gh' prefix)

        Returns:
            Tuple of (is_valid, error_message)
        """
        command_lower = command.lower()

        # Block dangerous operations unless explicitly allowed
        if not self.allow_write_operations:
            for pattern in BLOCKED_COMMAND_PATTERNS:
                if re.search(pattern, command_lower):
                    return False, f"Blocked: Command contains potentially destructive operation '{pattern}'"

        # Validate command is not empty
        if not command.strip():
            return False, "Command cannot be empty"

        return True, ""

    async def _arun(
        self,
        command: str,
    ) -> str:
        """
        Execute a gh CLI command asynchronously.

        Args:
            command: gh CLI command (without 'gh' prefix)

        Returns:
            Command output as string, or error message
        """
        # Validate command
        is_valid, error_msg = self._validate_command(command)
        if not is_valid:
            logger.warning(f"gh CLI command blocked: {command} - {error_msg}")
            return f"❌ {error_msg}"

        # Check if GITHUB_TOKEN is set
        github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITHUB_TOKEN")
        if not github_token:
            return "❌ Error: GITHUB_PERSONAL_ACCESS_TOKEN not set. gh CLI requires authentication."

        # Build full command
        command_parts = ["gh"] + shlex.split(command)
        full_command = " ".join(command_parts)

        logger.info(f"Executing gh CLI: {full_command}")

        # Use semaphore to limit concurrent executions
        async with _gh_cli_semaphore:
            try:
                # Set environment with GitHub token
                env = os.environ.copy()
                env["GH_TOKEN"] = github_token

                # Execute command with timeout
                process = await asyncio.create_subprocess_exec(
                    *command_parts,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=env,
                )

                try:
                    stdout, stderr = await asyncio.wait_for(
                        process.communicate(),
                        timeout=GH_CLI_TIMEOUT
                    )
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()
                    return f"❌ Command timed out after {GH_CLI_TIMEOUT}s: {full_command}"

                # Decode output
                stdout_text = stdout.decode('utf-8', errors='replace') if stdout else ""
                stderr_text = stderr.decode('utf-8', errors='replace') if stderr else ""

                # Check return code
                if process.returncode != 0:
                    error_msg = stderr_text or stdout_text or "Unknown error"
                    logger.warning(f"gh CLI command failed (exit {process.returncode}): {full_command}")
                    return f"❌ Command failed (exit {process.returncode}): {error_msg}"

                # Combine output
                output = stdout_text
                if stderr_text and "warning" in stderr_text.lower():
                    output += f"\n⚠️ Warnings:\n{stderr_text}"

                # Truncate if too large
                if len(output) > MAX_OUTPUT_SIZE:
                    truncated = output[:MAX_OUTPUT_SIZE]
                    remaining = len(output) - MAX_OUTPUT_SIZE
                    output = f"{truncated}\n\n... (truncated {remaining} characters)"
                    logger.warning(f"gh CLI output truncated to {MAX_OUTPUT_SIZE} chars")

                return output.strip()

            except FileNotFoundError:
                return "❌ Error: gh CLI not found. Please ensure it's installed in the container."
            except Exception as e:
                logger.error(f"gh CLI execution error: {str(e)}", exc_info=True)
                return f"❌ Error executing command: {str(e)}"

    def _run(self, command: str) -> str:
        """Synchronous wrapper - not recommended, use _arun instead."""
        return asyncio.run(self._arun(command))


def get_gh_cli_tool() -> Optional[GHCLITool]:
    """
    Factory function to create gh CLI tool if enabled.

    Returns:
        GHCLITool instance if USE_GH_CLI_AS_TOOL=true, None otherwise

    Note: Write operations are always disabled. Only read operations allowed.
    """
    use_gh_cli = os.getenv("USE_GH_CLI_AS_TOOL", "true").lower() == "true"

    if not use_gh_cli:
        logger.info("gh CLI tool is disabled (USE_GH_CLI_AS_TOOL=false)")
        return None

    # Always read-only - no delete, close, disable operations
    logger.info("gh CLI tool enabled (read-only mode)")

    return GHCLITool(allow_write_operations=False)


# =============================================================================
# Git Operations Tools
# =============================================================================

# Maximum execution time for git commands
GIT_TIMEOUT = int(os.getenv("GIT_MAX_EXECUTION_TIME", "300"))


def _run_git_command(
    args: List[str],
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """
    Internal helper to run git commands safely with GitHub authentication.

    Args:
        args: List of command arguments (e.g., ['git', 'status'])
        cwd: Working directory for the command
        env: Additional environment variables to set

    Returns:
        Dict with success, stdout, stderr, and return_code
    """
    try:
        # Merge environment variables
        cmd_env = os.environ.copy()
        if env:
            cmd_env.update(env)

        # Set up GitHub authentication for HTTPS URLs
        github_token = os.getenv("GITHUB_PERSONAL_ACCESS_TOKEN") or os.getenv("GITHUB_TOKEN")
        if github_token:
            # Configure git credential helper to use token
            cmd_env["GIT_ASKPASS"] = "echo"
            cmd_env["GIT_USERNAME"] = "x-access-token"
            cmd_env["GIT_PASSWORD"] = github_token

        result = subprocess.run(
            args,
            cwd=cwd,
            env=cmd_env,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT
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
            'stderr': f'Command timed out after {GIT_TIMEOUT} seconds',
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
    Clone a git repository. Supports authenticated cloning for private GitHub repos.

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






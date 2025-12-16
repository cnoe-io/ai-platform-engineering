# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Custom tools for GitHub Agent including gh CLI execution."""

import asyncio
import logging
import os
import re
import shlex
from typing import Any, Optional

from langchain_core.tools import BaseTool
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





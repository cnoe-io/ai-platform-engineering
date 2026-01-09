# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Custom tools for GitLab Agent including bash command execution."""

import asyncio
import logging
import os
from typing import Optional

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Maximum execution time for bash commands (seconds)
COMMAND_TIMEOUT = int(os.getenv("BASH_COMMAND_TIMEOUT", "30"))


class BashCommandToolInput(BaseModel):
    """Input schema for bash command tool."""

    command: str = Field(
        description=(
            "The shell command to execute. "
            "Use for git operations like: "
            "'git clone https://gitlab-ci-token:$GITLAB_TOKEN@host/group/project.git /tmp/workspace-name', "
            "'git checkout -b branch-name', 'git add .', 'git commit -m \"message\"', 'git push origin branch-name'. "
            "Also use for file operations like 'find', 'grep', etc."
        )
    )


class BashCommandTool(BaseTool):
    """
    Tool for executing shell commands directly.

    Used for git operations and file system commands.
    """

    name: str = "bash_command"
    description: str = (
        "Execute shell commands directly (uses /bin/sh). "
        "Use this for git operations (clone, checkout, add, commit, push) and file system operations (find, grep, ls, etc.). "
        "\n\n"
        "Examples:\n"
        "  - 'git clone https://gitlab-ci-token:$GITLAB_TOKEN@cd.splunkdev.com/group/project.git /tmp/workspace-name'\n"
        "  - 'cd /tmp/workspace-name && git config user.name \"AI Agent\" && git config user.email \"ai@example.com\"'\n"
        "  - 'cd /tmp/workspace-name && git checkout -b feature-branch'\n"
        "  - 'find /tmp/workspace-name -name \"*.yaml\"'\n"
        "  - 'grep -r \"config\" /tmp/workspace-name'\n"
    )
    args_schema: type[BaseModel] = BashCommandToolInput

    async def _arun(self, command: str) -> str:
        """Execute a shell command asynchronously."""
        try:
            # Use /bin/sh explicitly for compatibility
            process = await asyncio.create_subprocess_exec(
                "/bin/sh", "-c", command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=os.environ.copy(),
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=COMMAND_TIMEOUT
            )

            stdout_text = stdout.decode('utf-8', errors='replace') if stdout else ""
            stderr_text = stderr.decode('utf-8', errors='replace') if stderr else ""

            if process.returncode != 0:
                error_msg = stderr_text or stdout_text or "Unknown error"
                logger.warning(f"bash_command failed (exit {process.returncode}): {command}")
                logger.warning(f"bash_command stderr: {stderr_text}")
                logger.warning(f"bash_command stdout: {stdout_text}")
                return f"❌ Command failed (exit {process.returncode}): {error_msg}"

            output = stdout_text
            if stderr_text:
                output += f"\n{stderr_text}"

            return output.strip() or "✅ Command completed successfully"

        except asyncio.TimeoutError:
            return f"❌ Command timed out after {COMMAND_TIMEOUT}s"
        except Exception as e:
            logger.error(f"bash_command exception: {str(e)}", exc_info=True)
            return f"❌ Error executing command: {str(e)}"

    def _run(self, command: str) -> str:
        """Synchronous wrapper."""
        return asyncio.run(self._arun(command))


def get_bash_command_tool() -> Optional[BashCommandTool]:
    """
    Factory function to create bash command tool.

    Returns:
        BashCommandTool instance
    """
    return BashCommandTool()

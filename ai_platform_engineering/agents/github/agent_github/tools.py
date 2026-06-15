# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Custom tools for GitHub Agent including gh CLI execution and git operations."""

import asyncio
import base64
import contextvars
import json
import logging
import mimetypes
import os
import re
import shlex
import threading
from typing import Any, Optional
from urllib.parse import quote, urlparse

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

# Import git tool from utils (shared with GitLab agent)
from ai_platform_engineering.utils.agent_tools import git
from ai_platform_engineering.utils.github_app_token_provider import get_github_token
from ai_platform_engineering.utils.token_sanitizer import sanitize_output

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Self-service mode context variable — set by DeterministicTaskMiddleware
# ---------------------------------------------------------------------------
self_service_mode_ctx: contextvars.ContextVar[bool] = contextvars.ContextVar(
    'self_service_mode', default=False
)

_thread_local = threading.local()


def set_self_service_mode(value: bool) -> None:
    """Set self-service mode flag for current thread/context."""
    self_service_mode_ctx.set(value)
    _thread_local.self_service_mode = value


def is_self_service_mode() -> bool:
    """Check if we're running in self-service mode."""
    try:
        if self_service_mode_ctx.get():
            return True
    except LookupError:
        pass
    return getattr(_thread_local, 'self_service_mode', False)


# ---------------------------------------------------------------------------
# Per-task allowed tools — set by DeterministicTaskMiddleware for custom workflows
# None = allow all (default); list = only these tools are permitted
# ---------------------------------------------------------------------------
_task_allowed_tools_ctx: contextvars.ContextVar[Optional[list]] = contextvars.ContextVar(
    'task_allowed_tools', default=None
)


def set_task_allowed_tools(tools: Optional[list]) -> None:
    """Set the allowed tools list for the current custom workflow execution."""
    _task_allowed_tools_ctx.set(tools)
    _thread_local.task_allowed_tools = tools


def get_task_allowed_tools() -> Optional[list]:
    """Get the allowed tools list for the current task, or None if unrestricted."""
    try:
        val = _task_allowed_tools_ctx.get()
        if val is not None:
            return val
    except LookupError:
        pass
    return getattr(_thread_local, 'task_allowed_tools', None)


# Commands that should never run through the agent-facing gh wrapper.
ABSOLUTELY_BLOCKED_COMMAND_PATTERNS = [
    # SECURITY: block commands that expose or persist credentials
    r"(^|\s)auth\s+token(\s|$)",       # gh auth token prints raw token to stdout
    r"(^|\s)auth\s+setup-git(\s|$)",   # gh auth setup-git modifies git credential config
]

# GitHub write commands are allowed only for deterministic self-service tasks or
# when a caller explicitly constructs GHCLITool(allow_write_operations=True).
TRUSTED_WRITE_COMMAND_PATTERNS = [
    r"(^|\s)issue\s+(close|comment|create|edit|reopen)(\s|$)",
    r"(^|\s)pr\s+(comment|create|edit|ready|reopen)(\s|$)",
]

SELF_SERVICE_ALLOWED_WRITE_COMMAND_PATTERNS = [
    *TRUSTED_WRITE_COMMAND_PATTERNS,
    r"(^|\s)pr\s+(merge|review|update-branch)(\s|$)",
    r"(^|\s)repo\s+(create|fork)(\s|$)",
]

WRITE_COMMAND_PATTERNS = [
    r"(^|\s)api\s+.*(--method(=|\s+)|-x\s+)(delete|put|post|patch)(\s|$)",
    r"(^|\s)attestation\s+trusted-root(\s|$)",
    r"(^|\s)cache\s+delete(\s|$)",
    r"(^|\s)codespace\s+(create|delete|edit|jupyter|logs|ports|rebuild|ssh|stop)(\s|$)",
    r"(^|\s)gist\s+(create|delete|edit|rename)(\s|$)",
    r"(^|\s)gpg-key\s+(add|delete)(\s|$)",
    r"(^|\s)issue\s+(close|comment|create|delete|develop|edit|lock|pin|reopen|transfer|unlock|unpin)(\s|$)",
    r"(^|\s)label\s+(clone|create|delete|edit)(\s|$)",
    r"(^|\s)pr\s+(checkout|close|comment|create|edit|lock|merge|ready|reopen|revert|review|unlock|update-branch)(\s|$)",
    r"(^|\s)project\s+.*(create|delete|edit|item-add|item-archive|item-create|item-delete|item-edit)(\s|$)",
    r"(^|\s)release\s+(create|delete|edit|upload)(\s|$)",
    r"(^|\s)repo\s+(archive|create|delete|deploy-key|edit|fork|rename|sync|unarchive)(\s|$)",
    r"(^|\s)ruleset\s+(check|create|delete|edit)(\s|$)",
    r"(^|\s)secret\s+(delete|set)(\s|$)",
    r"(^|\s)ssh-key\s+(add|delete)(\s|$)",
    r"(^|\s)variable\s+(delete|set)(\s|$)",
    r"(^|\s)workflow\s+(disable|enable|run)(\s|$)",
    r"(^|\s)run\s+(cancel|delete|rerun)(\s|$)",
]

# Maximum execution time for gh CLI commands
GH_CLI_TIMEOUT = int(os.getenv("GH_CLI_MAX_EXECUTION_TIME", "30"))

# Maximum output size - keep small to avoid context overflow
# 50KB is roughly ~12K tokens, safe for log retrieval
MAX_OUTPUT_SIZE = int(os.getenv("GH_CLI_MAX_OUTPUT_SIZE", "50000"))

NO_GITHUB_AUTH_ERROR = (
    "❌ Error: No GitHub auth configured. Set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY + "
    "GITHUB_APP_INSTALLATION_ID for App auth, or GITHUB_PERSONAL_ACCESS_TOKEN, "
    "GH_TOKEN, or GITHUB_TOKEN for PAT auth."
)

# Concurrency control - limit parallel gh CLI calls
MAX_CONCURRENT_GH_CALLS = int(os.getenv("MAX_CONCURRENT_GH_CALLS", "10"))
_gh_cli_semaphore = asyncio.Semaphore(MAX_CONCURRENT_GH_CALLS)


def _github_host_from_env() -> Optional[str]:
    host = os.getenv("GITHUB_HOST", "").strip()
    if host:
        parsed = urlparse(host if "://" in host else f"https://{host}")
        return parsed.hostname or host.split("/", 1)[0]

    api_url = os.getenv("GITHUB_API_URL", "").strip()
    if not api_url:
        return None

    parsed = urlparse(api_url)
    if not parsed.hostname:
        return None
    if parsed.hostname == "api.github.com":
        return "github.com"
    return parsed.hostname


def _apply_github_auth_env(env: dict[str, str], github_token: str) -> None:
    env["GH_TOKEN"] = github_token

    host = _github_host_from_env()
    if not host or host == "github.com":
        return

    env["GH_HOST"] = host
    env["GH_ENTERPRISE_TOKEN"] = github_token


class GHCLIToolInput(BaseModel):
    """Input schema for gh CLI tool."""

    command: str = Field(
        description=(
            "The gh CLI command to execute. Should be a valid gh CLI command "
            "without the 'gh' prefix. Examples: 'run view 123 --repo org/repo --log', "
            "'pr list --repo org/repo', 'issue list --repo org/repo'. "
            "The command will be executed with the configured GitHub token."
        )
    )


class GHGetFileContentsInput(BaseModel):
    """Input schema for fetching a file from a GitHub repository."""

    owner: str = Field(
        description="Repository owner or organization, for example 'cnoe-io'."
    )
    repo: str = Field(
        description="Repository name, for example 'ai-platform-engineering'."
    )
    path: str = Field(
        default="/",
        description=(
            "Path to the file or directory in the repository, for example "
            "'README.md' or 'src/app.py'. Defaults to '/'."
        ),
    )
    ref: Optional[str] = Field(
        default=None,
        description=(
            "Optional git ref such as refs/tags/{tag}, refs/heads/{branch}, "
            "refs/pull/{pr_number}/head, or a branch name. Defaults to the "
            "repository default branch."
        ),
    )
    sha: Optional[str] = Field(
        default=None,
        description="Optional commit SHA. If specified, it is used instead of ref.",
    )


class GHCLITool(BaseTool):
    """
    Tool for executing gh CLI commands.

    This tool provides controlled access to GitHub via gh CLI:
    - Read operations allowed (list, view, status)
    - Limited issue/PR authoring allowed for trusted chat flows
    - Broader writes require deterministic self-service mode or explicit opt-in
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
        "Write operations are blocked unless deterministic self-service mode is active. "
        "Use this tool to fetch GitHub Actions logs from workflow run URLs."
    )
    args_schema: type[BaseModel] = GHCLIToolInput

    # Configuration
    allow_write_operations: bool = False
    allow_trusted_write_operations: bool = True

    def __init__(
        self,
        allow_write_operations: bool = False,
        allow_trusted_write_operations: bool = True,
        **kwargs: Any,
    ):
        """
        Initialize the gh CLI tool.

        Args:
            allow_write_operations: If True, allows write/modify operations.
                                   If False (default), only read operations are allowed.
            allow_trusted_write_operations: If True, allows limited issue/PR
                                   authoring commands used by trusted chat flows.
        """
        super().__init__(**kwargs)
        self.allow_write_operations = allow_write_operations
        self.allow_trusted_write_operations = allow_trusted_write_operations

    @staticmethod
    def _command_matches(command_lower: str, patterns: list[str]) -> bool:
        return any(re.search(pattern, command_lower) for pattern in patterns)

    @staticmethod
    def _gh_api_uses_implicit_write(parts: list[str]) -> bool:
        if not parts or parts[0] != "api":
            return False

        explicit_method: Optional[str] = None
        has_body_input = False
        field_flags = {"-f", "--raw-field", "-F", "--field", "--input"}

        index = 1
        while index < len(parts):
            part = parts[index]
            lower = part.lower()

            if lower in {"--method", "-x"} and index + 1 < len(parts):
                explicit_method = parts[index + 1].lower()
                index += 2
                continue
            if lower.startswith("--method="):
                explicit_method = lower.split("=", 1)[1]
            elif lower in field_flags:
                has_body_input = True
                index += 2
                continue
            elif lower.startswith("--raw-field=") or lower.startswith("--field=") or lower.startswith("--input="):
                has_body_input = True

            index += 1

        if explicit_method and explicit_method != "get":
            return True
        return has_body_input and explicit_method != "get"

    @staticmethod
    def _gh_api_endpoint_and_method(parts: list[str]) -> tuple[Optional[str], str]:
        explicit_method: Optional[str] = None
        has_body_input = False
        endpoint: Optional[str] = None
        value_flags = {
            "-f",
            "--raw-field",
            "-F",
            "--field",
            "--input",
            "--header",
            "-H",
            "--jq",
            "-q",
        }
        boolean_flags = {"--paginate", "--silent", "--slurp", "--verbose"}

        index = 1
        while index < len(parts):
            part = parts[index]
            lower = part.lower()

            if lower in {"--method", "-x"} and index + 1 < len(parts):
                explicit_method = parts[index + 1].lower()
                index += 2
                continue
            if lower.startswith("--method="):
                explicit_method = lower.split("=", 1)[1]
                index += 1
                continue
            if lower in {"-f", "--raw-field", "-F", "--field", "--input"}:
                has_body_input = True
                index += 2
                continue
            if (
                lower.startswith("--raw-field=")
                or lower.startswith("--field=")
                or lower.startswith("--input=")
            ):
                has_body_input = True
                index += 1
                continue
            if lower in value_flags:
                index += 2
                continue
            if any(lower.startswith(f"{flag}=") for flag in value_flags if flag.startswith("--")):
                index += 1
                continue
            if lower in boolean_flags:
                index += 1
                continue
            if endpoint is None:
                endpoint = part
            index += 1

        if explicit_method:
            method = explicit_method
        elif has_body_input:
            method = "post"
        else:
            method = "get"
        return endpoint, method

    @staticmethod
    def _self_service_allows_api_write(parts: list[str]) -> bool:
        if not parts or parts[0] != "api":
            return False

        endpoint, method = GHCLITool._gh_api_endpoint_and_method(parts)
        if not endpoint or method == "get":
            return True

        endpoint = endpoint.lstrip("/")
        allowed_methods = {"post", "put", "patch"}
        if method == "delete":
            return bool(re.match(r"^repos/[^/\s]+/[^/\s]+/contents/.+", endpoint))
        if method not in allowed_methods:
            return False

        return any(
            re.match(pattern, endpoint)
            for pattern in (
                r"^repos/[^/\s]+/[^/\s]+/contents/.+",
                r"^repos/[^/\s]+/[^/\s]+/git/refs(/.*)?$",
                r"^repos/[^/\s]+/[^/\s]+/issues(/.*)?$",
                r"^repos/[^/\s]+/[^/\s]+/pulls(/.*)?$",
                r"^orgs/[^/\s]+/invitations$",
            )
        )

    def _self_service_allows_write(self, command_parts: list[str], command_lower: str) -> bool:
        if command_parts and command_parts[0] == "api":
            return self._self_service_allows_api_write(command_parts)
        return self._command_matches(command_lower, SELF_SERVICE_ALLOWED_WRITE_COMMAND_PATTERNS)

    def _validate_command(self, command: str) -> tuple[bool, str]:
        """
        Validate gh CLI command for safety.

        Args:
            command: The gh CLI command to validate (without 'gh' prefix)

        Returns:
            Tuple of (is_valid, error_message)
        """
        command_stripped = command.strip()

        # Validate command is not empty
        if not command_stripped:
            return False, "Command cannot be empty"

        command_lower = command_stripped.lower()

        try:
            command_parts = shlex.split(command_stripped)
        except ValueError as exc:
            return False, f"Invalid gh CLI command syntax: {exc}"

        for pattern in ABSOLUTELY_BLOCKED_COMMAND_PATTERNS:
            if re.search(pattern, command_lower):
                return False, f"Blocked: Command contains unsafe credential operation '{pattern}'"

        writes_allowed = self.allow_write_operations or is_self_service_mode()
        is_trusted_write = self.allow_trusted_write_operations and self._command_matches(
            command_lower,
            TRUSTED_WRITE_COMMAND_PATTERNS,
        )
        is_api_write = self._gh_api_uses_implicit_write(command_parts)
        is_write_command = is_api_write or self._command_matches(command_lower, WRITE_COMMAND_PATTERNS)
        if is_write_command:
            if writes_allowed and not self._self_service_allows_write(command_parts, command_lower):
                return False, (
                    "Blocked: This GitHub write command is not in the deterministic "
                    "self-service allowlist."
                )
            if not writes_allowed and is_api_write:
                return False, (
                    "Blocked: gh api body fields and input are treated as GitHub "
                    "write commands unless --method GET is explicit."
                )
            if not writes_allowed and not is_trusted_write:
                return False, (
                    "Blocked: GitHub write commands are only allowed in "
                    "deterministic self-service tasks or trusted issue/PR flows."
                )

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

        github_token = get_github_token()
        if not github_token:
            return NO_GITHUB_AUTH_ERROR

        # Build full command
        command_parts = ["gh"] + shlex.split(command)
        full_command = " ".join(command_parts)

        logger.info(f"Executing gh CLI: {full_command}")

        # Use semaphore to limit concurrent executions
        async with _gh_cli_semaphore:
            try:
                # Set environment with GitHub token
                env = os.environ.copy()
                _apply_github_auth_env(env, github_token)

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
                    return sanitize_output(f"❌ Command timed out after {GH_CLI_TIMEOUT}s: {full_command}")

                # Decode output
                stdout_text = stdout.decode('utf-8', errors='replace') if stdout else ""
                stderr_text = stderr.decode('utf-8', errors='replace') if stderr else ""

                # Check return code
                if process.returncode != 0:
                    error_msg = stderr_text or stdout_text or "Unknown error"
                    logger.warning(f"gh CLI command failed (exit {process.returncode}): {full_command}")
                    return sanitize_output(f"❌ Command failed (exit {process.returncode}): {error_msg}")

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

                # Sanitize output to prevent token leakage
                return sanitize_output(output.strip())

            except FileNotFoundError:
                return "❌ Error: gh CLI not found. Please ensure it's installed in the container."
            except Exception as e:
                logger.error(f"gh CLI execution error: {str(e)}", exc_info=True)
                return sanitize_output(f"❌ Error executing command: {str(e)}")

    def _run(self, command: str) -> str:
        """Synchronous wrapper - not recommended, use _arun instead."""
        return asyncio.run(self._arun(command))


class GHGetFileContentsTool(BaseTool):
    """
    Fetch a single GitHub repository file using gh CLI.

    The public tool name intentionally matches the previous GitHub MCP
    get_file_contents tool so existing policy and task configs keep working.
    """

    name: str = "get_file_contents"
    description: str = (
        "Fetch file contents or directory metadata from a GitHub repository using gh CLI. "
        "Use this when you need to read a specific file or inspect a repository directory. "
        "Requires owner and repo; path defaults to '/'. Optionally accepts ref or sha, "
        "with sha taking precedence over ref."
    )
    args_schema: type[BaseModel] = GHGetFileContentsInput

    def _validate_identifier(self, value: str, field_name: str) -> Optional[str]:
        if not value or not value.strip():
            return f"{field_name} cannot be empty"
        if "/" in value:
            return f"{field_name} must not contain '/'"
        if not re.match(r"^[A-Za-z0-9_.-]+$", value):
            return f"{field_name} contains unsupported characters"
        return None

    def _build_endpoint(
        self,
        owner: str,
        repo: str,
        path: str,
        ref: Optional[str],
        sha: Optional[str] = None,
    ) -> str:
        clean_path = path.strip().lstrip("/")
        endpoint = f"repos/{owner}/{repo}/contents"
        if clean_path:
            endpoint = f"{endpoint}/{quote(clean_path, safe='/')}"
        clean_ref = sha.strip() if sha and sha.strip() else (ref.strip() if ref else None)
        if clean_ref:
            endpoint = f"{endpoint}?ref={quote(clean_ref, safe='')}"
        return endpoint

    async def _execute_gh_api(
        self,
        command_parts: list[str],
        github_token: str,
    ) -> tuple[int, bytes, str]:
        env = os.environ.copy()
        _apply_github_auth_env(env, github_token)

        process = await asyncio.create_subprocess_exec(
            *command_parts,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=GH_CLI_TIMEOUT,
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            full_command = " ".join(shlex.quote(part) for part in command_parts)
            raise TimeoutError(f"Command timed out after {GH_CLI_TIMEOUT}s: {full_command}") from None

        stderr_text = stderr.decode("utf-8", errors="replace") if stderr else ""
        return process.returncode, stdout or b"", stderr_text

    def _truncate_output(self, output: str, label: str) -> str:
        if len(output) <= MAX_OUTPUT_SIZE:
            return output
        remaining = len(output) - MAX_OUTPUT_SIZE
        logger.warning("%s truncated to %s chars", label, MAX_OUTPUT_SIZE)
        return f"{output[:MAX_OUTPUT_SIZE]}\n\n... (truncated {remaining} characters)"

    def _file_metadata(self, payload: dict[str, Any]) -> dict[str, Any]:
        keys = ("name", "path", "sha", "size", "download_url", "html_url", "git_url", "url")
        return {key: payload[key] for key in keys if payload.get(key) is not None}

    def _directory_entry_metadata(self, entry: Any) -> dict[str, Any]:
        if not isinstance(entry, dict):
            return {"value": entry}
        keys = ("name", "path", "type", "sha", "size", "download_url", "html_url", "git_url", "url")
        return {key: entry[key] for key in keys if entry.get(key) is not None}

    def _render_directory_contents(self, payload: list[Any]) -> str:
        output = json.dumps(
            {
                "type": "directory",
                "entries": [self._directory_entry_metadata(entry) for entry in payload],
            },
            indent=2,
            sort_keys=True,
        )
        return sanitize_output(self._truncate_output(output, "gh directory listing output"))

    def _looks_like_text(self, content_bytes: bytes, path: str) -> bool:
        if not content_bytes:
            return True

        guessed_type, _ = mimetypes.guess_type(path)
        if guessed_type:
            is_text_mime = (
                guessed_type.startswith("text/")
                or guessed_type in {"application/json", "application/xml", "application/yaml"}
                or guessed_type.endswith("+json")
                or guessed_type.endswith("+xml")
            )
            if not is_text_mime:
                return False

        sample = content_bytes[:4096]
        if b"\x00" in sample:
            return False

        try:
            content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            return False

        control_count = sum(1 for byte in sample if byte < 32 and byte not in (9, 10, 13))
        return control_count <= max(8, len(sample) // 100)

    def _render_file_contents(
        self,
        payload: dict[str, Any],
        content_bytes: bytes,
        path: str,
    ) -> str:
        if self._looks_like_text(content_bytes, path):
            content = content_bytes.decode("utf-8")
            return sanitize_output(self._truncate_output(content, "gh file content output"))

        encoded = base64.b64encode(content_bytes).decode("ascii")
        metadata = self._file_metadata(payload)
        metadata.update(
            {
                "type": "file",
                "encoding": "base64",
                "content": encoded,
                "content_truncated": False,
            }
        )

        output = json.dumps(metadata, indent=2, sort_keys=True)
        if len(output) > MAX_OUTPUT_SIZE:
            budget = max(0, MAX_OUTPUT_SIZE - (len(output) - len(encoded)) - 200)
            metadata["content"] = encoded[:budget]
            metadata["content_truncated"] = True
            metadata["truncation_note"] = (
                f"Base64 content truncated from {len(encoded)} characters to fit "
                f"the {MAX_OUTPUT_SIZE} character tool output limit."
            )
            output = json.dumps(metadata, indent=2, sort_keys=True)

        return sanitize_output(self._truncate_output(output, "gh binary file content output"))

    async def _arun(
        self,
        owner: str,
        repo: str,
        path: str = "/",
        ref: Optional[str] = None,
        sha: Optional[str] = None,
    ) -> str:
        for value, field_name in ((owner, "owner"), (repo, "repo")):
            error = self._validate_identifier(value, field_name)
            if error:
                return f"❌ Error: {error}"

        clean_path = (path or "/").strip() or "/"

        github_token = get_github_token()
        if not github_token:
            return NO_GITHUB_AUTH_ERROR

        endpoint = self._build_endpoint(owner.strip(), repo.strip(), clean_path, ref, sha)
        command_parts = ["gh", "api", endpoint, "--method", "GET"]
        full_command = " ".join(shlex.quote(part) for part in command_parts)

        logger.info("Executing gh file fetch: %s", full_command)

        async with _gh_cli_semaphore:
            try:
                returncode, stdout, stderr_text = await self._execute_gh_api(command_parts, github_token)
                stdout_text = stdout.decode("utf-8", errors="replace") if stdout else ""

                if returncode != 0:
                    error_msg = stderr_text or stdout_text or "Unknown error"
                    logger.warning("gh file fetch failed (exit %s): %s", returncode, full_command)
                    return sanitize_output(f"❌ Command failed (exit {returncode}): {error_msg}")

                try:
                    payload = json.loads(stdout_text)
                except json.JSONDecodeError as exc:
                    return sanitize_output(f"❌ Error: GitHub API returned invalid JSON: {exc}")

                if isinstance(payload, list):
                    return self._render_directory_contents(payload)

                if not isinstance(payload, dict):
                    return "❌ Error: GitHub API returned an unexpected response for this path."

                if payload.get("type") != "file":
                    file_type = payload.get("type", "unknown")
                    return f"❌ Error: path points to a GitHub object of type '{file_type}', not a file."

                encoding = payload.get("encoding")
                raw_content = payload.get("content")
                if encoding == "base64" and raw_content is not None:
                    try:
                        normalized = "".join(str(raw_content).split())
                        content_bytes = base64.b64decode(normalized.encode("utf-8"))
                    except Exception as exc:
                        return sanitize_output(f"❌ Error: failed to decode GitHub file content: {exc}")

                    return self._render_file_contents(payload, content_bytes, clean_path)

                raw_command_parts = [
                    "gh",
                    "api",
                    endpoint,
                    "--method",
                    "GET",
                    "--header",
                    "Accept: application/vnd.github.raw",
                ]
                raw_full_command = " ".join(shlex.quote(part) for part in raw_command_parts)
                logger.info("Executing gh raw file fetch: %s", raw_full_command)
                raw_returncode, raw_stdout, raw_stderr_text = await self._execute_gh_api(
                    raw_command_parts,
                    github_token,
                )
                if raw_returncode != 0:
                    error_msg = (
                        raw_stderr_text
                        or raw_stdout.decode("utf-8", errors="replace")
                        or "Unknown error"
                    )
                    logger.warning("gh raw file fetch failed (exit %s): %s", raw_returncode, raw_full_command)
                    return sanitize_output(
                        "❌ Error: GitHub API did not return inline file content, "
                        f"and raw fetch failed (exit {raw_returncode}): {error_msg}"
                    )

                return self._render_file_contents(payload, raw_stdout, clean_path)

            except TimeoutError as exc:
                return sanitize_output(f"❌ {exc}")
            except FileNotFoundError:
                return "❌ Error: gh CLI not found. Please ensure it's installed in the container."
            except Exception as exc:
                logger.error("gh file fetch error: %s", str(exc), exc_info=True)
                return sanitize_output(f"❌ Error executing gh file fetch: {str(exc)}")

    def _run(
        self,
        owner: str,
        repo: str,
        path: str = "/",
        ref: Optional[str] = None,
        sha: Optional[str] = None,
    ) -> str:
        """Synchronous wrapper - not recommended, use _arun instead."""
        return asyncio.run(self._arun(owner=owner, repo=repo, path=path, ref=ref, sha=sha))


def get_gh_cli_tool() -> Optional[GHCLITool]:
    """
    Factory function to create gh CLI tool if enabled.

    Returns:
        GHCLITool instance if USE_GH_CLI_AS_TOOL=true, None otherwise

    Note: Write operations are allowed only when deterministic self-service mode
          is active; otherwise gh_cli_execute remains read-only.
    """
    use_gh_cli = os.getenv("USE_GH_CLI_AS_TOOL", "true").lower() == "true"

    if not use_gh_cli:
        logger.info("gh CLI tool is disabled (USE_GH_CLI_AS_TOOL=false)")
        return None

    logger.info("gh CLI tool enabled (self-service-gated write mode)")

    return GHCLITool(allow_write_operations=False)


def get_gh_file_contents_tool() -> Optional[GHGetFileContentsTool]:
    """
    Factory function to create the gh-backed file contents tool if enabled.

    Returns:
        GHGetFileContentsTool when USE_GH_FILE_CONTENTS_TOOL is not false.
    """
    use_file_tool = os.getenv("USE_GH_FILE_CONTENTS_TOOL", "true").lower() == "true"
    if not use_file_tool:
        logger.info("gh file contents tool is disabled (USE_GH_FILE_CONTENTS_TOOL=false)")
        return None

    logger.info("gh file contents tool enabled")
    return GHGetFileContentsTool()


# =============================================================================
# Git Operations Tool (imported from utils/agent_tools/)
# =============================================================================
# The generic `git` tool is imported from:
#   ai_platform_engineering.utils.agent_tools
#
# Usage:
#   git("clone https://github.com/org/repo.git /path/to/dir")
#   git("status", cwd="/path/to/repo")
#   git("log --oneline -10", cwd="/path/to/repo")
#   git("branch -a", cwd="/path/to/repo")
#   git("diff HEAD~1", cwd="/path/to/repo")
#   git("show HEAD:README.md", cwd="/path/to/repo")
#   git("remote -v", cwd="/path/to/repo")
#   git("pull origin main", cwd="/path/to/repo")
#   git("fetch --all", cwd="/path/to/repo")
#
# The tool automatically detects the git provider (GitHub/GitLab) from URLs
# and uses the appropriate authentication token.


# Export all tools for use by the GitHub agent
__all__ = [
    'GHCLITool',
    'GHGetFileContentsTool',
    'get_gh_cli_tool',
    'get_gh_file_contents_tool',
    # Generic git tool (from utils)
    'git',
    # Self-service mode (used by DeterministicTaskMiddleware)
    'self_service_mode_ctx',
    'set_self_service_mode',
    'is_self_service_mode',
]

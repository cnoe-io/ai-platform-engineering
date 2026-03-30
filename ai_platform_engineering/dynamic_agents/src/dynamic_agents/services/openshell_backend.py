"""OpenShell sandbox backend for deepagents.

Implements the deepagents SandboxBackendProtocol backed by an OpenShell
sandbox session. All file operations (read, write, edit, grep, glob, ls)
are inherited from BaseSandbox and executed as shell commands via execute().
Only execute(), upload_files(), and download_files() need concrete
implementations.
"""

from __future__ import annotations

import base64
import os
import shlex

from deepagents.backends.protocol import (
    ExecuteResponse,
    FileDownloadResponse,
    FileUploadResponse,
)
from deepagents.backends.sandbox import BaseSandbox
from openshell import SandboxSession


class OpenShellBackend(BaseSandbox):
    """deepagents SandboxBackendProtocol backed by an OpenShell sandbox.

    Wraps a live SandboxSession. All file operations (read, write, edit,
    grep, glob, ls) are inherited from BaseSandbox and executed as shell
    commands via execute(). Only execute(), upload_files(), and
    download_files() need concrete implementations.
    """

    def __init__(
        self,
        session: SandboxSession,
        *,
        default_timeout: int = 30 * 60,
    ) -> None:
        self._session = session
        self._default_timeout = default_timeout

    @property
    def id(self) -> str:
        return self._session.id

    @property
    def sandbox_name(self) -> str:
        return self._session._sandbox.name  # noqa: SLF001

    def execute(
        self,
        command: str,
        *,
        timeout: int | None = None,
    ) -> ExecuteResponse:
        """Run a shell command in the OpenShell sandbox.

        OpenShell's gRPC protocol rejects command arguments that contain
        newline or carriage-return characters.  When the LLM produces a
        multi-line command string we pipe it via stdin instead.
        """
        effective_timeout = timeout if timeout is not None else self._default_timeout

        if "\n" in command or "\r" in command:
            result = self._session.exec(
                ["bash"],
                stdin=command.encode(),
                timeout_seconds=effective_timeout,
            )
        else:
            result = self._session.exec(
                ["bash", "-c", command],
                timeout_seconds=effective_timeout,
            )
        output = result.stdout
        if result.stderr:
            output = f"{output}\n{result.stderr}" if output else result.stderr
        return ExecuteResponse(
            output=output,
            exit_code=result.exit_code,
            truncated=False,
        )

    def upload_files(self, files: list[tuple[str, bytes]]) -> list[FileUploadResponse]:
        """Upload files to the sandbox by piping raw bytes over stdin."""
        responses = []
        for path, content in files:
            try:
                parent = shlex.quote(os.path.dirname(path) or ".")
                dest = shlex.quote(path)
                result = self._session.exec(
                    ["bash", "-c", f"mkdir -p {parent} && cat > {dest}"],
                    stdin=content,
                )
                if result.exit_code != 0:
                    responses.append(FileUploadResponse(path=path, error="permission_denied"))
                else:
                    responses.append(FileUploadResponse(path=path, error=None))
            except Exception:  # noqa: BLE001
                responses.append(FileUploadResponse(path=path, error="permission_denied"))
        return responses

    def download_files(self, paths: list[str]) -> list[FileDownloadResponse]:
        """Download files from the sandbox via base64 encoding."""
        responses = []
        for path in paths:
            try:
                result = self._session.exec(["base64", path])
                if result.exit_code != 0:
                    responses.append(
                        FileDownloadResponse(path=path, content=None, error="file_not_found")
                    )
                else:
                    content = base64.b64decode(result.stdout.strip())
                    responses.append(FileDownloadResponse(path=path, content=content, error=None))
            except Exception:  # noqa: BLE001
                responses.append(
                    FileDownloadResponse(path=path, content=None, error="file_not_found")
                )
        return responses

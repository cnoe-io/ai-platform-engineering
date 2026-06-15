import asyncio
import base64
import json

from ai_platform_engineering.agents.github.agent_github import tools
from ai_platform_engineering.agents.github.agent_github.tools import (
    GHCLITool,
    GHGetFileContentsTool,
    get_gh_file_contents_tool,
)
from ai_platform_engineering.utils import github_app_token_provider


class _FakeProcess:
    def __init__(self, stdout_payload, stderr_payload=b"", returncode=0):
        self._stdout_payload = stdout_payload
        self._stderr_payload = stderr_payload
        self.returncode = returncode
        self.killed = False

    async def communicate(self):
        return self._stdout_payload, self._stderr_payload

    def kill(self):
        self.killed = True

    async def wait(self):
        return self.returncode


def test_get_file_contents_decodes_file_and_encodes_path(monkeypatch):
    captured = {}
    content = "hello from README\n"
    payload = {
        "type": "file",
        "encoding": "base64",
        "content": base64.b64encode(content.encode()).decode(),
    }

    async def fake_create_subprocess_exec(*args, **kwargs):
        captured["args"] = args
        captured["env"] = kwargs["env"]
        return _FakeProcess(json.dumps(payload).encode())

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    tool = GHGetFileContentsTool()
    result = asyncio.run(
        tool._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="/docs/read me.md",
            ref="feature/file read",
        )
    )

    assert tool.name == "get_file_contents"
    assert result == content
    assert captured["args"] == (
        "gh",
        "api",
        "repos/cnoe-io/ai-platform-engineering/contents/docs/read%20me.md?ref=feature%2Ffile%20read",
        "--method",
        "GET",
    )
    assert captured["env"]["GH_TOKEN"] == "token-value-1234567890"


def test_get_file_contents_returns_directory_response(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess(
            json.dumps(
                [
                    {
                        "type": "file",
                        "name": "README.md",
                        "path": "docs/README.md",
                        "sha": "abc123",
                    }
                ]
            ).encode()
        )

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="docs",
        )
    )

    directory = json.loads(result)
    assert directory == {
        "entries": [
            {
                "name": "README.md",
                "path": "docs/README.md",
                "sha": "abc123",
                "type": "file",
            }
        ],
        "type": "directory",
    }


def test_get_file_contents_sha_takes_precedence_over_ref(monkeypatch):
    captured = {}
    content = "pinned content\n"
    payload = {
        "type": "file",
        "encoding": "base64",
        "content": base64.b64encode(content.encode()).decode(),
    }

    async def fake_create_subprocess_exec(*args, **kwargs):
        captured["args"] = args
        return _FakeProcess(json.dumps(payload).encode())

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="README.md",
            ref="main",
            sha="abc123def456",
        )
    )

    assert result == content
    assert captured["args"] == (
        "gh",
        "api",
        "repos/cnoe-io/ai-platform-engineering/contents/README.md?ref=abc123def456",
        "--method",
        "GET",
    )


def test_get_file_contents_preserves_binary_as_base64(monkeypatch):
    binary = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    payload = {
        "type": "file",
        "name": "image.png",
        "path": "image.png",
        "sha": "def456",
        "encoding": "base64",
        "content": base64.b64encode(binary).decode(),
    }

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess(json.dumps(payload).encode())

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="image.png",
        )
    )

    rendered = json.loads(result)
    assert rendered["encoding"] == "base64"
    assert rendered["content"] == base64.b64encode(binary).decode()
    assert rendered["content_truncated"] is False
    assert rendered["sha"] == "def456"


def test_get_file_contents_fetches_raw_when_contents_api_omits_content(monkeypatch):
    calls = []
    payload = {
        "type": "file",
        "name": "large.txt",
        "path": "large.txt",
        "encoding": "none",
        "content": "",
        "download_url": "https://raw.githubusercontent.com/cnoe-io/repo/main/large.txt",
    }

    async def fake_create_subprocess_exec(*args, **_kwargs):
        calls.append(args)
        if len(calls) == 1:
            return _FakeProcess(json.dumps(payload).encode())
        return _FakeProcess(b"raw text from large file\n")

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="repo",
            path="large.txt",
        )
    )

    assert result == "raw text from large file\n"
    assert calls[1] == (
        "gh",
        "api",
        "repos/cnoe-io/repo/contents/large.txt",
        "--method",
        "GET",
        "--header",
        "Accept: application/vnd.github.raw",
    )


def test_get_file_contents_rejects_unexpected_response(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess(json.dumps("not a contents response").encode())

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="README.md",
        )
    )

    assert "unexpected response" in result


def test_get_file_contents_rejects_invalid_owner_without_calling_gh(monkeypatch):
    called = False

    async def fake_create_subprocess_exec(*_args, **_kwargs):
        nonlocal called
        called = True
        return _FakeProcess(b"{}")

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io/bad",
            repo="ai-platform-engineering",
            path="README.md",
        )
    )

    assert "owner must not contain '/'" in result
    assert called is False


def test_file_contents_tool_can_be_disabled(monkeypatch):
    monkeypatch.setenv("USE_GH_FILE_CONTENTS_TOOL", "false")

    assert get_gh_file_contents_tool() is None


def test_gh_cli_write_commands_require_self_service_mode():
    tool = GHCLITool()

    is_valid, error = tool._validate_command("pr create --repo cnoe-io/repo --title t --body b")
    assert is_valid is False
    assert "self-service" in error

    tools.set_self_service_mode(True)
    try:
        is_valid, error = tool._validate_command("pr create --repo cnoe-io/repo --title t --body b")
    finally:
        tools.set_self_service_mode(False)

    assert is_valid is True
    assert error == ""


def test_github_token_provider_honors_gh_token(monkeypatch):
    monkeypatch.setattr(github_app_token_provider, "_provider", None)
    monkeypatch.delenv("GITHUB_APP_ID", raising=False)
    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.delenv("GITHUB_APP_INSTALLATION_ID", raising=False)
    monkeypatch.delenv("GITHUB_PERSONAL_ACCESS_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("GH_TOKEN", "gh-token-value")

    assert github_app_token_provider.get_github_token() == "gh-token-value"

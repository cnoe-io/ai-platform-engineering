import asyncio
import base64
import json

from ai_platform_engineering.agents.github.agent_github import tools
from ai_platform_engineering.agents.github.agent_github.tools import (
    GHGetFileContentsTool,
    get_gh_file_contents_tool,
)


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


def test_gh_get_file_contents_decodes_file_and_encodes_path(monkeypatch):
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

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="/docs/read me.md",
            ref="feature/file read",
        )
    )

    assert result == content
    assert captured["args"] == (
        "gh",
        "api",
        "repos/cnoe-io/ai-platform-engineering/contents/docs/read%20me.md?ref=feature%2Ffile%20read",
        "--method",
        "GET",
    )
    assert captured["env"]["GH_TOKEN"] == "token-value-1234567890"


def test_gh_get_file_contents_rejects_directory_response(monkeypatch):
    async def fake_create_subprocess_exec(*_args, **_kwargs):
        return _FakeProcess(json.dumps([{"type": "file", "name": "README.md"}]).encode())

    monkeypatch.setattr(tools, "get_github_token", lambda: "token-value-1234567890")
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = asyncio.run(
        GHGetFileContentsTool()._arun(
            owner="cnoe-io",
            repo="ai-platform-engineering",
            path="docs",
        )
    )

    assert "path points to a directory" in result


def test_gh_get_file_contents_rejects_unexpected_response(monkeypatch):
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


def test_gh_get_file_contents_rejects_invalid_owner_without_calling_gh(monkeypatch):
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


def test_gh_file_contents_tool_can_be_disabled(monkeypatch):
    monkeypatch.setenv("USE_GH_FILE_CONTENTS_TOOL", "false")

    assert get_gh_file_contents_tool() is None

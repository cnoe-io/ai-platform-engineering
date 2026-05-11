import base64
import json
from types import SimpleNamespace

from langchain_core.messages import ToolMessage
from langgraph.types import Command

from dynamic_agents.services.mcp_file_persistence import MCPFilePersistenceMiddleware


def _request(tool_name: str = "confluence_confluence_download_attachment"):
    return SimpleNamespace(tool_call={"name": tool_name, "id": "call/abc.123"})


async def _run_middleware(message: ToolMessage, tool_name: str = "confluence_confluence_download_attachment"):
    middleware = MCPFilePersistenceMiddleware()

    async def handler(_request):
        return message

    return await middleware.awrap_tool_call(_request(tool_name), handler)


def _file_text(command: Command, path: str) -> str:
    file_data = command.update["files"][path]
    return "\n".join(file_data["content"])


async def test_persists_mcp_file_block_to_filesystem():
    encoded = base64.b64encode(b"hello from confluence\n").decode("ascii")
    message = ToolMessage(
        content=[
            {
                "type": "file",
                "name": "notes.vtt",
                "mime_type": "text/vtt",
                "base64": encoded,
            }
        ],
        tool_call_id="call/abc.123",
    )

    result = await _run_middleware(message)

    assert isinstance(result, Command)
    files = result.update["files"]
    path = "/mcp_downloads/confluence_confluence_download_attachment/call_abc_123/notes.vtt"
    assert sorted(files) == [path]
    assert _file_text(result, path) == "hello from confluence\n"
    saved_message = result.update["messages"][0]
    assert isinstance(saved_message, ToolMessage)
    assert path in saved_message.content


async def test_persists_inlined_text_download_body_for_download_tools():
    body = {
        "body": "downloaded text",
        "bodyFormat": "text",
        "mimeType": "text/plain",
        "sizeBytes": 15,
        "name": "report.txt",
    }
    message = ToolMessage(content=json.dumps(body), tool_call_id="call-1")

    result = await _run_middleware(message)

    assert isinstance(result, Command)
    path = "/mcp_downloads/confluence_confluence_download_attachment/call-1/report.txt"
    assert sorted(result.update["files"]) == [path]
    assert _file_text(result, path) == "downloaded text"
    assert path in result.update["messages"][0].content


async def test_does_not_treat_plain_json_as_file_for_non_download_tool():
    message = ToolMessage(
        content=json.dumps({"body": "ordinary response", "mimeType": "text/plain", "name": "not-a-file.txt"}),
        tool_call_id="call-1",
    )

    result = await _run_middleware(message, tool_name="confluence_search")

    assert result is message


async def test_binary_file_block_is_saved_as_base64_json():
    encoded = base64.b64encode(b"\x89PNG\r\n").decode("ascii")
    message = ToolMessage(
        content=[
            {
                "type": "file",
                "name": "image.png",
                "mime_type": "image/png",
                "base64": encoded,
            }
        ],
        tool_call_id="call-1",
    )

    result = await _run_middleware(message, tool_name="some_server_download_file")

    assert isinstance(result, Command)
    path = "/mcp_downloads/some_server_download_file/call-1/image.png.base64.json"
    saved = json.loads(_file_text(result, path))
    assert saved["encoding"] == "base64"
    assert saved["base64"] == encoded
    assert path in result.update["messages"][0].content

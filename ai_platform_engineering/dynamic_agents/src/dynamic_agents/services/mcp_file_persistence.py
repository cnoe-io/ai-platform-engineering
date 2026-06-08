"""Persist MCP file/download tool results into the deepagents filesystem."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import mimetypes
import os
import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ToolCallRequest
from langchain_core.messages import ToolMessage
from langgraph.types import Command

logger = logging.getLogger(__name__)

_TEXT_FILE_MIME_TYPES = {
    "application/json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/csv",
    "application/x-ndjson",
    "text/vtt",
}
_TEXT_FILE_EXTENSIONS = {
    ".csv",
    ".htm",
    ".html",
    ".json",
    ".jsonl",
    ".log",
    ".md",
    ".rst",
    ".text",
    ".txt",
    ".vtt",
    ".xml",
    ".yaml",
    ".yml",
}
_DEFAULT_MAX_BYTES = 5 * 1024 * 1024


@dataclass(frozen=True)
class _PersistedFile:
    path: str
    content: str
    name: str
    mime_type: str | None
    size_bytes: int | None
    encoding: str


def _create_file_data(content: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "content": content.split("\n"),
        "created_at": now,
        "modified_at": now,
    }


def _max_bytes() -> int:
    raw = os.getenv("DA_MCP_FILE_MAX_BYTES")
    if not raw:
        return _DEFAULT_MAX_BYTES
    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid DA_MCP_FILE_MAX_BYTES=%r; using default %d", raw, _DEFAULT_MAX_BYTES)
        return _DEFAULT_MAX_BYTES
    return max(value, 0)


def _tool_name(request: ToolCallRequest) -> str:
    call = getattr(request, "tool_call", None)
    if isinstance(call, dict):
        name = call.get("name")
        return name if isinstance(name, str) else "unknown"
    name = getattr(call, "name", None)
    return name if isinstance(name, str) else "unknown"


def _tool_call_id(request: ToolCallRequest, message: ToolMessage | None = None) -> str:
    if message is not None:
        msg_id = getattr(message, "tool_call_id", None)
        if isinstance(msg_id, str) and msg_id:
            return msg_id
    call = getattr(request, "tool_call", None)
    if isinstance(call, dict):
        call_id = call.get("id")
        return call_id if isinstance(call_id, str) and call_id else "tool_call"
    call_id = getattr(call, "id", None)
    return call_id if isinstance(call_id, str) and call_id else "tool_call"


def _safe_segment(value: str, *, fallback: str, max_len: int = 120, basename: bool = False) -> str:
    if basename:
        value = PurePosixPath(value).name
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._-")
    if not value:
        value = fallback
    return value[:max_len]


def _is_download_tool(tool_name: str) -> bool:
    normalized = tool_name.lower()
    return (
        normalized == "confluence_confluence_download_attachment"
        or normalized.endswith("_download_attachment")
        or normalized.endswith("_download_file")
    )


def _is_text_mime(mime_type: str | None, name: str | None = None) -> bool:
    mime = (mime_type or "").lower()
    if mime.startswith("text/") or mime in _TEXT_FILE_MIME_TYPES:
        return True
    if mime.endswith("+json") or mime.endswith("+xml"):
        return True
    suffix = PurePosixPath(name or "").suffix.lower()
    return suffix in _TEXT_FILE_EXTENSIONS


def _mime_extension(mime_type: str | None) -> str:
    if not mime_type:
        return ""
    if mime_type == "text/vtt":
        return ".vtt"
    return mimetypes.guess_extension(mime_type) or ""


def _as_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            dumped = model_dump()
        except Exception:  # noqa: BLE001
            return None
        return dumped if isinstance(dumped, dict) else None
    return None


def _iter_dict_payloads(payload: Any) -> Iterable[dict[str, Any]]:
    data = _as_dict(payload)
    if data is not None:
        yield data
        for key in ("content", "contents", "items", "otherContent", "resource", "resources"):
            value = data.get(key)
            if isinstance(value, (list, tuple)):
                for item in value:
                    yield from _iter_dict_payloads(item)
            elif value is not None:
                yield from _iter_dict_payloads(value)
        return
    if isinstance(payload, (list, tuple)):
        for item in payload:
            yield from _iter_dict_payloads(item)


def _json_payloads_from_string(content: str) -> Iterable[dict[str, Any]]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return []
    return list(_iter_dict_payloads(parsed))


def _candidate_name(data: dict[str, Any], index: int, mime_type: str | None) -> str:
    for key in ("name", "filename", "fileName", "title"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    uri = data.get("uri")
    if isinstance(uri, str) and uri:
        name = PurePosixPath(uri).name
        if name:
            return name
    return f"download-{index}{_mime_extension(mime_type)}"


def _extract_mime_type(data: dict[str, Any]) -> str | None:
    for key in ("mime_type", "mimeType", "mime", "content_type", "contentType"):
        value = data.get(key)
        if isinstance(value, str) and value:
            return value.lower()
    return None


def _extract_size(data: dict[str, Any], decoded: bytes | None, text: str | None) -> int | None:
    for key in ("sizeBytes", "size_bytes", "size", "length"):
        value = data.get(key)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    if decoded is not None:
        return len(decoded)
    if text is not None:
        return len(text.encode("utf-8"))
    return None


def _decode_base64(encoded: str) -> bytes | None:
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None


def _is_file_candidate(data: dict[str, Any]) -> bool:
    type_value = data.get("type")
    if type_value == "file":
        return isinstance(data.get("base64"), str) or isinstance(data.get("data"), str)
    if "body" in data and ("mimeType" in data or "mime_type" in data or "bodyFormat" in data):
        return True
    if isinstance(data.get("text"), str) and ("mimeType" in data or "mime_type" in data or "uri" in data):
        return True
    return any(isinstance(data.get(key), str) for key in ("blob", "base64")) and (
        "mimeType" in data or "mime_type" in data or "uri" in data or "name" in data
    )


def _file_content_from_candidate(
    data: dict[str, Any],
    name: str,
    mime_type: str | None,
) -> tuple[str, int | None, str] | None:
    body = data.get("body")
    if isinstance(body, str):
        return body, _extract_size(data, None, body), "text"

    body_error = data.get("bodyError")
    if isinstance(body_error, str):
        size = _extract_size(data, None, None)
        content = json.dumps(
            {
                "name": name,
                "mime_type": mime_type,
                "size_bytes": size,
                "error": body_error,
            },
            ensure_ascii=False,
            indent=2,
        )
        return content, size, "metadata"

    text = data.get("text")
    if isinstance(text, str):
        return text, _extract_size(data, None, text), "text"

    encoded = data.get("base64")
    if not isinstance(encoded, str):
        encoded = data.get("blob")
    if not isinstance(encoded, str):
        data_value = data.get("data")
        if isinstance(data_value, str) and _is_text_mime(mime_type, name):
            return data_value, _extract_size(data, None, data_value), "text"
        return None

    decoded = _decode_base64(encoded)
    if decoded is None:
        return None

    if _is_text_mime(mime_type, name):
        text_content = decoded.decode("utf-8-sig", errors="replace")
        return text_content, _extract_size(data, decoded, text_content), "text"

    content = json.dumps(
        {
            "name": name,
            "mime_type": mime_type,
            "encoding": "base64",
            "size_bytes": len(decoded),
            "base64": encoded,
        },
        ensure_ascii=False,
        indent=2,
    )
    return content, len(decoded), "base64"


def _too_large_placeholder(name: str, mime_type: str | None, size_bytes: int, max_bytes: int) -> str:
    return json.dumps(
        {
            "name": name,
            "mime_type": mime_type,
            "size_bytes": size_bytes,
            "error": "attachment_too_large_for_state_filesystem",
            "max_bytes": max_bytes,
            "message": (
                "This MCP download was detected, but its contents were not stored in the "
                "conversation filesystem because it exceeds DA_MCP_FILE_MAX_BYTES."
            ),
        },
        ensure_ascii=False,
        indent=2,
    )


def _build_path(tool_name: str, tool_call_id: str, name: str, encoding: str) -> str:
    tool_segment = _safe_segment(tool_name, fallback="mcp_tool")
    call_segment = _safe_segment(tool_call_id, fallback="tool_call", max_len=80).replace(".", "_")
    file_segment = _safe_segment(name, fallback="download", basename=True)
    if encoding == "base64" and not file_segment.endswith(".base64.json"):
        file_segment = f"{file_segment}.base64.json"
    return f"/mcp_downloads/{tool_segment}/{call_segment}/{file_segment}"


def _dedupe_path(path: str, used_paths: set[str]) -> str:
    if path not in used_paths:
        used_paths.add(path)
        return path

    suffix = 2
    original = PurePosixPath(path)
    stem = original.name
    extension = ""
    if "." in original.name:
        stem, extension = original.name.rsplit(".", 1)
        extension = f".{extension}"

    while True:
        candidate = f"{original.parent}/{stem}-{suffix}{extension}"
        if candidate not in used_paths:
            used_paths.add(candidate)
            return candidate
        suffix += 1


def _extract_files_from_payloads(
    payloads: Iterable[Any],
    *,
    tool_name: str,
    tool_call_id: str,
) -> list[_PersistedFile]:
    max_bytes = _max_bytes()
    files: list[_PersistedFile] = []
    seen: set[str] = set()
    used_paths: set[str] = set()
    counter = 0

    for payload in payloads:
        for data in _iter_dict_payloads(payload):
            if not _is_file_candidate(data):
                continue

            counter += 1
            mime_type = _extract_mime_type(data)
            name = _candidate_name(data, counter, mime_type)
            extracted = _file_content_from_candidate(data, name, mime_type)
            if extracted is None:
                continue

            content, size_bytes, encoding = extracted
            if size_bytes is not None and max_bytes and size_bytes > max_bytes:
                content = _too_large_placeholder(name, mime_type, size_bytes, max_bytes)
                encoding = "metadata"

            fingerprint_source = f"{name}\0{mime_type}\0{size_bytes}\0{content[:4096]}"
            fingerprint = hashlib.sha256(fingerprint_source.encode("utf-8")).hexdigest()
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            path = _dedupe_path(_build_path(tool_name, tool_call_id, name, encoding), used_paths)
            files.append(
                _PersistedFile(
                    path=path,
                    content=content,
                    name=name,
                    mime_type=mime_type,
                    size_bytes=size_bytes,
                    encoding=encoding,
                )
            )

    return files


def _extract_files(message: ToolMessage, *, tool_name: str, tool_call_id: str) -> list[_PersistedFile]:
    payloads: list[Any] = [message.content, getattr(message, "artifact", None)]
    if _is_download_tool(tool_name) and isinstance(message.content, str):
        payloads.extend(_json_payloads_from_string(message.content))
    return _extract_files_from_payloads(payloads, tool_name=tool_name, tool_call_id=tool_call_id)


def _saved_files_note(files: list[_PersistedFile]) -> str:
    lines = ["Saved MCP download result to the conversation filesystem:"]
    for file in files:
        details = []
        if file.mime_type:
            details.append(file.mime_type)
        if file.size_bytes is not None:
            details.append(f"{file.size_bytes} bytes")
        if file.encoding != "text":
            details.append(file.encoding)
        suffix = f" ({', '.join(details)})" if details else ""
        lines.append(f"- {file.path}{suffix}")
    lines.append("Use read_file with the saved path to inspect it.")
    return "\n".join(lines)


def _replace_tool_message_content(message: ToolMessage, files: list[_PersistedFile]) -> ToolMessage:
    return ToolMessage(
        content=_saved_files_note(files),
        tool_call_id=message.tool_call_id,
        name=message.name,
        id=message.id,
        artifact=message.artifact,
        status=message.status,
        additional_kwargs=dict(message.additional_kwargs),
        response_metadata=dict(message.response_metadata),
    )


class MCPFilePersistenceMiddleware(AgentMiddleware):
    """Save MCP file/download results into the StateBackend ``files`` channel."""

    @property
    def name(self) -> str:
        return "MCPFilePersistenceMiddleware"

    def _persist_result(
        self,
        request: ToolCallRequest,
        result: ToolMessage | Command[Any],
    ) -> ToolMessage | Command[Any]:
        tool_name = _tool_name(request)

        if isinstance(result, ToolMessage):
            if getattr(result, "status", None) == "error":
                return result
            tool_call_id = _tool_call_id(request, result)
            files = _extract_files(result, tool_name=tool_name, tool_call_id=tool_call_id)
            if not files:
                return result
            logger.info("Persisted %d MCP file result(s) for tool %s", len(files), tool_name)
            return Command(
                update={
                    "files": {file.path: _create_file_data(file.content) for file in files},
                    "messages": [_replace_tool_message_content(result, files)],
                }
            )

        update = result.update
        if not isinstance(update, dict):
            return result

        messages = update.get("messages", [])
        if not isinstance(messages, list):
            return result

        files_update = dict(update.get("files", {})) if isinstance(update.get("files"), dict) else {}
        processed_messages: list[Any] = []
        changed = False
        for message in messages:
            if not isinstance(message, ToolMessage) or getattr(message, "status", None) == "error":
                processed_messages.append(message)
                continue
            tool_call_id = _tool_call_id(request, message)
            files = _extract_files(message, tool_name=tool_name, tool_call_id=tool_call_id)
            if not files:
                processed_messages.append(message)
                continue
            changed = True
            files_update.update({file.path: _create_file_data(file.content) for file in files})
            processed_messages.append(_replace_tool_message_content(message, files))

        if not changed:
            return result
        logger.info("Persisted MCP file result(s) from Command for tool %s", tool_name)
        return Command(update={**update, "files": files_update, "messages": processed_messages})

    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command[Any]],
    ) -> ToolMessage | Command[Any]:
        return self._persist_result(request, handler(request))

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        return self._persist_result(request, await handler(request))

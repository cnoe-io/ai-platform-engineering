# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0
"""Tests for card-aware message reading in the Webex MCP server."""
import httpx
import pytest
from fastmcp import Client, FastMCP

from mcp_server import _format_message, register_tools

CARD = {
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
        "type": "AdaptiveCard",
        "body": [
            {"type": "TextBlock", "text": "Provision a new GridKlaw"},
            {"type": "Input.Text", "id": "name", "label": "GridKlaw name"},
        ],
    },
}
CARD_MSG = {
    "id": "MSG123",
    "personEmail": "gridfather@example.bot",
    "created": "2026-06-29T00:00:00.000Z",
    "text": "Open the card to continue",
    "attachments": [CARD],
}


def _client_for(handler):
    return httpx.AsyncClient(
        base_url="https://webexapis.com/v1", transport=httpx.MockTransport(handler)
    )


def _text(result):
    content = getattr(result, "content", result)
    if isinstance(content, list) and content:
        return getattr(content[0], "text", str(content[0]))
    return str(content)


def test_format_message_surfaces_id_and_card():
    out = _format_message(CARD_MSG)
    assert "ID: MSG123" in out
    assert "Open the card to continue" in out
    # The card body (prompts/inputs) must be readable, not just the fallback text.
    assert "Provision a new GridKlaw" in out
    assert "Input.Text" in out


def test_format_message_without_attachments():
    out = _format_message({"id": "M2", "personEmail": "a@b", "text": "hi"})
    assert "ID: M2" in out
    assert "Attachments" not in out


@pytest.mark.asyncio
async def test_get_message_returns_card():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        assert request.headers.get("Authorization") == "Bearer tok"
        return httpx.Response(200, json=CARD_MSG)

    server = FastMCP("test")
    register_tools(server, auth_token="tok", http_client=_client_for(handler))
    async with Client(server) as client:
        result = await client.call_tool("get_message", {"args": {"message_id": "MSG123"}})
    assert seen["path"].endswith("/messages/MSG123")
    text = _text(result)
    assert "ID: MSG123" in text
    assert "Provision a new GridKlaw" in text


@pytest.mark.asyncio
async def test_list_direct_messages_includes_id_and_card():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/messages")
        assert request.url.params.get("personEmail") == "gridfather@example.bot"
        return httpx.Response(200, json={"items": [CARD_MSG]})

    server = FastMCP("test")
    register_tools(server, auth_token="tok", http_client=_client_for(handler))
    async with Client(server) as client:
        result = await client.call_tool(
            "list_direct_messages",
            {"args": {"person_email": "gridfather@example.bot"}},
        )
    text = _text(result)
    assert "ID: MSG123" in text
    assert "Provision a new GridKlaw" in text


@pytest.mark.asyncio
async def test_list_messages_in_room_mention_filter_opt_out():
    def handler(request: httpx.Request) -> httpx.Response:
        assert "mentionedPeople" not in request.url.params
        return httpx.Response(200, json={"items": [CARD_MSG]})

    server = FastMCP("test")
    register_tools(server, auth_token="tok", http_client=_client_for(handler))
    async with Client(server) as client:
        result = await client.call_tool(
            "list_messages_in_room",
            {"args": {"room_id": "ROOM1", "mentioned_only": False}},
        )
    assert "Provision a new GridKlaw" in _text(result)


@pytest.mark.asyncio
async def test_list_messages_in_room_defaults_to_mentioned():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params.get("mentionedPeople") == "me"
        return httpx.Response(200, json={"items": []})

    server = FastMCP("test")
    register_tools(server, auth_token="tok", http_client=_client_for(handler))
    async with Client(server) as client:
        await client.call_tool("list_messages_in_room", {"args": {"room_id": "ROOM1"}})

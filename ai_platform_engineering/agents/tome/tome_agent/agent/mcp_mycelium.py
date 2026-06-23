"""In-process MCP server exposing the project's Mycelium "Talk page" to the agent.

The Talk page is the conversation *about* a project (one Mycelium room per
project, `room == slug`). The wiki holds the context; Talk holds the discussion.
This lets the ingest/chat agent read that discussion — decisions, open
questions, what people/agents are saying — and weave it into the wiki.

Read-only: the agent reads Talk, it does not post. Mycelium's backend is
unauthenticated and internal-only; `MYCELIUM_URL` points at it (e.g.
http://mycelium-backend:8000). Scoped to a single room (the project's slug),
mirroring the repo/space/room allowlists on the other connectors.

Tool: talk_read_messages(limit?, offset?) — newest-first, paginated.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_mycelium_mcp(room_name: str = ""):
    """Create the MCP server for reading a project's Talk room.

    `room_name` is the Mycelium room (the CAIPE project slug). The tool refuses
    to read any other room. `MYCELIUM_URL` must be set or the tool returns a
    clean error.
    """

    base_url = os.environ.get("MYCELIUM_URL", "").strip().rstrip("/")
    _room = (room_name or "").strip()

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for attempt in range(3):
                resp = await client.get(f"{base_url}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                await asyncio.sleep(min(int(resp.headers.get("Retry-After", "5")), 60))

    @tool(
        "talk_read_messages",
        "Read the project's Talk page — the conversation ABOUT this project "
        "(decisions, open questions, what people and agents are discussing), as "
        "opposed to the wiki which holds the context itself. Returns messages "
        "NEWEST-FIRST with sender, content, type, and timestamp. Optional "
        "`limit` (default 100, max 500) and `offset` (for older pages). Use this "
        "to weave recent discussion into the wiki; do not transcribe it verbatim.",
        {"limit": int, "offset": int},
    )
    async def read_messages(args: dict) -> dict[str, Any]:
        if not base_url:
            return _err("Talk page is not configured (MYCELIUM_URL unset).")
        if not _room:
            return _err("No Talk room is associated with this project.")
        limit = min(int(args.get("limit") or 100), 500)
        offset = max(int(args.get("offset") or 0), 0)
        try:
            data = await _get(
                f"/api/rooms/{_room}/messages",
                {"limit": limit, "offset": offset},
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return _ok({"messages": [], "note": "no Talk room yet for this project"})
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        except httpx.HTTPError as e:
            return _err(f"could not reach Mycelium: {e}")
        out = [
            {
                "sender": m.get("sender_handle"),
                "type": m.get("message_type"),
                "content": m.get("content"),
                "created_at": m.get("created_at"),
            }
            for m in (data.get("messages") or [])
        ]
        return _ok({"room": _room, "count": len(out), "messages": out})

    return create_sdk_mcp_server(
        name="mycelium",
        version="0.1.0",
        tools=[read_messages],
    )

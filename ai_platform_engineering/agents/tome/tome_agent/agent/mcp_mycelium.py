"""In-process MCP server exposing the project's Mycelium Feed to the agent.

The Feed is the conversation *about* a project, plus its live activity (one
Mycelium room per project, `room == slug`). The wiki holds the context; the
Feed holds the discussion and the signal around it. This lets the
ingest/chat agent read that discussion — decisions, open questions, what
people/agents are saying — and weave it into the wiki, and (for the chat
agent) promote a concern raised in a private 1:1 into the shared Feed.

Mycelium's backend is unauthenticated and internal-only; `MYCELIUM_URL`
points at it (e.g. http://mycelium-backend:8000). Scoped to a single room
(the project's slug), mirroring the repo/space/room allowlists on the other
connectors.

Tools:
  feed_read_messages(limit?, offset?) — newest-first, paginated.
  feed_promote(summary, cited?) — post a highlighted `promoted_action` event
    (Mycelium's typed `event` message, same primitive the source-activity
    and ingest-lifecycle feed events use), not a plain chat message.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool

from tome_agent.agent import http_client


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_mycelium_mcp(room_name: str = ""):
    """Create the MCP server for a project's Feed room.

    `room_name` is the Mycelium room (the CAIPE project slug). The tools
    refuse to touch any other room. `MYCELIUM_URL` must be set or a tool
    returns a clean error.
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

    async def _post(path: str, body: dict[str, Any]) -> Any:
        async with httpx.AsyncClient(timeout=20.0) as client:
            for attempt in range(3):
                resp = await client.post(f"{base_url}{path}", json=body)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                await asyncio.sleep(min(int(resp.headers.get("Retry-After", "5")), 60))

    async def _ensure_room() -> None:
        """Create the room if it doesn't exist yet. Idempotent — tolerates the
        create racing another writer (409/400), mirroring mycelium.ts's
        `ensureRoom` on the caipe-ui side."""
        async with httpx.AsyncClient(timeout=20.0) as client:
            existing = await client.get(f"{base_url}/api/rooms/{_room}")
            if existing.status_code == 200:
                return
            created = await client.post(
                f"{base_url}/api/rooms",
                json={"name": _room, "description": f"Tome feed for {_room}", "is_public": True},
            )
            if created.status_code not in (200, 201, 409, 400):
                created.raise_for_status()

    @tool(
        "feed_read_messages",
        "Read the project's Feed — the conversation ABOUT this project "
        "(decisions, open questions, what people and agents are discussing), as "
        "opposed to the wiki which holds the context itself. Returns messages "
        "NEWEST-FIRST with sender, content, type, and timestamp. Optional "
        "`limit` (default 100, max 500) and `offset` (for older pages). Use this "
        "to weave recent discussion into the wiki; do not transcribe it verbatim.",
        {"limit": int, "offset": int},
    )
    async def read_messages(args: dict) -> dict[str, Any]:
        if not base_url:
            return _err("The Feed is not configured (MYCELIUM_URL unset).")
        if not _room:
            return _err("No Feed room is associated with this project.")
        limit = min(int(args.get("limit") or 100), 500)
        offset = max(int(args.get("offset") or 0), 0)
        try:
            data = await _get(
                f"/api/rooms/{_room}/messages",
                {"limit": limit, "offset": offset},
            )
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return _ok({"messages": [], "note": "no Feed room yet for this project"})
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

    @tool(
        "feed_promote",
        "Promote a concern, decision, or action from a private 1:1 chat into "
        "this project's shared Feed as a highlighted, citable entry — not "
        "ordinary chat. Use when something discussed 1:1 needs visibility "
        "beyond that conversation (a blocker, a decision, an ask). `summary` "
        "is required; `cited` (tome:// refs backing it) is optional but "
        "strongly recommended.",
        {"summary": str, "cited": list},
    )
    async def promote(args: dict) -> dict[str, Any]:
        if not base_url:
            return _err("The Feed is not configured (MYCELIUM_URL unset).")
        if not _room:
            return _err("No Feed room is associated with this project.")
        summary = str(args.get("summary") or "").strip()
        if not summary:
            return _err("`summary` is required.")
        cited = [str(c) for c in (args.get("cited") or [])]
        # Attribute to the actual chatting user (set per-request via
        # `http_client.set_active_actor_email`), falling back to a generic
        # handle if the caller (e.g. an ingest run) has none.
        sender = http_client.get_active_actor_email() or "tome"
        try:
            await _ensure_room()
            data = await _post(
                f"/api/rooms/{_room}/messages",
                {
                    "sender_handle": sender,
                    "recipient_handle": None,
                    "message_type": "event",
                    "content": summary,
                    "metadata": {
                        "kind": "promoted_action",
                        "payload": {"source_ref": "chat", "cited": cited},
                    },
                },
            )
        except httpx.HTTPError as e:
            return _err(f"could not reach Mycelium: {e}")
        message_id = data.get("id")
        return _ok(
            {
                "posted": True,
                "id": message_id,
                "link": f"tome://@{_room}/feed/{message_id}",
                "note": (
                    "Tell the user, and link them to it with markdown like "
                    f"[view in the Feed](tome://@{_room}/feed/{message_id}) — that "
                    "link scrolls to and highlights this exact message."
                ),
            }
        )

    return create_sdk_mcp_server(
        name="mycelium",
        version="0.1.0",
        tools=[read_messages, promote],
    )

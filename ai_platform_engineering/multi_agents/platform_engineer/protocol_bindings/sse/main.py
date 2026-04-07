# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Platform Engineer SSE Streaming Server

Simple FastAPI application that exposes a single SSE endpoint for
human-facing interfaces (UI, Slack bot).  The A2A protocol is used
exclusively for agent-to-agent communication; this server is for
direct human ↔ supervisor interaction.

Endpoints
---------
POST /chat/stream
    Stream a response for a user message as Server-Sent Events.

GET  /health
    Liveness probe.

GET  /ready
    Readiness probe (returns 503 until the supervisor graph is built).
"""

from __future__ import annotations

import logging

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from ai_platform_engineering.utils.logging_config import configure_logging
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.sse.stream_handler import (
    generate_sse_events,
    get_mas,
)
from ai_platform_engineering.skills_middleware.router import router as skills_router
from ai_platform_engineering.skills_middleware.mas_registry import set_mas_instance
from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.turns_routes import (
    router as turns_router,
)

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

load_dotenv()
configure_logging()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Request model
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    """Payload for a single chat turn."""

    message: str
    conversation_id: str | None = None
    user_id: str | None = None
    user_email: str | None = None
    trace_id: str | None = None
    # Source hints for persistence metadata
    source: str = "web"  # "web" | "slack"
    # Slack-specific metadata (ignored for web requests)
    slack_channel_id: str | None = None
    slack_thread_ts: str | None = None


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Platform Engineer SSE",
    description=(
        "Simple SSE streaming endpoint for UI and Slack interfaces. "
        "Use the A2A endpoint for agent-to-agent communication."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Skills catalog REST API (GET /skills, POST /skills/refresh, …)
app.include_router(skills_router)

# Conversation / turn rehydration routes
app.include_router(turns_router)

# ---------------------------------------------------------------------------
# Supervisor initialisation
# ---------------------------------------------------------------------------

# Eagerly initialise the MAS singleton at startup so the first request does
# not pay the cold-start penalty.
_mas = get_mas()
set_mas_instance(_mas)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/chat/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    """
    Stream a supervisor response as Server-Sent Events.

    Each event is a JSON-encoded object on a ``data:`` line followed by a
    blank line (standard SSE format).

    Event types
    -----------
    ``{"type": "content", "text": "..."}``
        A text chunk from the LLM.

    ``{"type": "tool_start", "tool": "jira", "description": "..."}``
        A tool or sub-agent invocation has begun.

    ``{"type": "tool_end", "tool": "jira"}``
        A tool or sub-agent invocation has completed.

    ``{"type": "plan_update", "plan": "..."}``
        The supervisor wrote or updated its execution plan.

    ``{"type": "input_required", "content": "...", "fields": [...]}``
        The supervisor requires user input (HITL).  ``fields`` is present
        when the request came from ``request_user_input``.

    ``{"type": "done", "turn_id": "..."}``
        The stream is complete.  ``turn_id`` can be used to query persisted
        events via ``GET /api/v1/conversations/{conversation_id}/turns/{turn_id}/events``.

    ``{"type": "error", "message": "..."}``
        An unrecoverable error terminated the stream.
    """
    return StreamingResponse(
        generate_sse_events(
            message=request.message,
            conversation_id=request.conversation_id,
            user_id=request.user_id,
            user_email=request.user_email,
            trace_id=request.trace_id,
            source=request.source,
            slack_channel_id=request.slack_channel_id,
            slack_thread_ts=request.slack_thread_ts,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering for SSE
        },
    )


@app.get("/health")
async def health() -> dict:
    """Liveness probe — always returns 200 when the process is alive."""
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness probe — returns 200 once the supervisor graph is built."""
    try:
        mas = get_mas()
        graph = mas.get_graph()
        if graph is None:
            return JSONResponse(
                status_code=503,
                content={"status": "not_ready", "reason": "graph not yet built"},
            )
        return JSONResponse(status_code=200, content={"status": "ready"})
    except Exception as exc:
        logger.warning("Readiness check failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "reason": str(exc)},
        )


@app.get("/status")
async def status() -> dict:
    """Supervisor and skills status (for operators / debugging)."""
    mas = get_mas()
    return {
        "supervisor": mas.get_status(),
        "skills": mas.get_skills_status(),
    }

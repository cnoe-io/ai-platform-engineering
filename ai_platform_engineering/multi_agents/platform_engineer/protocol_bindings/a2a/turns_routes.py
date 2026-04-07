# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
FastAPI routes for server-side turn and event rehydration.

Mounts alongside the A2A Starlette app so that UI and Slack-bot
interfaces can re-fetch persisted turns without hitting MongoDB directly.

Routes
------
GET /api/v1/conversations/{conversation_id}/turns
    All turns for a conversation, ordered by sequence.

GET /api/v1/conversations/{conversation_id}/turns/{turn_id}
    A single turn document.

GET /api/v1/conversations/{conversation_id}/turns/{turn_id}/events
    All stream_events for a specific turn.

GET /api/v1/conversations/{conversation_id}/events
    All stream_events for a conversation (full timeline rebuild).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from ai_platform_engineering.utils.persistence.turn_persistence import TurnPersistence

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/conversations", tags=["turns"])

# Singleton persistence instance (shared with agent executor via module-level init)
_persistence = TurnPersistence()


def _serialise(doc: dict) -> dict:
    """Convert MongoDB ObjectId / datetime fields to JSON-serialisable types."""
    import copy
    from datetime import datetime

    result = copy.deepcopy(doc)
    for key, value in result.items():
        if isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, dict):
            result[key] = _serialise(value)
        elif isinstance(value, list):
            result[key] = [
                _serialise(item) if isinstance(item, dict) else item
                for item in value
            ]
    return result


@router.get("/{conversation_id}/turns", response_model=list[dict[str, Any]])
async def get_turns(conversation_id: str) -> list[dict[str, Any]]:
    """Return all turns for a conversation ordered by sequence.

    Parameters
    ----------
    conversation_id:
        The conversation thread ID (A2A context_id).

    Returns
    -------
    list[dict]
        List of turn documents.  Empty list when none exist.
    """
    turns = _persistence.get_turns(conversation_id)
    return [_serialise(t) for t in turns]


@router.get("/{conversation_id}/turns/{turn_id}", response_model=dict[str, Any])
async def get_turn(conversation_id: str, turn_id: str) -> dict[str, Any]:
    """Return a single turn document.

    Parameters
    ----------
    conversation_id:
        The conversation thread ID.
    turn_id:
        The specific turn ID (UUID).

    Returns
    -------
    dict
        The turn document.

    Raises
    ------
    HTTPException(404):
        When the turn is not found.
    """
    turns = _persistence.get_turns(conversation_id)
    for turn in turns:
        if turn.get("_id") == turn_id:
            return _serialise(turn)
    raise HTTPException(status_code=404, detail=f"Turn {turn_id!r} not found in conversation {conversation_id!r}")


@router.get("/{conversation_id}/turns/{turn_id}/events", response_model=list[dict[str, Any]])
async def get_turn_events(conversation_id: str, turn_id: str) -> list[dict[str, Any]]:
    """Return all stream_events for a specific turn ordered by sequence.

    Parameters
    ----------
    conversation_id:
        The conversation thread ID (used for routing context only).
    turn_id:
        The specific turn whose events to retrieve.

    Returns
    -------
    list[dict]
        List of stream_event documents.
    """
    events = _persistence.get_turn_events(turn_id)
    return [_serialise(e) for e in events]


@router.get("/{conversation_id}/events", response_model=list[dict[str, Any]])
async def get_conversation_events(conversation_id: str) -> list[dict[str, Any]]:
    """Return all stream_events for a conversation for full timeline rebuild.

    Parameters
    ----------
    conversation_id:
        The conversation thread ID.

    Returns
    -------
    list[dict]
        All stream_event documents ordered by sequence.
    """
    events = _persistence.get_conversation_events(conversation_id)
    return [_serialise(e) for e in events]

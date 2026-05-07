# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Read-only Mongo accessor for the shared ``webex_thread_map`` collection.

The autonomous-agents service writes this collection on every task
run that posts a Webex message (see
``services/mongo.py::record_webex_thread``). The inbound bridge only
needs lookup-by-id, so we keep the surface area minimal: one method
that returns the raw doc or ``None``.

Schema (pinned ``_id``):
    {
      "_id":        "<webex-message-id>",   # parent message
      "message_id": "<webex-message-id>",   # mirrors _id
      "task_id":    "<task-uuid>",
      "run_id":     "<run-uuid>",
      "room_id":    "<webex-room-id>",      # optional
      "created_at": ISODate("..."),         # TTL'd by autonomous-agents
    }
"""

from __future__ import annotations

from typing import Any, Mapping


class WebexThreadStore:
    """Async Mongo lookup for a Webex parent-message id."""

    def __init__(self, collection: Any) -> None:
        # Loose typing on ``collection`` lets us accept either a
        # ``motor.motor_asyncio.AsyncIOMotorCollection`` (production)
        # or an in-memory fake (tests). The contract is just
        # ``find_one(filter) -> awaitable[dict | None]``.
        self._collection = collection

    async def lookup(self, message_id: str) -> Mapping[str, Any] | None:
        """Return the thread-map row for ``message_id`` or ``None``.

        Lookup hits Mongo's automatic ``_id_`` index, so this is O(log n)
        even on large maps. We trust the writer (autonomous-agents) to
        store both the ``_id`` and ``message_id`` fields; for safety
        we query ``_id`` -- the field most reliably indexed.
        """
        if not message_id:
            return None
        return await self._collection.find_one({"_id": message_id})

# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Thread-safe registry of active A2A streaming requests.

Used to support cancellation: the Slack action handler for "Stop generating"
looks up the active stream by thread_ts and signals it to stop.
"""

import threading
from dataclasses import dataclass, field
from typing import Optional

from loguru import logger


@dataclass
class ActiveStream:
    """Tracks one in-flight streaming request."""

    thread_ts: str
    task_id: Optional[str] = None
    a2a_client: object = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    stop_button_ts: Optional[str] = None

    @property
    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set()


_lock = threading.Lock()
_streams: dict[str, ActiveStream] = {}


def register(thread_ts: str, a2a_client=None) -> ActiveStream:
    """Register a new active stream. Returns the ActiveStream handle."""
    stream = ActiveStream(thread_ts=thread_ts, a2a_client=a2a_client)
    with _lock:
        old = _streams.get(thread_ts)
        if old:
            logger.warning(f"[active_streams] Replacing existing stream for {thread_ts}")
        _streams[thread_ts] = stream
    logger.debug(f"[active_streams] Registered stream for {thread_ts}")
    return stream


def get(thread_ts: str) -> Optional[ActiveStream]:
    """Look up an active stream by thread_ts (returns None if not found)."""
    with _lock:
        return _streams.get(thread_ts)


def cancel(thread_ts: str) -> bool:
    """Signal cancellation for a stream.

    Sets the cancel event, calls cancel_task() on the A2A client if a task_id
    is known, and closes the underlying HTTP response to unblock the iterator.

    Returns True if a stream was found and cancelled, False otherwise.
    """
    with _lock:
        stream = _streams.get(thread_ts)

    if not stream:
        logger.debug(f"[active_streams] No active stream for {thread_ts} (already finished?)")
        return False

    logger.info(f"[active_streams] Cancelling stream for {thread_ts} (task_id={stream.task_id})")
    stream.cancel_event.set()

    if stream.task_id and stream.a2a_client:
        try:
            stream.a2a_client.cancel_task(stream.task_id)
            logger.info(f"[active_streams] Sent tasks/cancel for {stream.task_id}")
        except Exception as e:
            logger.warning(f"[active_streams] cancel_task failed: {e}")

    if stream.a2a_client:
        try:
            stream.a2a_client.close_stream()
            logger.info(f"[active_streams] Closed SSE response for {thread_ts}")
        except Exception as e:
            logger.warning(f"[active_streams] close_stream failed: {e}")

    return True


def unregister(thread_ts: str) -> Optional[ActiveStream]:
    """Remove a stream from the registry. Returns the removed entry or None."""
    with _lock:
        stream = _streams.pop(thread_ts, None)
    if stream:
        logger.debug(f"[active_streams] Unregistered stream for {thread_ts}")
    return stream

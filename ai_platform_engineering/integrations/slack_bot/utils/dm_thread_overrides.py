"""In-process per-thread DM agent overrides.

Phase 2.4 of spec 2026-05-24-derive-team-from-channel. Stores
``thread_key → agent_id`` for the lifetime of the bot process. Cleared
on bot restart by design (FR-026: no persistence).

Key invariants:

* Bounded by entry count (LRU on size only); default 1000 entries.
* No time-based expiry. The user clears explicitly via ``/use default``
  or by sending a new thread (which is just a different key).
* Thread-safe is *not* required — Bolt dispatches handlers per task on
  a single asyncio loop, and Webex bot runs single-process. If we ever
  go multi-process this store moves to Redis behind the same API.
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class OverrideKey:
    """A thread-scoped override identifier.

    All four components are required. They are normalized to strings
    (``str()`` cast) but otherwise opaque to the store — the store
    treats them as a tuple for hashing.
    """

    workspace_id: str
    channel_id: str
    user_id: str
    thread_ts: str

    def __post_init__(self) -> None:
        for name, value in (
            ("workspace_id", self.workspace_id),
            ("channel_id", self.channel_id),
            ("user_id", self.user_id),
            ("thread_ts", self.thread_ts),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"OverrideKey.{name} must be a non-empty string; got {value!r}"
                )

    def as_tuple(self) -> tuple[str, str, str, str]:
        return (
            self.workspace_id,
            self.channel_id,
            self.user_id,
            self.thread_ts,
        )


class OverrideStore:
    """LRU-bounded in-process map ``OverrideKey -> agent_id``.

    Implementation note: ``OrderedDict.move_to_end`` gives us O(1) LRU
    promotion on read; ``popitem(last=False)`` evicts the oldest. We
    deliberately do NOT track timestamps so there's nothing to garbage-
    collect on a timer.
    """

    DEFAULT_MAX_SIZE = 1000

    def __init__(self, *, max_size: int = DEFAULT_MAX_SIZE) -> None:
        if not isinstance(max_size, int) or max_size <= 0:
            raise ValueError(
                f"OverrideStore.max_size must be a positive int; got {max_size!r}"
            )
        self.max_size = max_size
        self._items: "OrderedDict[tuple[str, str, str, str], str]" = OrderedDict()

    def set(self, key: OverrideKey, agent_id: str) -> None:
        """Insert or replace the override for ``key``.

        Evicts the LRU entry when the store is at capacity.
        """
        tkey = key.as_tuple()
        if tkey in self._items:
            self._items.move_to_end(tkey)
        self._items[tkey] = agent_id
        while len(self._items) > self.max_size:
            self._items.popitem(last=False)

    def get(self, key: OverrideKey) -> Optional[str]:
        """Return the override for ``key`` (and promote it to MRU)."""
        tkey = key.as_tuple()
        if tkey not in self._items:
            return None
        self._items.move_to_end(tkey)
        return self._items[tkey]

    def clear(self, key: OverrideKey) -> None:
        """Remove the override for ``key``. No-op if absent."""
        self._items.pop(key.as_tuple(), None)

    def _snapshot_for_test(self) -> list[dict[str, str]]:
        """Test-only inspection hatch — exposes raw entry shape so tests
        can assert there's no TTL field."""
        return [
            {
                "workspace_id": k[0],
                "channel_id": k[1],
                "user_id": k[2],
                "thread_ts": k[3],
                "agent_id": v,
            }
            for k, v in self._items.items()
        ]


_default_store: Optional[OverrideStore] = None


def get_default_override_store() -> OverrideStore:
    """Return the process-wide default ``OverrideStore``."""
    global _default_store
    if _default_store is None:
        _default_store = OverrideStore()
    return _default_store

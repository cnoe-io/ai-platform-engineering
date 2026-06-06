"""In-process per-room Webex DM agent overrides.

Phase 2.4 of spec 2026-05-24-derive-team-from-channel. Webex 1:1 rooms
don't have Slack-style threads, so the override key is
``(person_id, room_id)``. If the room is a group space the room_id is
still globally unique, so the same key shape works there too — the
``use``/``list`` text commands always run in a single space context.

See ``slack_bot.utils.dm_thread_overrides`` for the LRU-only-no-TTL
rationale (FR-026).
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class OverrideKey:
    person_id: str
    room_id: str

    def __post_init__(self) -> None:
        for name, value in (
            ("person_id", self.person_id),
            ("room_id", self.room_id),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ValueError(
                    f"OverrideKey.{name} must be a non-empty string; got {value!r}"
                )

    def as_tuple(self) -> tuple[str, str]:
        return (self.person_id, self.room_id)


class OverrideStore:
    DEFAULT_MAX_SIZE = 1000

    def __init__(self, *, max_size: int = DEFAULT_MAX_SIZE) -> None:
        if not isinstance(max_size, int) or max_size <= 0:
            raise ValueError(
                f"OverrideStore.max_size must be a positive int; got {max_size!r}"
            )
        self.max_size = max_size
        self._items: "OrderedDict[tuple[str, str], str]" = OrderedDict()

    def set(self, key: OverrideKey, agent_id: str) -> None:
        tkey = key.as_tuple()
        if tkey in self._items:
            self._items.move_to_end(tkey)
        self._items[tkey] = agent_id
        while len(self._items) > self.max_size:
            self._items.popitem(last=False)

    def get(self, key: OverrideKey) -> Optional[str]:
        tkey = key.as_tuple()
        if tkey not in self._items:
            return None
        self._items.move_to_end(tkey)
        return self._items[tkey]

    def clear(self, key: OverrideKey) -> None:
        self._items.pop(key.as_tuple(), None)

    def _snapshot_for_test(self) -> list[dict[str, str]]:
        return [
            {"person_id": k[0], "room_id": k[1], "agent_id": v}
            for k, v in self._items.items()
        ]


_default_store: Optional[OverrideStore] = None


def get_default_override_store() -> OverrideStore:
    global _default_store
    if _default_store is None:
        _default_store = OverrideStore()
    return _default_store

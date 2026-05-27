"""Per-user, time-windowed command rate limiter (Webex twin).

See ``slack_bot.utils.command_rate_limiter`` for design notes. The
shape is intentionally identical so logs and metrics line up across
the two surfaces, but the bots ship independently so we don't share
the module via import.
"""

from __future__ import annotations

from collections import OrderedDict, deque
from threading import Lock
from time import monotonic
from typing import Callable, Deque


class CommandRateLimiter:
    def __init__(
        self,
        *,
        max_per_window: int = 5,
        window_seconds: float = 30.0,
        max_tracked_users: int = 10_000,
        time_source: Callable[[], float] = monotonic,
    ) -> None:
        if max_per_window < 1:
            raise ValueError("max_per_window must be >= 1")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be > 0")
        if max_tracked_users < 1:
            raise ValueError("max_tracked_users must be >= 1")
        self._max = max_per_window
        self._window = window_seconds
        self._max_users = max_tracked_users
        self._now = time_source
        self._lock = Lock()
        self._buckets: OrderedDict[str, Deque[float]] = OrderedDict()

    def check_and_consume(self, user_key: str) -> bool:
        if not user_key:
            return True
        now = self._now()
        cutoff = now - self._window
        with self._lock:
            timestamps = self._buckets.get(user_key)
            if timestamps is None:
                timestamps = deque()
                self._buckets[user_key] = timestamps
            else:
                self._buckets.move_to_end(user_key)
            while timestamps and timestamps[0] < cutoff:
                timestamps.popleft()
            if len(timestamps) >= self._max:
                return False
            timestamps.append(now)
            self._evict_lru_if_needed()
            return True

    def reset(self, user_key: str) -> None:
        with self._lock:
            self._buckets.pop(user_key, None)

    def _evict_lru_if_needed(self) -> None:
        while len(self._buckets) > self._max_users:
            self._buckets.popitem(last=False)

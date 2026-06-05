"""Tests for the Webex twin of the per-user command rate limiter."""

from __future__ import annotations

import pytest

from ai_platform_engineering.integrations.webex_bot.utils.command_rate_limiter import (
    CommandRateLimiter,
)


class _Clock:
    def __init__(self) -> None:
        self._now = 1000.0

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


def test_under_limit_allows_consecutive_calls() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=3, window_seconds=10.0, time_source=clock
    )
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p1") is True


def test_over_limit_denies() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=2, window_seconds=10.0, time_source=clock
    )
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p1") is False


def test_window_slides() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=2, window_seconds=10.0, time_source=clock
    )
    assert limiter.check_and_consume("p1") is True
    clock.advance(5.0)
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p1") is False
    clock.advance(6.0)
    assert limiter.check_and_consume("p1") is True


def test_users_are_independent() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=1, window_seconds=10.0, time_source=clock
    )
    assert limiter.check_and_consume("alice") is True
    assert limiter.check_and_consume("bob") is True
    assert limiter.check_and_consume("alice") is False


def test_lru_eviction() -> None:
    clock = _Clock()
    limiter = CommandRateLimiter(
        max_per_window=1,
        window_seconds=10.0,
        max_tracked_users=2,
        time_source=clock,
    )
    assert limiter.check_and_consume("p1") is True
    assert limiter.check_and_consume("p2") is True
    assert limiter.check_and_consume("p3") is True
    assert limiter.check_and_consume("p1") is True


def test_invalid_args() -> None:
    with pytest.raises(ValueError):
        CommandRateLimiter(max_per_window=0)
    with pytest.raises(ValueError):
        CommandRateLimiter(window_seconds=0)
    with pytest.raises(ValueError):
        CommandRateLimiter(max_tracked_users=0)

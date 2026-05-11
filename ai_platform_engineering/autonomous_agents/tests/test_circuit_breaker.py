# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the supervisor ``CircuitBreaker``.

Pure state-machine tests drive the breaker directly with a fake
``clock`` (no sleeps). Wiring tests put the real breaker inside
``invoke_agent`` with a mocked supervisor and verify post-retry
failure counting, threshold-driven trips, cooldown recovery, and the
``CIRCUIT_BREAKER_ENABLED=false`` kill-switch.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from autonomous_agents.config import Settings, get_settings
from autonomous_agents.services import a2a_client
from autonomous_agents.services import circuit_breaker as cb_mod
from autonomous_agents.services.circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerOpenError,
    CircuitState,
)


class _FakeClock:
    """Monotonic-clock substitute. Tests advance time explicitly."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class TestStateMachine:
    """Direct exercise of CLOSED / OPEN / HALF_OPEN transitions."""

    async def test_starts_closed(self):
        """A fresh breaker starts CLOSED and ``before_call`` is a no-op."""
        breaker = CircuitBreaker(failure_threshold=2, cooldown_seconds=10)
        assert await breaker.state_for("u") is CircuitState.CLOSED
        await breaker.before_call("u")

    async def test_records_failures_below_threshold_stays_closed(self):
        """Failures below the threshold leave the breaker CLOSED."""
        breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=10)
        await breaker.record_failure("u")
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.CLOSED
        await breaker.before_call("u")

    async def test_trips_open_at_threshold(self):
        """Hitting the failure threshold transitions to OPEN."""
        breaker = CircuitBreaker(failure_threshold=2, cooldown_seconds=10)
        await breaker.record_failure("u")
        state = await breaker.record_failure("u")
        assert state is CircuitState.OPEN
        with pytest.raises(CircuitBreakerOpenError) as exc_info:
            await breaker.before_call("u")
        assert exc_info.value.url == "u"
        assert 0 < exc_info.value.retry_after_seconds <= 10

    async def test_success_resets_failure_counter(self):
        """A success zeroes the failure counter."""
        breaker = CircuitBreaker(failure_threshold=3, cooldown_seconds=10)
        await breaker.record_failure("u")
        await breaker.record_failure("u")
        await breaker.record_success("u")
        await breaker.record_failure("u")
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.CLOSED

    async def test_open_blocks_until_cooldown_then_half_opens(self):
        """OPEN blocks mid-cooldown; cooldown elapsing transitions to HALF_OPEN on the next call."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=30, clock=clock)
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.OPEN

        clock.advance(15)
        with pytest.raises(CircuitBreakerOpenError):
            await breaker.before_call("u")

        clock.advance(20)
        await breaker.before_call("u")
        assert await breaker.state_for("u") is CircuitState.HALF_OPEN

    async def test_half_open_failure_reopens_with_fresh_cooldown(self):
        """A failed trial in HALF_OPEN transitions back to OPEN with a fresh cooldown."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10, clock=clock)
        await breaker.record_failure("u")
        clock.advance(15)
        await breaker.before_call("u")

        state = await breaker.record_failure("u")
        assert state is CircuitState.OPEN
        with pytest.raises(CircuitBreakerOpenError):
            await breaker.before_call("u")

    async def test_half_open_success_closes_breaker(self):
        """A successful trial in HALF_OPEN closes the breaker and resets the failure counter."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=2, cooldown_seconds=10, clock=clock)
        await breaker.record_failure("u")
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.OPEN
        clock.advance(15)
        await breaker.before_call("u")
        await breaker.record_success("u")
        assert await breaker.state_for("u") is CircuitState.CLOSED
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.CLOSED

    async def test_half_open_blocks_concurrent_callers_until_trial_resolves(self):
        """HALF_OPEN admits exactly one trial caller; concurrent callers are blocked."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10, clock=clock)
        await breaker.record_failure("u")
        clock.advance(15)
        await breaker.before_call("u")
        assert await breaker.state_for("u") is CircuitState.HALF_OPEN
        with pytest.raises(CircuitBreakerOpenError) as exc_info:
            await breaker.before_call("u")
        assert exc_info.value.retry_after_seconds == 0.0
        await breaker.record_success("u")
        await breaker.before_call("u")

    async def test_release_trial_unblocks_half_open_without_changing_state(self):
        """``release_trial`` clears the trial flag without flipping state."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10, clock=clock)
        await breaker.record_failure("u")
        clock.advance(15)
        await breaker.before_call("u")
        with pytest.raises(CircuitBreakerOpenError):
            await breaker.before_call("u")
        await breaker.release_trial("u")
        assert await breaker.state_for("u") is CircuitState.HALF_OPEN
        await breaker.before_call("u")

    async def test_half_open_stale_trial_is_reclaimed(self):
        """A trial that never reports back is reclaimed after ``2 * cooldown_seconds``."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10, clock=clock)
        await breaker.record_failure("u")
        clock.advance(15)
        await breaker.before_call("u")
        clock.advance(25)
        await breaker.before_call("u")

    async def test_per_url_isolation(self):
        """Trips on one URL don't poison the breaker for another URL."""
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10)
        await breaker.record_failure("bad")
        assert await breaker.state_for("bad") is CircuitState.OPEN
        assert await breaker.state_for("good") is CircuitState.CLOSED
        await breaker.before_call("good")

    async def test_disabled_breaker_is_passthrough(self):
        """``enabled=False`` makes every method a no-op."""
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=10, enabled=False)
        for _ in range(20):
            await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.CLOSED
        await breaker.before_call("u")

    async def test_state_for_auto_transitions_open_to_half_open(self):
        """``state_for`` reflects HALF_OPEN once the cooldown has passed even without a call."""
        clock = _FakeClock()
        breaker = CircuitBreaker(failure_threshold=1, cooldown_seconds=5, clock=clock)
        await breaker.record_failure("u")
        assert await breaker.state_for("u") is CircuitState.OPEN
        clock.advance(6)
        assert await breaker.state_for("u") is CircuitState.HALF_OPEN

    def test_invalid_construction_rejected(self):
        """Zero / negative thresholds and cooldowns are rejected at construction."""
        with pytest.raises(ValueError):
            CircuitBreaker(failure_threshold=0, cooldown_seconds=10)
        with pytest.raises(ValueError):
            CircuitBreaker(failure_threshold=1, cooldown_seconds=0)


class TestSettingsValidation:
    """Settings field-level validation for breaker params."""

    def test_rejects_non_finite_cooldown(self):
        """``inf`` / ``nan`` cooldowns are rejected at Settings construction."""
        with pytest.raises(ValueError, match="finite"):
            Settings(circuit_breaker_cooldown_seconds=float("inf"))
        with pytest.raises(ValueError):
            Settings(circuit_breaker_cooldown_seconds=float("nan"))


def _make_response(json_body: dict[str, Any], status_code: int = 200) -> httpx.Response:
    request = httpx.Request("POST", "http://supervisor.local")
    return httpx.Response(status_code, json=json_body, request=request)


def _success_body(text: str = "ok") -> dict[str, Any]:
    return {"result": {"artifacts": [{"parts": [{"kind": "text", "text": text}]}]}}


def _http_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://supervisor.local")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(f"{status_code}", request=request, response=response)


@pytest.fixture
def _strict_breaker_settings():
    """Tight-threshold settings + matching breaker singleton patched into ``a2a_client``."""
    get_settings.cache_clear()
    cb_mod.reset_circuit_breaker()
    fast = Settings(
        a2a_retry_backoff_initial_seconds=0.0,
        a2a_retry_backoff_max_seconds=0.001,
        a2a_max_retries=1,
        a2a_timeout_seconds=10.0,
        circuit_breaker_enabled=True,
        circuit_breaker_failure_threshold=2,
        circuit_breaker_cooldown_seconds=30.0,
    )
    breaker = CircuitBreaker(
        failure_threshold=fast.circuit_breaker_failure_threshold,
        cooldown_seconds=fast.circuit_breaker_cooldown_seconds,
        enabled=fast.circuit_breaker_enabled,
    )

    async def _get_breaker():
        return breaker

    with patch.object(a2a_client, "get_settings", return_value=fast), patch.object(
        a2a_client, "get_circuit_breaker", new=_get_breaker
    ):
        fast._test_breaker = breaker  # type: ignore[attr-defined]
        yield fast
    get_settings.cache_clear()
    cb_mod.reset_circuit_breaker()


class TestInvokeAgentWiring:
    """``invoke_agent`` consults the breaker on each call and only counts post-retry failures."""

    async def test_success_on_retry_does_not_count_as_breaker_failure(
        self, _strict_breaker_settings,
    ):
        """A request that 5xx's once and then succeeds does not move the breaker toward OPEN."""
        breaker = _strict_breaker_settings._test_breaker
        mock_post = AsyncMock(
            side_effect=[_http_error(503), _make_response(_success_body("ok"))]
        )
        with patch.object(a2a_client, "_post_once", new=mock_post):
            result = await a2a_client.invoke_agent(prompt="hi", task_id="t1")

        assert result == "ok"
        assert (
            await breaker.state_for(_strict_breaker_settings.supervisor_url)
            is CircuitState.CLOSED
        )

    async def test_breaker_trips_after_consecutive_fully_failed_invocations(
        self, _strict_breaker_settings,
    ):
        """Two complete invoke_agent calls that exhaust their retry budget trip the breaker."""
        breaker = _strict_breaker_settings._test_breaker
        mock_post = AsyncMock(side_effect=_http_error(503))
        with patch.object(a2a_client, "_post_once", new=mock_post):
            with pytest.raises(httpx.HTTPStatusError):
                await a2a_client.invoke_agent(prompt="hi", task_id="t1")
            with pytest.raises(httpx.HTTPStatusError):
                await a2a_client.invoke_agent(prompt="hi", task_id="t1")

        assert mock_post.await_count == 4
        assert (
            await breaker.state_for(_strict_breaker_settings.supervisor_url)
            is CircuitState.OPEN
        )

        with patch.object(a2a_client, "_post_once", new=mock_post):
            with pytest.raises(CircuitBreakerOpenError):
                await a2a_client.invoke_agent(prompt="hi", task_id="t1")
        assert mock_post.await_count == 4

    async def test_breaker_recovers_after_cooldown_with_successful_trial(
        self, _strict_breaker_settings,
    ):
        """After cooldown, a successful trial transitions the breaker back to CLOSED."""
        breaker = _strict_breaker_settings._test_breaker

        fail_post = AsyncMock(side_effect=_http_error(503))
        with patch.object(a2a_client, "_post_once", new=fail_post):
            with pytest.raises(httpx.HTTPStatusError):
                await a2a_client.invoke_agent(prompt="hi", task_id="t1")
            with pytest.raises(httpx.HTTPStatusError):
                await a2a_client.invoke_agent(prompt="hi", task_id="t1")
        assert (
            await breaker.state_for(_strict_breaker_settings.supervisor_url)
            is CircuitState.OPEN
        )

        stats = await breaker._get_stats(_strict_breaker_settings.supervisor_url)
        assert stats.opened_at is not None
        stats.opened_at -= _strict_breaker_settings.circuit_breaker_cooldown_seconds + 1

        ok_post = AsyncMock(return_value=_make_response(_success_body("recovered")))
        with patch.object(a2a_client, "_post_once", new=ok_post):
            result = await a2a_client.invoke_agent(prompt="hi", task_id="t1")
        assert result == "recovered"
        assert (
            await breaker.state_for(_strict_breaker_settings.supervisor_url)
            is CircuitState.CLOSED
        )

    async def test_disabled_breaker_does_not_short_circuit(self):
        """``CIRCUIT_BREAKER_ENABLED=False`` lets every request reach the network."""
        get_settings.cache_clear()
        cb_mod.reset_circuit_breaker()
        settings = Settings(
            a2a_retry_backoff_initial_seconds=0.0,
            a2a_retry_backoff_max_seconds=0.001,
            a2a_max_retries=0,
            circuit_breaker_enabled=False,
            circuit_breaker_failure_threshold=1,
        )
        breaker = CircuitBreaker(
            failure_threshold=settings.circuit_breaker_failure_threshold,
            cooldown_seconds=settings.circuit_breaker_cooldown_seconds,
            enabled=settings.circuit_breaker_enabled,
        )

        async def _get_breaker():
            return breaker

        with patch.object(a2a_client, "get_settings", return_value=settings), patch.object(
            a2a_client, "get_circuit_breaker", new=_get_breaker
        ):
            mock_post = AsyncMock(side_effect=_http_error(503))
            with patch.object(a2a_client, "_post_once", new=mock_post):
                for _ in range(5):
                    with pytest.raises(httpx.HTTPStatusError):
                        await a2a_client.invoke_agent(prompt="hi", task_id="t1")
                assert mock_post.await_count == 5
        cb_mod.reset_circuit_breaker()
        get_settings.cache_clear()

    async def test_4xx_does_not_trip_breaker(self, _strict_breaker_settings):
        """4xx is caller-fault and never moves the breaker toward OPEN."""
        breaker = _strict_breaker_settings._test_breaker
        mock_post = AsyncMock(side_effect=_http_error(400))
        with patch.object(a2a_client, "_post_once", new=mock_post):
            for _ in range(5):
                with pytest.raises(httpx.HTTPStatusError):
                    await a2a_client.invoke_agent(prompt="hi", task_id="t1")

        assert mock_post.await_count == 5
        assert (
            await breaker.state_for(_strict_breaker_settings.supervisor_url)
            is CircuitState.CLOSED
        )

# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the supervisor ``CircuitBreaker``.

Pure state-machine tests drive the breaker directly with a fake
``clock`` (no sleeps), and cover the ``CIRCUIT_BREAKER_ENABLED=false``
kill-switch at the breaker-class level
(``test_disabled_breaker_is_passthrough``). Wiring tests put the real
breaker inside ``invoke_agent_streaming`` with a fake SSE-mocked
supervisor and verify threshold-driven trips, cooldown recovery, and
the ``release_trial`` paths for caller-fault (4xx) and in-band JSON-RPC
errors.
"""

import json
from unittest.mock import patch

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
        with pytest.raises(ValueError):
            CircuitBreaker(failure_threshold=1, cooldown_seconds=10, stale_trial_seconds=0)
        with pytest.raises(ValueError):
            CircuitBreaker(failure_threshold=1, cooldown_seconds=10, stale_trial_seconds=-1)

    async def test_stale_trial_default_falls_back_to_2x_cooldown(self):
        """When ``stale_trial_seconds`` is omitted the leak guard fires at 2x cooldown.

        Pre-PR behaviour: hardcoded ``2 * cooldown``. The new opt-in
        parameter must default to the same value so existing callers
        (and existing tests) see no behaviour change.
        """
        clock = _FakeClock()
        breaker = CircuitBreaker(
            failure_threshold=1, cooldown_seconds=10, clock=clock,
        )
        # Trip + cooldown so we land in HALF_OPEN with a trial in flight.
        await breaker.record_failure("u")
        clock.advance(11)
        await breaker.before_call("u")  # wins the HALF_OPEN trial slot
        assert await breaker.state_for("u") is CircuitState.HALF_OPEN

        # Just before the legacy 2x-cooldown bound: another caller is
        # blocked because the trial is still considered live.
        clock.advance(15)
        with pytest.raises(CircuitBreakerOpenError):
            await breaker.before_call("u")

        # Past the bound: leak guard reclaims the slot for the new caller.
        clock.advance(10)
        await breaker.before_call("u")  # no raise -- new caller takes the trial

    async def test_stale_trial_seconds_override_honoured(self):
        """An explicit ``stale_trial_seconds`` overrides the 2x-cooldown default.

        This is the production path: ``get_circuit_breaker`` derives a
        much larger value (covering the streaming timeout) so a healthy-
        but-slow trial isn't reclaimed mid-flight.
        """
        clock = _FakeClock()
        # cooldown=10 -> default leak guard would be 20s. Override to 120s
        # to simulate the streaming-timeout-aware production wiring.
        breaker = CircuitBreaker(
            failure_threshold=1,
            cooldown_seconds=10,
            stale_trial_seconds=120,
            clock=clock,
        )
        await breaker.record_failure("u")
        clock.advance(11)
        await breaker.before_call("u")  # win the trial

        # 90s in flight -- well past the legacy 20s bound but inside our
        # 120s override. New callers must still be blocked.
        clock.advance(90)
        with pytest.raises(CircuitBreakerOpenError):
            await breaker.before_call("u")

        # Past the override: now the leak guard fires.
        clock.advance(40)
        await breaker.before_call("u")  # no raise


class TestSettingsValidation:
    """Settings field-level validation for breaker params."""

    def test_rejects_non_finite_cooldown(self):
        """``inf`` / ``nan`` cooldowns are rejected at Settings construction."""
        with pytest.raises(ValueError, match="finite"):
            Settings(circuit_breaker_cooldown_seconds=float("inf"))
        with pytest.raises(ValueError):
            Settings(circuit_breaker_cooldown_seconds=float("nan"))

    def test_rejects_non_finite_stale_trial(self):
        """``inf`` / ``nan`` stale-trial bounds are rejected; ``None`` accepted."""
        with pytest.raises(ValueError, match="finite"):
            Settings(circuit_breaker_stale_trial_seconds=float("inf"))
        with pytest.raises(ValueError):
            Settings(circuit_breaker_stale_trial_seconds=float("nan"))
        # ``None`` is the default and signals "auto-derive in factory".
        s = Settings(circuit_breaker_stale_trial_seconds=None)
        assert s.circuit_breaker_stale_trial_seconds is None

    async def test_factory_derives_stale_trial_from_a2a_timeout(self):
        """When unset, the factory picks ``max(2*cooldown, a2a_timeout*1.5)``.

        With Settings defaults (cooldown=30, a2a_timeout=300) the
        derived value is ``max(60, 450) = 450``.
        """
        get_settings.cache_clear()
        cb_mod.reset_circuit_breaker()
        try:
            breaker = await cb_mod.get_circuit_breaker()
            # Internal attribute -- acceptable for a tightly-coupled test.
            assert breaker._stale_trial == pytest.approx(450.0)
        finally:
            get_settings.cache_clear()
            cb_mod.reset_circuit_breaker()


# ---------------------------------------------------------------------------
# Streaming wiring tests (PR: gate streaming A2A call through circuit breaker)
# ---------------------------------------------------------------------------
#
# ``invoke_agent_streaming`` is the production code path -- everything the
# scheduler and webhook router fire goes through it. These tests assert the
# breaker is consulted on every call with the same supervisor-sick vs
# caller-fault classification the (legacy) blocking path uses, and that
# in-band JSON-RPC errors over a successful HTTP stream don't trip it.
#
# SSE fixture rationale: the blocking tests patch ``_post_once`` (a clean
# seam). Streaming has no equivalent -- ``invoke_agent_streaming`` constructs
# its own ``httpx.AsyncClient`` and calls ``client.stream(...)``. So we
# patch ``httpx.AsyncClient`` itself with a small fake that returns a
# context manager wrapping ``aiter_lines``. ``raise_for_status`` is honoured
# so HTTP 4xx/5xx classification works exactly as in production.


class _FakeStreamResponse:
    def __init__(self, status_code: int, sse_lines: list[str]) -> None:
        self.status_code = status_code
        self._lines = sse_lines

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://supervisor.local")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                f"{self.status_code}", request=request, response=response,
            )

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class _FakeStreamCM:
    def __init__(self, response: _FakeStreamResponse) -> None:
        self._response = response

    async def __aenter__(self) -> _FakeStreamResponse:
        return self._response

    async def __aexit__(self, *exc) -> None:
        return None


class _FakeAsyncClientCM:
    """Drop-in for ``httpx.AsyncClient`` that returns canned SSE responses.

    Built by ``_make_fake_client_factory`` from a list of either:
      * ``_FakeStreamResponse`` -- replayed in order, one per ``stream()`` call;
      * a callable raising on ``stream()`` (e.g. ``httpx.ConnectError``).
    """

    def __init__(self, responses, transport_error=None) -> None:
        self._responses = list(responses)
        self._transport_error = transport_error
        self.stream_calls = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> None:
        return None

    def stream(self, *args, **kwargs) -> _FakeStreamCM:
        self.stream_calls += 1
        if self._transport_error is not None:
            raise self._transport_error
        if not self._responses:
            raise AssertionError("ran out of fake stream responses")
        return _FakeStreamCM(self._responses.pop(0))


def _make_fake_client_factory(*, responses=(), transport_error=None):
    """Return a callable usable as a drop-in for ``httpx.AsyncClient``.

    Captures the resulting client on ``.last`` so tests can assert on
    ``.stream_calls``.
    """
    holder: dict[str, _FakeAsyncClientCM] = {}

    def _factory(*args, **kwargs):
        client = _FakeAsyncClientCM(
            responses=list(responses), transport_error=transport_error,
        )
        holder["last"] = client
        return client

    _factory.holder = holder  # type: ignore[attr-defined]
    return _factory


def _sse_final_result(text: str) -> list[str]:
    """SSE lines for a stream that yields a single ``final_result`` artifact."""
    envelope = {
        "jsonrpc": "2.0",
        "result": {
            "kind": "artifact-update",
            "artifact": {
                "name": "final_result",
                "parts": [{"kind": "text", "text": text}],
            },
        },
    }
    return [f"data: {json.dumps(envelope)}", ""]


def _sse_jsonrpc_error(message: str) -> list[str]:
    """SSE lines for a stream that delivers an in-band JSON-RPC error."""
    envelope = {"jsonrpc": "2.0", "error": {"code": -32000, "message": message}}
    return [f"data: {json.dumps(envelope)}", ""]


@pytest.fixture
def _streaming_breaker_settings():
    """Tight-threshold settings + matching breaker singleton patched into ``a2a_client``.

    The streaming path has no retry layer, so each transient failure
    counts directly against the breaker -- ``failure_threshold=2`` keeps
    tests short.
    """
    get_settings.cache_clear()
    cb_mod.reset_circuit_breaker()
    fast = Settings(
        a2a_timeout_seconds=10.0,
        circuit_breaker_enabled=True,
        circuit_breaker_failure_threshold=2,
        circuit_breaker_cooldown_seconds=30.0,
        # Big stale-trial bound -- mirrors the production auto-derivation
        # (max(2*cooldown, a2a_timeout*1.5)). For these tests we just need
        # it well above any single test's wall-clock duration.
        circuit_breaker_stale_trial_seconds=600.0,
    )
    breaker = CircuitBreaker(
        failure_threshold=fast.circuit_breaker_failure_threshold,
        cooldown_seconds=fast.circuit_breaker_cooldown_seconds,
        stale_trial_seconds=fast.circuit_breaker_stale_trial_seconds,
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


class TestInvokeAgentStreamingWiring:
    """``invoke_agent_streaming`` consults the breaker on every call.

    Exercises the production code path end-to-end (no breaker bypass,
    no retry layer): each test mocks the SSE supervisor response and
    asserts the breaker state transition matches the failure
    classification documented on ``invoke_agent_streaming``.
    """

    async def test_successful_stream_resets_failure_counter(
        self, _streaming_breaker_settings,
    ):
        """A clean stream completion calls record_success and closes the breaker."""
        breaker = _streaming_breaker_settings._test_breaker
        # Pre-load one failure so we can assert it gets reset.
        await breaker.record_failure(_streaming_breaker_settings.supervisor_url)

        factory = _make_fake_client_factory(
            responses=[_FakeStreamResponse(200, _sse_final_result("ok"))],
        )
        with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
            text, events = await a2a_client.invoke_agent_streaming(
                prompt="hi", task_id="t1",
            )

        assert text == "ok"
        assert len(events) == 1
        assert (
            await breaker.state_for(_streaming_breaker_settings.supervisor_url)
            is CircuitState.CLOSED
        )

    async def test_5xx_counts_toward_threshold_and_trips(
        self, _streaming_breaker_settings,
    ):
        """``failure_threshold`` consecutive 5xx responses trip the breaker."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        # Threshold=2, so two 5xx responses should land us in OPEN.
        for _ in range(2):
            factory = _make_fake_client_factory(
                responses=[_FakeStreamResponse(503, [])],
            )
            with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
                with pytest.raises(RuntimeError, match="HTTP 503"):
                    await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        assert await breaker.state_for(url) is CircuitState.OPEN

        # Subsequent call short-circuits without opening a connection.
        factory = _make_fake_client_factory(
            responses=[_FakeStreamResponse(200, _sse_final_result("would-be-ok"))],
        )
        with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
            with pytest.raises(CircuitBreakerOpenError):
                await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")
        # Confirm the OPEN breaker prevented any client construction.
        assert "last" not in factory.holder or factory.holder["last"].stream_calls == 0

    async def test_4xx_does_not_trip_breaker(self, _streaming_breaker_settings):
        """4xx is caller-fault -- release_trial path, never trips."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        # Many 4xx in a row -- threshold is 2 but the breaker should stay
        # CLOSED because 4xx releases the trial slot rather than counting.
        for _ in range(5):
            factory = _make_fake_client_factory(
                responses=[_FakeStreamResponse(400, [])],
            )
            with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
                with pytest.raises(RuntimeError, match="HTTP 400"):
                    await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        assert await breaker.state_for(url) is CircuitState.CLOSED

    async def test_transport_error_counts_toward_threshold(
        self, _streaming_breaker_settings,
    ):
        """``httpx.TransportError`` (e.g. connection refused) counts as a failure."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        for _ in range(2):
            factory = _make_fake_client_factory(
                transport_error=httpx.ConnectError("refused"),
            )
            with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
                with pytest.raises(RuntimeError, match="unreachable"):
                    await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        assert await breaker.state_for(url) is CircuitState.OPEN

    async def test_open_breaker_short_circuits_without_network(
        self, _streaming_breaker_settings,
    ):
        """Once OPEN, ``before_call`` raises before any httpx call is made."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        # Force OPEN directly so we don't burn the threshold setting up.
        await breaker.record_failure(url)
        await breaker.record_failure(url)
        assert await breaker.state_for(url) is CircuitState.OPEN

        factory = _make_fake_client_factory(
            responses=[_FakeStreamResponse(200, _sse_final_result("never-called"))],
        )
        with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
            with pytest.raises(CircuitBreakerOpenError):
                await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        # No client was ever constructed because before_call raised first.
        assert "last" not in factory.holder

    async def test_half_open_trial_success_closes_breaker(
        self, _streaming_breaker_settings,
    ):
        """After cooldown elapses, a successful stream trial closes the breaker."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        # Trip and rewind opened_at so cooldown has 'elapsed'.
        await breaker.record_failure(url)
        await breaker.record_failure(url)
        stats = await breaker._get_stats(url)
        assert stats.opened_at is not None
        stats.opened_at -= _streaming_breaker_settings.circuit_breaker_cooldown_seconds + 1

        factory = _make_fake_client_factory(
            responses=[_FakeStreamResponse(200, _sse_final_result("recovered"))],
        )
        with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
            text, _ = await a2a_client.invoke_agent_streaming(
                prompt="hi", task_id="t1",
            )
        assert text == "recovered"
        assert await breaker.state_for(url) is CircuitState.CLOSED

    async def test_half_open_trial_failure_reopens_breaker(
        self, _streaming_breaker_settings,
    ):
        """A failed HALF_OPEN trial re-OPENs immediately (without re-counting threshold)."""
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        await breaker.record_failure(url)
        await breaker.record_failure(url)
        stats = await breaker._get_stats(url)
        assert stats.opened_at is not None
        stats.opened_at -= _streaming_breaker_settings.circuit_breaker_cooldown_seconds + 1

        factory = _make_fake_client_factory(
            responses=[_FakeStreamResponse(503, [])],
        )
        with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
            with pytest.raises(RuntimeError, match="HTTP 503"):
                await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        # HALF_OPEN trial failed -> straight back to OPEN with fresh cooldown.
        assert await breaker.state_for(url) is CircuitState.OPEN

    async def test_inband_jsonrpc_error_releases_trial_does_not_trip(
        self, _streaming_breaker_settings,
    ):
        """In-band JSON-RPC errors over a successful HTTP stream don't trip the breaker.

        HTTP succeeded -> supervisor connectivity is healthy. The error
        is application-level, so we ``release_trial`` (so a phantom
        HALF_OPEN trial doesn't wedge) but don't ``record_failure``.
        """
        breaker = _streaming_breaker_settings._test_breaker
        url = _streaming_breaker_settings.supervisor_url

        # Many JSON-RPC errors in a row -- with threshold=2 the breaker
        # would trip after 2 if we mis-classified these as supervisor-sick.
        for _ in range(5):
            factory = _make_fake_client_factory(
                responses=[_FakeStreamResponse(200, _sse_jsonrpc_error("bad task"))],
            )
            with patch.object(a2a_client.httpx, "AsyncClient", new=factory):
                with pytest.raises(RuntimeError, match="A2A error from supervisor stream"):
                    await a2a_client.invoke_agent_streaming(prompt="hi", task_id="t1")

        assert await breaker.state_for(url) is CircuitState.CLOSED

"""Per-supervisor-URL circuit breaker for the A2A client.

Why
---
The supervisor is just another HTTP service: it can be restarted, fall
over behind a load balancer, or briefly hit OOM. The streaming A2A
caller (``invoke_agent_streaming``) has no retry layer, but the
autonomous-agents subsystem fans out N scheduled tasks per cycle into
the same supervisor URL -- so when that supervisor is broken, every
scheduled fire piles on the same broken target, multiplying load and
turning a localised outage into a self-DoS.

A circuit breaker fixes this by tracking *consecutive* failures across
calls and short-circuiting once a threshold is reached:

    CLOSED ──N consecutive failures──► OPEN
       ▲                                 │
       │                                 │ cooldown elapses
       │                                 ▼
       └────success on trial──────── HALF_OPEN ──failure──► OPEN

In the OPEN state, callers get an immediate ``CircuitBreakerOpenError``
without touching the network. After ``cooldown_seconds`` we move to
HALF_OPEN and let *one* trial request through; success closes the
circuit, failure re-opens it for another cooldown.

Design notes
------------
* **Per-URL keying.** A single autonomous-agents process can talk to
  multiple supervisor URLs (rare today but supported by config + tests),
  and one bad URL must not poison the others.
* **Each pre-stream blip counts.** ``invoke_agent_streaming`` has no
  retry layer (SSE can't be safely resumed mid-flight), so a single
  transient pre-stream error consumes one breaker failure directly.
  With the default ``failure_threshold=5`` the breaker absorbs
  occasional flakes; sustained failures trip it after 5 in a row.
* **Thread-safe via ``asyncio.Lock``.** All mutating operations take
  the lock so concurrent tasks can't race the state machine.
* **Single-flight HALF_OPEN.** Once one caller flips OPEN -> HALF_OPEN,
  every other concurrent caller is blocked until that trial resolves
  (success closes, failure re-opens). Otherwise we'd fan a real
  outage's worth of traffic at the recovering supervisor the instant
  cooldown expires, which is exactly what the breaker is meant to
  prevent.
* **Kill-switch safety.** When ``enabled=False`` the breaker is a
  no-op pass-through; it never raises and never records state.
  The feature is enabled by default; operators set
  ``CIRCUIT_BREAKER_ENABLED=0`` only as an emergency bypass if it
  ever misbehaves in production.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from enum import Enum

# ``config`` doesn't import from ``services``, so this is a one-way edge
# and can safely live at module scope. We bind ``get_settings`` here
# (rather than only inside the singleton factory) so tests can patch
# ``cb_mod.get_settings`` to feed the breaker test-only thresholds. See
# the ``_fast_retries`` fixture in ``tests/test_a2a_client.py``.
from autonomous_agents.config import get_settings

logger = logging.getLogger("autonomous_agents")


class CircuitState(str, Enum):
    """Externalised state name -- kept stable so logs/metrics can pivot on it."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreakerOpenError(RuntimeError):
    """Raised when a call is short-circuited because the breaker is OPEN.

    Carries the URL and how many seconds remain in the cooldown so
    callers (and run-history rows) can show a useful message instead
    of a generic ``RuntimeError``.
    """

    def __init__(self, url: str, retry_after_seconds: float) -> None:
        self.url = url
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"Supervisor circuit breaker is OPEN for {url}; "
            f"retry after ~{retry_after_seconds:.1f}s"
        )


@dataclass
class _BreakerStats:
    """Per-URL state. Kept private -- callers go through the manager."""

    state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    opened_at: float | None = None
    # Set when a HALF_OPEN trial is in flight so we don't let a second
    # concurrent caller race the trial. Cleared by record_success /
    # record_failure / release_trial.
    trial_in_flight: bool = False
    # Wall-clock timestamp of when the trial started; used as a
    # leak-detector fallback so a caller that never reports back (e.g.
    # killed mid-call) doesn't wedge the breaker in HALF_OPEN forever.
    trial_started_at: float | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class CircuitBreaker:
    """Thread-safe (asyncio) circuit breaker keyed by supervisor URL.

    Parameters
    ----------
    failure_threshold:
        How many *consecutive* failed supervisor calls trip the
        breaker. A single failure followed by a success resets the
        counter to zero.
    cooldown_seconds:
        How long the breaker stays OPEN before allowing a HALF_OPEN
        trial. Should be long enough that the downstream has a real
        chance to recover (default 30s) but short enough that we don't
        wedge a healthy supervisor for an unnecessary outage window.
    stale_trial_seconds:
        Leak-guard threshold for HALF_OPEN trials. If a trial has been
        in flight for longer than this, ``before_call`` reclaims the
        trial slot for a new caller (the original is presumed dead).
        Defaults to ``2 * cooldown_seconds`` to preserve historical
        behaviour, but production deployments wired through
        :func:`get_circuit_breaker` auto-tune this to cover long
        streaming calls -- otherwise a healthy-but-slow stream during
        recovery would have its trial reclaimed mid-flight, defeating
        the single-flight invariant.
    enabled:
        Master kill-switch. ``False`` disables every method on this
        instance; ``before_call`` becomes a no-op and
        ``record_success`` / ``record_failure`` are ignored.
    clock:
        Indirection point for tests so they don't have to ``sleep``
        through the cooldown. Production code never overrides this.
    """

    def __init__(
        self,
        *,
        failure_threshold: int = 5,
        cooldown_seconds: float = 30.0,
        stale_trial_seconds: float | None = None,
        enabled: bool = True,
        clock=time.monotonic,
    ) -> None:
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be >= 1")
        if cooldown_seconds <= 0:
            raise ValueError("cooldown_seconds must be > 0")
        if stale_trial_seconds is not None and stale_trial_seconds <= 0:
            raise ValueError("stale_trial_seconds must be > 0")
        self._threshold = failure_threshold
        self._cooldown = cooldown_seconds
        # Default preserves historical behaviour (2x cooldown). Callers
        # that know their max call duration -- e.g. streaming with a
        # multi-minute timeout -- override this so the leak guard
        # doesn't fire on a still-healthy trial.
        self._stale_trial = (
            stale_trial_seconds
            if stale_trial_seconds is not None
            else cooldown_seconds * 2
        )
        self._enabled = enabled
        self._clock = clock
        self._stats: dict[str, _BreakerStats] = {}
        # Guards creation of per-URL stats only -- per-URL operations
        # use the per-URL lock for finer-grained concurrency.
        self._stats_lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return self._enabled

    async def _get_stats(self, url: str) -> _BreakerStats:
        # Fast path: already created. Avoids paying the global lock on
        # every call once the URL is in the dict.
        existing = self._stats.get(url)
        if existing is not None:
            return existing
        async with self._stats_lock:
            # Re-check inside the lock in case a concurrent caller beat us.
            existing = self._stats.get(url)
            if existing is None:
                existing = _BreakerStats()
                self._stats[url] = existing
        return existing

    async def before_call(self, url: str) -> None:
        """Gate a call. Raises ``CircuitBreakerOpenError`` if blocked.

        Side effects:
        * If we're OPEN and the cooldown has elapsed, transitions to
          HALF_OPEN, marks a trial as in-flight, and lets *this single
          caller* through. Concurrent callers see HALF_OPEN +
          trial-in-flight and are blocked until the trial resolves.
        * No state change on the CLOSED happy path -- this is the hot
          path and must stay cheap.
        """
        if not self._enabled:
            return

        stats = await self._get_stats(url)
        async with stats.lock:
            if stats.state is CircuitState.CLOSED:
                return
            if stats.state is CircuitState.OPEN:
                assert stats.opened_at is not None  # noqa: S101 -- invariant
                elapsed = self._clock() - stats.opened_at
                remaining = self._cooldown - elapsed
                if remaining > 0:
                    raise CircuitBreakerOpenError(url, retry_after_seconds=remaining)
                # Cooldown elapsed -- move to HALF_OPEN and let this
                # caller be the trial request. Subsequent callers must
                # be blocked while the trial is in flight, otherwise
                # the instant cooldown expires we'd fan an outage's
                # worth of concurrent traffic at a recovering
                # supervisor (P1 review feedback on PR #9).
                logger.info(
                    "Circuit breaker for %s: OPEN -> HALF_OPEN after %.1fs cooldown "
                    "(single trial in flight)",
                    url,
                    elapsed,
                )
                stats.state = CircuitState.HALF_OPEN
                stats.opened_at = None
                stats.trial_in_flight = True
                stats.trial_started_at = self._clock()
                return

            # state is HALF_OPEN
            if stats.trial_in_flight:
                # Leak guard: if the trial has been "in flight" for
                # absurdly long the original caller almost certainly
                # died without reporting back. Reclaim the trial
                # rather than wedging the breaker forever. The bound
                # is configurable via ``stale_trial_seconds``; default
                # is 2x cooldown which is fine for short blocking
                # calls but production wiring overrides it for the
                # streaming path (calls can run for minutes) so a
                # healthy-but-slow trial isn't reclaimed mid-flight.
                started = stats.trial_started_at
                if started is not None and self._clock() - started > self._stale_trial:
                    logger.warning(
                        "Circuit breaker for %s: stale HALF_OPEN trial "
                        "(>%0.1fs) -- reclaiming for new caller",
                        url,
                        self._stale_trial,
                    )
                    stats.trial_started_at = self._clock()
                    return
                # Block: there's a live trial; cooldown_remaining=0
                # because the *trial* is what gates us, not a cooldown.
                raise CircuitBreakerOpenError(url, retry_after_seconds=0.0)
            # HALF_OPEN with no trial in flight (e.g. previous trial
            # released without success/failure). Treat this caller as
            # the new trial.
            stats.trial_in_flight = True
            stats.trial_started_at = self._clock()

    async def record_success(self, url: str) -> None:
        """Reset the failure counter and close the breaker if it was tripped."""
        if not self._enabled:
            return
        stats = await self._get_stats(url)
        async with stats.lock:
            if stats.consecutive_failures > 0 or stats.state is not CircuitState.CLOSED:
                logger.info(
                    "Circuit breaker for %s: closing (was %s, %d consecutive failures)",
                    url,
                    stats.state.value,
                    stats.consecutive_failures,
                )
            stats.consecutive_failures = 0
            stats.state = CircuitState.CLOSED
            stats.opened_at = None
            stats.trial_in_flight = False
            stats.trial_started_at = None

    async def record_failure(self, url: str) -> CircuitState:
        """Note one *post-retry* failure. May trip the breaker.

        Returns the new state so callers can log it. We always return
        the state even when the breaker is disabled (CLOSED) so
        downstream code doesn't have to special-case the kill-switch.
        """
        if not self._enabled:
            return CircuitState.CLOSED

        stats = await self._get_stats(url)
        async with stats.lock:
            stats.consecutive_failures += 1
            # HALF_OPEN trial failed -> straight back to OPEN with a fresh
            # cooldown. We don't wait for the threshold here because the
            # whole point of HALF_OPEN is "one shot to prove recovery".
            if stats.state is CircuitState.HALF_OPEN:
                stats.state = CircuitState.OPEN
                stats.opened_at = self._clock()
                stats.trial_in_flight = False
                stats.trial_started_at = None
                logger.warning(
                    "Circuit breaker for %s: HALF_OPEN trial failed -> OPEN "
                    "(cooldown %.1fs)",
                    url,
                    self._cooldown,
                )
                return stats.state

            # CLOSED: trip only when we hit the consecutive-failure threshold.
            if (
                stats.state is CircuitState.CLOSED
                and stats.consecutive_failures >= self._threshold
            ):
                stats.state = CircuitState.OPEN
                stats.opened_at = self._clock()
                stats.trial_in_flight = False
                stats.trial_started_at = None
                logger.warning(
                    "Circuit breaker for %s: tripped after %d consecutive "
                    "failures -> OPEN (cooldown %.1fs)",
                    url,
                    stats.consecutive_failures,
                    self._cooldown,
                )
            return stats.state

    async def release_trial(self, url: str) -> None:
        """Clear the in-flight trial flag without changing breaker state.

        Used by callers (``invoke_agent_streaming``) on terminal exceptions
        that are *not* supervisor-sick signals (e.g. 4xx caller-fault, or
        an in-band JSON-RPC error over a successful HTTP stream). The
        trial happened, it didn't tell us anything about supervisor
        health, and we don't want to leave the breaker wedged in
        HALF_OPEN with a phantom trial blocking real callers.
        """
        if not self._enabled:
            return
        stats = await self._get_stats(url)
        async with stats.lock:
            stats.trial_in_flight = False
            stats.trial_started_at = None

    async def state_for(self, url: str) -> CircuitState:
        """Read-only snapshot of the current state. Useful for tests / metrics."""
        if not self._enabled:
            return CircuitState.CLOSED
        stats = await self._get_stats(url)
        async with stats.lock:
            # Auto-transition to HALF_OPEN on read so dashboards reflect
            # reality without waiting for the next call. We do NOT mark
            # a trial as in-flight here -- only an actual ``before_call``
            # acquires the trial slot.
            if stats.state is CircuitState.OPEN and stats.opened_at is not None:
                if self._clock() - stats.opened_at >= self._cooldown:
                    stats.state = CircuitState.HALF_OPEN
                    stats.opened_at = None
            return stats.state

    async def reset(self, url: str | None = None) -> None:
        """Test helper -- wipe state for one URL or all of them."""
        if url is None:
            async with self._stats_lock:
                self._stats.clear()
            return
        stats = await self._get_stats(url)
        async with stats.lock:
            stats.consecutive_failures = 0
            stats.state = CircuitState.CLOSED
            stats.opened_at = None
            stats.trial_in_flight = False
            stats.trial_started_at = None


_breaker_singleton: CircuitBreaker | None = None
_singleton_lock = asyncio.Lock()


async def get_circuit_breaker() -> CircuitBreaker:
    """Lazy module-level singleton built from current ``Settings``.

    Built lazily (rather than at import time) so that ``Settings``
    overrides applied in tests via ``monkeypatch.setattr`` are picked
    up. Once built it is reused for the lifetime of the process; tests
    can call :func:`reset_circuit_breaker` to force a rebuild.

    ``stale_trial_seconds`` auto-derivation
    ---------------------------------------
    When the operator hasn't pinned ``CIRCUIT_BREAKER_STALE_TRIAL_SECONDS``,
    we pick ``max(2 * cooldown, a2a_timeout * 1.5)``. Both halves matter:

    * ``2 * cooldown`` preserves the legacy default for callers with
      short timeouts -- equivalent to the hardcoded behaviour pre-#PR.
    * ``a2a_timeout * 1.5`` covers the streaming path. Streaming calls
      can run for the full ``a2a_timeout_seconds`` (default 300s); a
      hardcoded 60s leak guard would otherwise reclaim a healthy-but-
      slow trial mid-flight, defeating the breaker's single-flight
      invariant during recovery from an outage.
    """
    global _breaker_singleton
    if _breaker_singleton is not None:
        return _breaker_singleton
    async with _singleton_lock:
        if _breaker_singleton is None:
            settings = get_settings()
            stale = settings.circuit_breaker_stale_trial_seconds
            if stale is None:
                stale = max(
                    2.0 * settings.circuit_breaker_cooldown_seconds,
                    settings.a2a_timeout_seconds * 1.5,
                )
            _breaker_singleton = CircuitBreaker(
                failure_threshold=settings.circuit_breaker_failure_threshold,
                cooldown_seconds=settings.circuit_breaker_cooldown_seconds,
                stale_trial_seconds=stale,
                enabled=settings.circuit_breaker_enabled,
            )
    return _breaker_singleton


def reset_circuit_breaker() -> None:
    """Drop the singleton so the next ``get_circuit_breaker`` rebuilds it.

    Synchronous on purpose so it can be used from pytest fixtures
    without ``asyncio.run``.
    """
    global _breaker_singleton
    _breaker_singleton = None

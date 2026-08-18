"""Single fail-closed authorization decision pipeline."""

from __future__ import annotations

import asyncio
import time

import httpx

from ai_platform_engineering.authz.audit.events import decision_event
from ai_platform_engineering.authz.audit.outbox import AuditOutbox, AuditOutboxFull
from ai_platform_engineering.authz.core.context import ContextError, provider_context
from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    CanonicalDecisionResult,
    Outcome,
)
from ai_platform_engineering.authz.core.reasons import ReasonCode
from ai_platform_engineering.authz.metrics import DECISION_DURATION, DECISIONS, OUTBOX_BACKLOG
from ai_platform_engineering.authz.providers.base import AuthorizationProvider
from ai_platform_engineering.authz.providers.openfga import OpenFgaError


class DecisionEngine:
    def __init__(
        self,
        provider: AuthorizationProvider,
        *,
        timeout_seconds: float = 2.0,
        max_concurrency: int = 128,
        outbox: AuditOutbox | None = None,
        strict_audit_allows: bool = True,
        subject_salt: str = "caipe-authz",
        rollout_revision: str = "legacy-default",
    ) -> None:
        self.provider = provider
        self.timeout_seconds = timeout_seconds
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self.outbox = outbox
        self.strict_audit_allows = strict_audit_allows
        self.subject_salt = subject_salt
        self.rollout_revision = rollout_revision

    def _result(
        self,
        request: CanonicalDecisionRequest,
        *,
        allowed: bool,
        reason: ReasonCode,
        started: float,
        model_id: str | None = None,
        diagnostics: dict[str, str | int | bool] | None = None,
    ) -> CanonicalDecisionResult:
        return CanonicalDecisionResult(
            decision_id=request.decision_id,
            allowed=allowed,
            outcome=Outcome.ALLOW if allowed else Outcome.DENY,
            reason_code=reason.value,
            authorization_model_id=model_id,
            duration_ms=(time.perf_counter() - started) * 1000,
            diagnostics=diagnostics or {},
        )

    async def decide(
        self,
        request: CanonicalDecisionRequest,
        *,
        authoritative_path: str = "AUTHZ",
        emit_event: bool = True,
    ) -> CanonicalDecisionResult:
        started = time.perf_counter()
        if self._semaphore.locked():
            result = self._result(
                request,
                allowed=False,
                reason=ReasonCode.DENY_SATURATED,
                started=started,
            )
        else:
            try:
                context = provider_context(request.context)
                async with self._semaphore:
                    provider_result = await asyncio.wait_for(
                        self.provider.check(request, context=context),
                        timeout=self.timeout_seconds,
                    )
                if provider_result.allowed is None:
                    result = self._result(
                        request,
                        allowed=False,
                        reason=ReasonCode.DENY_PROVIDER_INDETERMINATE,
                        started=started,
                        model_id=provider_result.authorization_model_id,
                    )
                else:
                    result = self._result(
                        request,
                        allowed=provider_result.allowed,
                        reason=(
                            ReasonCode.ALLOW_RELATIONSHIP
                            if provider_result.allowed
                            else ReasonCode.DENY_NO_RELATIONSHIP
                        ),
                        started=started,
                        model_id=provider_result.authorization_model_id,
                        diagnostics=provider_result.diagnostics,
                    )
            except (ContextError, ValueError):
                result = self._result(
                    request,
                    allowed=False,
                    reason=ReasonCode.DENY_INVALID_REQUEST,
                    started=started,
                )
            except TimeoutError:
                result = self._result(
                    request,
                    allowed=False,
                    reason=ReasonCode.DENY_PROVIDER_TIMEOUT,
                    started=started,
                )
            except (OpenFgaError, httpx.HTTPError, OSError):
                result = self._result(
                    request,
                    allowed=False,
                    reason=ReasonCode.DENY_PROVIDER_UNAVAILABLE,
                    started=started,
                )

        if not emit_event:
            return result
        return await self.journal(request, result, authoritative_path=authoritative_path)

    async def deny(
        self,
        request: CanonicalDecisionRequest,
        reason: ReasonCode,
        *,
        authoritative_path: str = "AUTHZ",
        emit_event: bool = True,
    ) -> CanonicalDecisionResult:
        """Create and journal a fail-closed decision before provider evaluation."""
        result = self._result(
            request,
            allowed=False,
            reason=reason,
            started=time.perf_counter(),
        )
        if not emit_event:
            return result
        return await self.journal(request, result, authoritative_path=authoritative_path)

    async def journal(
        self,
        request: CanonicalDecisionRequest,
        result: CanonicalDecisionResult,
        *,
        authoritative_path: str = "AUTHZ",
    ) -> CanonicalDecisionResult:
        """Persist the single authoritative outcome selected by a transport adapter."""
        if self.outbox is not None:
            event = decision_event(
                request,
                result,
                authoritative_path=authoritative_path,
                rollout_revision=self.rollout_revision,
                subject_salt=self.subject_salt,
            )
            try:
                await self.outbox.append(event)
            except AuditOutboxFull:
                if result.allowed and self.strict_audit_allows:
                    result = result.model_copy(
                        update={
                            "allowed": False,
                            "outcome": Outcome.DENY,
                            "reason_code": ReasonCode.DENY_AUDIT_UNAVAILABLE.value,
                        }
                    )
            OUTBOX_BACKLOG.set(await self.outbox.size())
        DECISIONS.labels(
            surface=request.surface.value,
            resource_type=request.resource.type,
            action=request.action,
            outcome=result.outcome.value,
            reason_code=result.reason_code,
            authoritative_path=authoritative_path,
        ).inc()
        DECISION_DURATION.labels(
            surface=request.surface.value,
            transport=request.transport.value,
            authoritative_path=authoritative_path,
        ).observe(result.duration_ms / 1000)
        return result

    async def decide_batch(
        self,
        requests: list[CanonicalDecisionRequest],
        *,
        authoritative_path: str = "AUTHZ",
    ) -> list[CanonicalDecisionResult]:
        return list(
            await asyncio.gather(
                *(self.decide(item, authoritative_path=authoritative_path) for item in requests)
            )
        )

from __future__ import annotations

from pathlib import Path

import pytest

from ai_platform_engineering.authz.audit.outbox import AuditOutbox
from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest
from ai_platform_engineering.authz.core.decision import DecisionEngine


def request() -> CanonicalDecisionRequest:
    return CanonicalDecisionRequest.model_validate(
        {
            "surface": "bff",
            "transport": "http",
            "subject": {"type": "user", "id": "example-user"},
            "action": "read",
            "resource": {"type": "agent", "id": "primary"},
        }
    )


@pytest.mark.asyncio
async def test_decision_pipeline_maps_provider_allow_and_journals(
    fake_provider,
    tmp_path: Path,
) -> None:
    outbox = AuditOutbox(str(tmp_path / "audit.db"))
    await outbox.initialize()
    engine = DecisionEngine(fake_provider, outbox=outbox)
    result = await engine.decide(request())
    assert result.allowed is True
    assert result.reason_code == "ALLOW_RELATIONSHIP"
    assert await outbox.size() == 1


@pytest.mark.asyncio
async def test_decision_pipeline_maps_indeterminate_to_deny(fake_provider) -> None:
    fake_provider.default_allowed = None
    result = await DecisionEngine(fake_provider).decide(request())
    assert result.allowed is False
    assert result.reason_code == "DENY_PROVIDER_INDETERMINATE"


@pytest.mark.asyncio
async def test_strict_audit_capacity_turns_allow_into_deny(
    fake_provider,
    tmp_path: Path,
) -> None:
    outbox = AuditOutbox(str(tmp_path / "audit.db"), capacity=0)
    await outbox.initialize()
    result = await DecisionEngine(fake_provider, outbox=outbox).decide(request())
    assert result.allowed is False
    assert result.reason_code == "DENY_AUDIT_UNAVAILABLE"


@pytest.mark.asyncio
async def test_provider_validation_error_fails_closed(fake_provider) -> None:
    async def invalid(*_args, **_kwargs):
        raise ValueError("unsupported action")

    fake_provider.check = invalid
    result = await DecisionEngine(fake_provider).decide(request())
    assert result.allowed is False
    assert result.reason_code == "DENY_INVALID_REQUEST"

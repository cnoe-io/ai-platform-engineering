from __future__ import annotations

import pytest
from pydantic import ValidationError

from ai_platform_engineering.authz.audit.events import AuthzAuditEvent, decision_event
from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    CanonicalDecisionResult,
    DecisionContext,
    RequestContext,
)


def test_decision_event_records_only_context_names_and_types() -> None:
    request = CanonicalDecisionRequest(
        surface="bff",
        transport="http",
        subject={"type": "user", "id": "example-user"},
        action="invoke",
        resource={"type": "tool", "id": "issue_tracker/create_item"},
        context=DecisionContext(
            request=RequestContext(arguments={"/project_key": "SENSITIVE-VALUE"})
        ),
    )
    result = CanonicalDecisionResult(
        decision_id=request.decision_id,
        allowed=True,
        outcome="ALLOW",
        reason_code="ALLOW_RELATIONSHIP",
        duration_ms=1,
    )

    event = decision_event(
        request,
        result,
        authoritative_path="AUTHZ",
        rollout_revision="revision-1",
        subject_salt="test-salt",
    )

    assert event.payload["context_field_names"] == ["/project_key"]
    assert event.payload["context_field_types"] == ["str"]
    assert "SENSITIVE-VALUE" not in event.model_dump_json()


def test_event_schema_rejects_raw_arguments() -> None:
    with pytest.raises(ValidationError, match="sensitive field"):
        AuthzAuditEvent(
            event_type="authz_decision",
            correlation_id="correlation-1",
            payload={"arguments": {"/project_key": "SENSITIVE-VALUE"}},
        )

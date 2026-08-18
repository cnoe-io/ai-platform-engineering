from __future__ import annotations

import json
import logging
from pathlib import Path

from ai_platform_engineering.authz.audit.events import decision_event
from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    CanonicalDecisionResult,
    DecisionContext,
    RequestContext,
)
from ai_platform_engineering.authz.inspection.graph import project_graph
from ai_platform_engineering.authz.policy.models import ExpressionPolicy, PolicyStatus
from ai_platform_engineering.authz.policy.templates import StringArgumentInV1
from ai_platform_engineering.authz.providers.base import ConditionalTuple


SENSITIVE_VALUE = "sensitive-value-that-must-never-escape"
SCHEMA_HASH = "sha256:" + "a" * 64


def policy() -> ExpressionPolicy:
    expression = StringArgumentInV1(field="/project_key", values=(SENSITIVE_VALUE,))
    return ExpressionPolicy(
        policy_id="policy-example",
        resource_type="tool",
        resource_id="issue_tracker/create_item",
        subject={"type": "user", "id": "example-user"},
        expression=expression,
        expression_sha256=expression.sha256(),
        input_schema_sha256=SCHEMA_HASH,
        authorization_model_id="model-example",
        status=PolicyStatus.ACTIVE,
        exclusive=True,
        created_by_hash="sha256:" + "b" * 64,
    )


def test_sensitive_values_do_not_escape_events_graph_logs_or_fixtures(caplog) -> None:
    request = CanonicalDecisionRequest(
        surface="agentgateway",
        transport="ext_authz",
        subject={"type": "user", "id": "example-user"},
        action="invoke",
        resource={"type": "tool", "id": "issue_tracker/create_item"},
        context=DecisionContext(
            request=RequestContext(arguments={"/project_key": SENSITIVE_VALUE})
        ),
    )
    result = CanonicalDecisionResult(
        decision_id=request.decision_id,
        allowed=True,
        outcome="ALLOW",
        reason_code="ALLOW_RELATIONSHIP",
        duration_ms=2,
    )
    event = decision_event(
        request,
        result,
        authoritative_path="AUTHZ",
        rollout_revision="revision-example",
        subject_salt="example-salt",
    )
    graph = project_graph(
        [
            ConditionalTuple(
                user="user:example-user",
                relation="conditional_caller",
                object="tool:issue_tracker/create_item",
                condition_name="string_argument_in_v1",
                condition_context={
                    "field": "/project_key",
                    "allowed_values": [SENSITIVE_VALUE],
                    "expected_schema_hash": SCHEMA_HASH,
                },
            )
        ],
        [policy()],
        limit=100,
    )
    serialized = json.dumps({"event": event.model_dump(mode="json"), "graph": graph})

    with caplog.at_level(logging.INFO, logger="authz-redaction"):
        logging.getLogger("authz-redaction").info("sanitized authorization projections %s", serialized)

    fixture_root = (
        Path(__file__).resolve().parents[2]
        / "ai_platform_engineering/authz/tests/fixtures"
    )
    fixture_text = "\n".join(
        path.read_text(errors="replace") for path in fixture_root.rglob("*") if path.is_file()
    )

    assert SENSITIVE_VALUE not in event.model_dump_json()
    assert SENSITIVE_VALUE not in json.dumps(graph)
    assert SENSITIVE_VALUE not in caplog.text
    assert SENSITIVE_VALUE not in fixture_text
    assert graph["edges"][0]["policy"] == {
        "policy_id": "policy-example",
        "status": "ACTIVE",
        "template": "string_argument_in_v1",
        "field": "/project_key",
        "schema_hash": SCHEMA_HASH,
        "version": 1,
        "exclusive": True,
        "schema_drift": False,
        "shadow_warnings": [],
    }

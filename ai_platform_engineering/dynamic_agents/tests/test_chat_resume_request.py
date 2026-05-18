import json

import pytest
from pydantic import ValidationError

from dynamic_agents.routes.chat import ResumeStreamRequest


def test_resume_request_accepts_current_resume_data() -> None:
    payload = json.dumps({"type": "form_input", "values": {"period": "FY26Q3"}})

    request = ResumeStreamRequest(
        agent_id="agent-finops-agent",
        conversation_id="conv-1",
        resume_data=payload,
        protocol="agui",
    )

    assert request.resume_data == payload


def test_resume_request_normalizes_legacy_form_data_values() -> None:
    request = ResumeStreamRequest(
        agent_id="agent-finops-agent",
        conversation_id="conv-1",
        form_data=json.dumps({"period": "FY26Q3", "report_type": "top_models"}),
        protocol="agui",
    )

    assert json.loads(request.resume_data or "{}") == {
        "type": "form_input",
        "values": {"period": "FY26Q3", "report_type": "top_models"},
    }


def test_resume_request_normalizes_legacy_reject_action() -> None:
    request = ResumeStreamRequest(
        agent_id="agent-finops-agent",
        conversation_id="conv-1",
        form_data=json.dumps({"action": "reject", "reason": "cancelled"}),
    )

    assert json.loads(request.resume_data or "{}") == {
        "type": "form_input",
        "dismissed": True,
    }


def test_resume_request_requires_resume_or_form_data() -> None:
    with pytest.raises(ValidationError):
        ResumeStreamRequest(agent_id="agent-finops-agent", conversation_id="conv-1")

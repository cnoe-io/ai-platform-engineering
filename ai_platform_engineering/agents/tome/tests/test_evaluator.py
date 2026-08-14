import json

import pytest
from pydantic import ValidationError

from tome_agent.agent.evaluator import __test__, _extract_json, evaluator_prompt_contract
from tome_agent.orchestrator.contract import (
    ArtifactEvaluationRequest,
    ArtifactEvaluationResponse,
)


def valid_payload() -> dict:
    return {
        "claims": [
            {
                "id": "claim-1",
                "page": "overview.md",
                "section": "Status",
                "exact_text": "The milestone is due Friday.",
                "start_offset": 10,
                "end_offset": 38,
                "classification": "unsupported",
                "reason": "No deadline appears in frozen evidence.",
                "confidence": 0.98,
                "abstained": False,
                "citations": [],
                "evidence": [],
                "critical_kind": "date_or_deadline",
                "fabricated_entities": [],
                "fabricated_quantitative_details": ["Friday"],
            }
        ],
        "signals": {
            "explicit_gaps": {"passed": 0, "total": 1, "findings": ["Invented date"]}
        },
    }


@pytest.mark.parametrize(
    "rendered",
    [
        lambda value: json.dumps(value),
        lambda value: f"```json\n{json.dumps(value)}\n```",
        lambda value: f"Result follows: {json.dumps(value)} done",
    ],
)
def test_extract_json_accepts_common_model_wrappers(rendered) -> None:
    payload = valid_payload()
    assert _extract_json(rendered(payload)) == payload


def test_evaluation_contract_rejects_unknown_claim_classification() -> None:
    payload = valid_payload()
    payload["claims"][0]["classification"] = "probably"
    with pytest.raises(ValidationError):
        ArtifactEvaluationResponse.model_validate(payload)


def test_evaluation_contract_rejects_out_of_range_confidence() -> None:
    payload = valid_payload()
    payload["claims"][0]["confidence"] = 1.2
    with pytest.raises(ValidationError):
        ArtifactEvaluationResponse.model_validate(payload)


def test_evaluator_prompt_contract_is_versioned_and_read_only() -> None:
    contract = evaluator_prompt_contract()

    assert contract.version == "tome-grounded-evaluator-v1"
    assert contract.editable is False
    assert "strict evidence auditor" in contract.system_prompt
    assert "{candidate_pages}" in contract.request_template
    assert "{frozen_evidence}" in contract.request_template


def test_request_prompt_renders_the_published_template() -> None:
    body = ArtifactEvaluationRequest(
        blind_label="candidate-x",
        evaluator_model="provider/model-judge",
        evaluator_prompt_version="tome-grounded-evaluator-v1",
        entity_type="project",
        candidate_pages={"activity.md": "Example output"},
        evidence=[],
        required_template_paths=["activity.md"],
        live_stable_pages={},
    )

    prompt = __test__["request_prompt"](body)

    assert "Blind candidate label: candidate-x" in prompt
    assert '<candidate_pages>{"activity.md": "Example output"}</candidate_pages>' in prompt
    assert "<frozen_evidence>[]</frozen_evidence>" in prompt

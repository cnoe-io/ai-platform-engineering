from __future__ import annotations

import pytest
from pydantic import ValidationError

from ai_platform_engineering.authz.core.contract import CanonicalDecisionRequest


def test_canonical_request_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        CanonicalDecisionRequest.model_validate(
            {
                "surface": "bff",
                "transport": "http",
                "subject": {"type": "user", "id": "example-user"},
                "action": "read",
                "resource": {"type": "agent", "id": "primary"},
                "provider": "cedar",
            }
        )


def test_canonical_request_builds_stable_openfga_refs() -> None:
    request = CanonicalDecisionRequest.model_validate(
        {
            "surface": "service",
            "transport": "http",
            "subject": {"type": "service_account", "id": "example-bot"},
            "action": "read",
            "resource": {"type": "agent", "id": "primary"},
        }
    )
    assert request.subject.openfga_ref == "service_account:example-bot"
    assert request.resource.openfga_ref == "agent:primary"

from __future__ import annotations

import json
from pathlib import Path

from ai_platform_engineering.authz.providers.openfga import canonical_model_sha256

EXPECTED = "sha256:42259bb25e67cedc2b71baa8b8b2dc3d7c5db793d726ff850b699b135f8d6c81"


def test_checked_in_model_has_the_pinned_canonical_descriptor() -> None:
    path = (
        Path(__file__).resolve().parents[4]
        / "charts/ai-platform-engineering/charts/openfga/authorization-model.json"
    )
    assert canonical_model_sha256(json.loads(path.read_text())) == EXPECTED


def test_openfga_response_defaults_do_not_change_the_descriptor() -> None:
    authored = {
        "schema_version": "1.1",
        "type_definitions": [{"type": "user", "relations": {}}],
    }
    response = {
        "id": "generated-model-id",
        "schema_version": "1.1",
        "type_definitions": [
            {"type": "user", "relations": {}, "metadata": None, "generic_types": []}
        ],
    }
    assert canonical_model_sha256(response) == canonical_model_sha256(authored)

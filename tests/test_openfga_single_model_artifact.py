from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHART_MODEL_MOUNT = (
    "./charts/ai-platform-engineering/charts/openfga/authorization-model.json:"
    "/app/authorization-model.json:ro"
)


def _openfga_init_service_block() -> str:
    compose = (ROOT / "docker-compose.dev.yaml").read_text()
    match = re.search(r"(?ms)^  openfga-init:\n(?P<body>.*?)(?=^  [a-zA-Z0-9_-]+:\n|\Z)", compose)
    assert match is not None
    return match.group("body")


def test_compose_openfga_init_mounts_the_chart_authorization_model() -> None:
    assert CHART_MODEL_MOUNT in _openfga_init_service_block()


def test_openfga_init_image_does_not_package_a_duplicate_authorization_model() -> None:
    dockerfile = (ROOT / "deploy/openfga/init/Dockerfile").read_text()

    assert "COPY authorization-model.json" not in dockerfile
    assert not (ROOT / "deploy/openfga/init/authorization-model.json").exists()


def test_openfga_init_no_longer_exposes_experiment_aliases() -> None:
    assert "OPENFGA_EXPERIMENT_SUB" not in (ROOT / "docker-compose.dev.yaml").read_text()
    assert "OPENFGA_EXPERIMENT_SUB" not in (ROOT / "deploy/openfga/init/seed.py").read_text()


def test_tome_documents_inherit_read_access_from_parent_documents() -> None:
    model = json.loads(
        (
            ROOT
            / "charts"
            / "ai-platform-engineering"
            / "charts"
            / "openfga"
            / "authorization-model.json"
        ).read_text()
    )
    document = next(
        definition
        for definition in model["type_definitions"]
        if definition["type"] == "document"
    )

    assert document["metadata"]["relations"]["parent"][
        "directly_related_user_types"
    ] == [{"type": "document"}]
    assert {
        "tupleToUserset": {
            "tupleset": {"relation": "parent"},
            "computedUserset": {"relation": "can_read"},
        }
    } in document["relations"]["can_read"]["union"]["child"]

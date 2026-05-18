import shutil
import subprocess
from pathlib import Path

import pytest


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def test_parent_chart_renders_bridge_token_validation_env() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is required for chart render assertions")

    chart = _repo_root() / "charts" / "ai-platform-engineering"
    result = subprocess.run(
        [
            "helm",
            "template",
            "caipe",
            str(chart),
            "--namespace",
            "caipe",
            "--set",
            "openfga.enabled=true",
            "--set",
            "openfgaAuthzBridge.enabled=true",
            "--set",
            "tags.keycloak=true",
            "--set",
            "openfga-authz-bridge.tokenValidation.issuer=https://idp.example.com/realms/caipe",
            "--set",
            "openfga-authz-bridge.tokenValidation.audiences[0]=agentgateway",
            "--set",
            "openfga-authz-bridge.tokenValidation.audiences[1]=caipe-platform",
            "--set",
            "openfga-authz-bridge.audit.existingSecret.name=caipe-mongodb",
            "--set",
            "openfga-authz-bridge.audit.existingSecret.key=MONGODB_URI",
        ],
        check=True,
        cwd=_repo_root(),
        text=True,
        capture_output=True,
    )

    rendered = result.stdout
    assert "name: caipe-openfga-authz-bridge" in rendered
    assert 'value: "http://caipe-keycloak:8080/realms/caipe/protocol/openid-connect/certs"' in rendered
    assert 'value: "https://idp.example.com/realms/caipe"' in rendered
    assert 'value: "agentgateway,caipe-platform"' in rendered
    assert 'value: "RS256"' in rendered
    assert "name: MONGODB_DATABASE" in rendered
    assert 'value: "caipe"' in rendered
    assert "name: MONGODB_URI" in rendered
    assert 'name: "caipe-mongodb"' in rendered
    assert 'key: "MONGODB_URI"' in rendered

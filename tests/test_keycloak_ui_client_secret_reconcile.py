from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART_PATH = REPO_ROOT / "charts" / "ai-platform-engineering" / "charts" / "keycloak"


def _helm_template(*extra_set_args: str) -> list[dict[str, Any]]:
    if shutil.which("helm") is None:
        pytest.fail("helm is required for keycloak chart tests")

    cmd = [
        "helm",
        "template",
        "test",
        str(CHART_PATH),
        "--set",
        "admin.secretRef=caipe-keycloak-admin",
        "--set",
        "idp.enabled=true",
        "--set",
        "idp.alias=okta",
        "--set",
        "idp.displayName=Okta",
        "--set",
        "idp.issuer=https://idp.example.com",
        "--set",
        "idp.clientId=okta-client",
        "--set",
        "idp.secretRef=caipe-keycloak-idp",
    ]
    for arg in extra_set_args:
        cmd.extend(["--set", arg])

    rendered = subprocess.run(cmd, check=True, text=True, capture_output=True).stdout
    return [doc for doc in yaml.safe_load_all(rendered) if doc]


def _find_job(docs: list[dict[str, Any]], suffix: str) -> dict[str, Any]:
    for doc in docs:
        if doc.get("kind") == "Job" and doc.get("metadata", {}).get("name", "").endswith(suffix):
            return doc
    raise AssertionError(f"job ending with {suffix!r} not found")


def _env(job: dict[str, Any], name: str) -> dict[str, Any]:
    env = job["spec"]["template"]["spec"]["containers"][0]["env"]
    for item in env:
        if item.get("name") == name:
            return item
    raise AssertionError(f"env var {name!r} not found")


def test_ui_client_secret_ref_is_wired_to_reconcile_jobs() -> None:
    docs = _helm_template("uiClient.secretRef=caipe-ui-secret")

    for suffix in ("-init-idp", "-auth-reconcile"):
        secret_ref = _env(_find_job(docs, suffix), "KEYCLOAK_UI_CLIENT_SECRET")["valueFrom"][
            "secretKeyRef"
        ]
        assert secret_ref == {"name": "caipe-ui-secret", "key": "OIDC_CLIENT_SECRET"}

    realm_config = next(
        doc for doc in docs if doc.get("kind") == "ConfigMap" and doc["metadata"]["name"].endswith("-realm")
    )
    assert "KEYCLOAK_UI_CLIENT_SECRET" not in realm_config["data"]["realm-config.json"]
    assert "caipe-ui-secret" not in realm_config["data"]["realm-config.json"]


def test_ui_client_external_secret_renders_source_of_truth_secret() -> None:
    docs = _helm_template(
        "uiClient.externalSecret.enabled=true",
        "uiClient.externalSecret.secretStoreRef.name=vault-eticloud",
        "uiClient.externalSecret.secretStoreRef.kind=ClusterSecretStore",
        "uiClient.externalSecret.remoteRef.key=projects/caipe/rbac/caipe-ui",
        "uiClient.externalSecret.remoteRef.property=OIDC_CLIENT_SECRET",
    )

    external_secret = next(
        doc
        for doc in docs
        if doc.get("kind") == "ExternalSecret"
        and doc.get("metadata", {}).get("name", "").endswith("-ui-client")
    )
    assert external_secret["spec"]["target"]["name"] == "test-keycloak-ui-client"
    assert external_secret["spec"]["data"] == [
        {
            "secretKey": "OIDC_CLIENT_SECRET",
            "remoteRef": {
                "key": "projects/caipe/rbac/caipe-ui",
                "property": "OIDC_CLIENT_SECRET",
            },
        }
    ]

    secret_ref = _env(_find_job(docs, "-init-idp"), "KEYCLOAK_UI_CLIENT_SECRET")["valueFrom"][
        "secretKeyRef"
    ]
    assert secret_ref == {"name": "test-keycloak-ui-client", "key": "OIDC_CLIENT_SECRET"}

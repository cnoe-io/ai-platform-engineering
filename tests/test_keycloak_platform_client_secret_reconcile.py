# assisted-by Claude:claude-opus-4-7
"""Helm template tests for the caipe-platform client_secret reconcile path.

Mirrors ``test_keycloak_ui_client_secret_reconcile`` — the chart MUST wire
``KEYCLOAK_PLATFORM_CLIENT_SECRET`` into both init Jobs whenever the operator
supplies either ``platformClient.secretRef`` or
``platformClient.externalSecret.enabled``, so ``init-idp.sh`` can PUT the real
secret into the running Keycloak and replace the realm placeholder.
"""

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


def _env_missing(job: dict[str, Any], name: str) -> bool:
    env = job["spec"]["template"]["spec"]["containers"][0]["env"]
    return all(item.get("name") != name for item in env)


def test_platform_client_secret_ref_is_wired_to_reconcile_jobs() -> None:
    """secretRef path: operator-managed Secret flows into both Jobs."""
    docs = _helm_template("platformClient.secretRef=caipe-platform-secret")

    for suffix in ("-init-idp", "-auth-reconcile"):
        secret_ref = _env(
            _find_job(docs, suffix), "KEYCLOAK_PLATFORM_CLIENT_SECRET"
        )["valueFrom"]["secretKeyRef"]
        assert secret_ref == {"name": "caipe-platform-secret", "key": "OIDC_CLIENT_SECRET"}

    realm_config = next(
        doc
        for doc in docs
        if doc.get("kind") == "ConfigMap" and doc["metadata"]["name"].endswith("-realm")
    )
    # The reconciled secret MUST NOT leak into the realm ConfigMap.
    assert "KEYCLOAK_PLATFORM_CLIENT_SECRET" not in realm_config["data"]["realm-config.json"]
    assert "caipe-platform-secret" not in realm_config["data"]["realm-config.json"]


def test_platform_client_external_secret_renders_source_of_truth_secret() -> None:
    """ESO path: chart emits an ExternalSecret and points the Jobs at it."""
    docs = _helm_template(
        "platformClient.externalSecret.enabled=true",
        "platformClient.externalSecret.secretStoreRef.name=vault-eticloud",
        "platformClient.externalSecret.secretStoreRef.kind=ClusterSecretStore",
        "platformClient.externalSecret.remoteRef.key=projects/caipe/rbac/caipe-platform",
        "platformClient.externalSecret.remoteRef.property=OIDC_CLIENT_SECRET",
    )

    external_secret = next(
        doc
        for doc in docs
        if doc.get("kind") == "ExternalSecret"
        and doc.get("metadata", {}).get("name", "").endswith("-platform-client")
    )
    assert external_secret["spec"]["target"]["name"] == "test-keycloak-platform-client"
    assert external_secret["spec"]["data"] == [
        {
            "secretKey": "OIDC_CLIENT_SECRET",
            "remoteRef": {
                "key": "projects/caipe/rbac/caipe-platform",
                "property": "OIDC_CLIENT_SECRET",
            },
        }
    ]

    secret_ref = _env(
        _find_job(docs, "-init-idp"), "KEYCLOAK_PLATFORM_CLIENT_SECRET"
    )["valueFrom"]["secretKeyRef"]
    assert secret_ref == {"name": "test-keycloak-platform-client", "key": "OIDC_CLIENT_SECRET"}


def test_platform_client_default_omits_env_var() -> None:
    """Default (no secretRef, no ESO): no env var, so init-idp.sh leaves
    the placeholder alone — preserves current dev/CI behaviour."""
    docs = _helm_template()

    for suffix in ("-init-idp", "-auth-reconcile"):
        job = _find_job(docs, suffix)
        assert _env_missing(job, "KEYCLOAK_PLATFORM_CLIENT_SECRET"), (
            f"{suffix} job should NOT inject KEYCLOAK_PLATFORM_CLIENT_SECRET "
            "when platformClient.secretRef and externalSecret.enabled are both unset"
        )

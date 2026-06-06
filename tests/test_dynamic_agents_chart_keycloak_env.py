# assisted-by Claude:claude-opus-4-7
"""Helm template / install tests for the dynamic-agents subchart's
Keycloak / OIDC env-var wiring.

Pins the contract documented in
``ai_platform_engineering/dynamic_agents/src/dynamic_agents/auth/jwks_validate.py``:

* ``KEYCLOAK_URL`` and ``OIDC_ISSUER`` are the two env vars that drive
  Bearer-token validation inside the dynamic-agents pod.
* When either is missing in a production-shaped deployment, the pod 401s
  every authenticated request — the failure mode that bit a recent
  in-cluster install (see PR notes / Slack thread linked in spec 102).
* The chart MUST therefore: (a) expose both keys under
  ``dynamic-agents.config``, (b) propagate them into the rendered
  ConfigMap whenever the operator sets them, and (c) print a visible
  NOTES.txt warning when either is empty so the misconfiguration is
  noticed at ``helm install`` time instead of as 401 spam in pod logs.

These tests use ``helm template`` (for the ConfigMap) and
``helm install --dry-run`` (for NOTES.txt — Helm does not render NOTES
during ``helm template``).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART_PATH = (
    REPO_ROOT
    / "charts"
    / "ai-platform-engineering"
    / "charts"
    / "dynamic-agents"
)

# global.image.tag must be set so the subchart can resolve appVersion
# when rendered standalone (the umbrella chart provides this normally).
_BASE_SET = [
    "global.image.tag=0.5.1-test",
]


def _require_helm() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is required for dynamic-agents chart tests")


def _helm_template(*extra_set_args: str) -> list[dict[str, Any]]:
    """Render the chart with ``helm template`` and return every k8s
    document as a list of dicts. Skips empty docs.
    """
    _require_helm()
    cmd = ["helm", "template", "test", str(CHART_PATH)]
    for arg in _BASE_SET + list(extra_set_args):
        cmd.extend(["--set", arg])
    rendered = subprocess.run(cmd, check=True, text=True, capture_output=True).stdout
    return [doc for doc in yaml.safe_load_all(rendered) if doc]


def _helm_install_dry_run(*extra_set_args: str) -> str:
    """Run ``helm install --dry-run`` so NOTES.txt is part of the output.

    Returns the full stdout (manifests + NOTES) as a string.
    """
    _require_helm()
    cmd = ["helm", "install", "test", str(CHART_PATH), "--dry-run"]
    for arg in _BASE_SET + list(extra_set_args):
        cmd.extend(["--set", arg])
    return subprocess.run(cmd, check=True, text=True, capture_output=True).stdout


def _find_configmap(docs: list[dict[str, Any]], suffix: str) -> dict[str, Any]:
    for doc in docs:
        if doc.get("kind") == "ConfigMap" and doc.get("metadata", {}).get("name", "").endswith(suffix):
            return doc
    raise AssertionError(f"ConfigMap ending with {suffix!r} not found in render")


# ---------------------------------------------------------------------------
# ConfigMap propagation
# ---------------------------------------------------------------------------


def test_keycloak_url_and_oidc_issuer_propagate_into_configmap() -> None:
    """Setting both at the chart values level must put both into the
    rendered ConfigMap (which is then mounted via envFrom on the pod).
    """
    docs = _helm_template(
        "config.KEYCLOAK_URL=http://caipe-keycloak:8080",
        "config.OIDC_ISSUER=https://idp.public.example.com/realms/caipe",
    )
    data = _find_configmap(docs, "-config")["data"]
    assert data["KEYCLOAK_URL"] == "http://caipe-keycloak:8080"
    assert data["OIDC_ISSUER"] == "https://idp.public.example.com/realms/caipe"


def test_empty_keycloak_env_is_omitted_from_configmap() -> None:
    """Default ``KEYCLOAK_URL=""`` / ``OIDC_ISSUER=""`` MUST be omitted
    from the rendered ConfigMap so the in-code defaults
    (``http://localhost:7080`` for KEYCLOAK_URL, derived issuer for
    OIDC_ISSUER) apply. An empty env-var would otherwise *override* the
    in-code default with an empty string, which is a sharper failure
    mode than just unsetting it.
    """
    docs = _helm_template()
    data = _find_configmap(docs, "-config")["data"]
    assert "KEYCLOAK_URL" not in data, (
        "Empty KEYCLOAK_URL leaked into ConfigMap — would override the "
        "in-code default. configmap.yaml must skip empty values."
    )
    assert "OIDC_ISSUER" not in data, (
        "Empty OIDC_ISSUER leaked into ConfigMap — would override the "
        "in-code default. configmap.yaml must skip empty values."
    )
    # Sanity: a non-empty key from the same range loop IS present so we
    # know the iteration itself is healthy.
    assert data.get("MONGODB_DATABASE") == "caipe"


def test_partial_set_only_includes_set_keys() -> None:
    """Setting only KEYCLOAK_URL (and leaving OIDC_ISSUER empty) puts
    only the one populated key into the ConfigMap. The pod will derive
    OIDC_ISSUER from KEYCLOAK_URL at runtime.
    """
    docs = _helm_template(
        "config.KEYCLOAK_URL=http://caipe-keycloak:8080",
    )
    data = _find_configmap(docs, "-config")["data"]
    assert data["KEYCLOAK_URL"] == "http://caipe-keycloak:8080"
    assert "OIDC_ISSUER" not in data


# ---------------------------------------------------------------------------
# NOTES.txt warning behaviour
# ---------------------------------------------------------------------------


def test_notes_warns_when_both_keycloak_envs_are_empty() -> None:
    output = _helm_install_dry_run()
    assert (
        "WARNING — Keycloak/OIDC env vars are NOT set for dynamic-agents."
        in output
    ), "NOTES.txt must warn when both KEYCLOAK_URL and OIDC_ISSUER are empty"
    # The fix-up snippet must be discoverable in the warning so operators
    # can copy-paste it straight into their values.yaml.
    assert "dynamic-agents:" in output
    assert "KEYCLOAK_URL:" in output
    assert "OIDC_ISSUER:" in output


def test_notes_warns_when_only_oidc_issuer_is_empty() -> None:
    output = _helm_install_dry_run(
        "config.KEYCLOAK_URL=http://caipe-keycloak:8080",
    )
    assert (
        "WARNING — OIDC_ISSUER is empty for dynamic-agents." in output
    ), "NOTES.txt must warn when only OIDC_ISSUER is empty"
    # The "both empty" wording MUST NOT appear in this branch.
    assert "Keycloak/OIDC env vars are NOT set" not in output


def test_notes_warns_when_only_keycloak_url_is_empty() -> None:
    output = _helm_install_dry_run(
        "config.OIDC_ISSUER=https://idp.public.example.com/realms/caipe",
    )
    assert (
        "WARNING — KEYCLOAK_URL is empty for dynamic-agents." in output
    ), "NOTES.txt must warn when only KEYCLOAK_URL is empty"
    assert "Keycloak/OIDC env vars are NOT set" not in output


def test_notes_quiet_when_both_keycloak_envs_are_set() -> None:
    output = _helm_install_dry_run(
        "config.KEYCLOAK_URL=http://caipe-keycloak:8080",
        "config.OIDC_ISSUER=https://idp.public.example.com/realms/caipe",
    )
    assert "WARNING" not in output, (
        "NOTES.txt must NOT warn when both Keycloak/OIDC env vars are set"
    )
    # NOTES.txt should still print the success line.
    assert "dynamic-agents installed." in output


# ---------------------------------------------------------------------------
# Umbrella-chart wiring (the actual deployment topology)
# ---------------------------------------------------------------------------


def test_umbrella_chart_sets_keycloak_url_by_default() -> None:
    """The parent chart MUST pre-populate ``dynamic-agents.config.KEYCLOAK_URL``
    so a vanilla ``helm install ai-platform-engineering`` works without the
    operator having to know about the env-var contract. ``OIDC_ISSUER`` is
    intentionally left empty in the parent chart (it depends on the
    deployment's public hostname), but KEYCLOAK_URL points at the bundled
    Keycloak service.

    We assert the umbrella chart values file contains the wiring rather
    than re-rendering the full umbrella chart (which pulls in dozens of
    subcharts and would slow these tests by an order of magnitude).
    """
    umbrella_values = (
        REPO_ROOT
        / "charts"
        / "ai-platform-engineering"
        / "values.yaml"
    ).read_text()

    # Crude but sufficient: the dynamic-agents block must mention both
    # KEYCLOAK_URL and OIDC_ISSUER under its config: section. We look
    # for the literal strings to avoid pulling in the full YAML parser
    # (the umbrella values.yaml has Helm template substitutions that
    # PyYAML would choke on).
    assert "KEYCLOAK_URL:" in umbrella_values
    assert "OIDC_ISSUER:" in umbrella_values
    assert "ai-platform-engineering-keycloak:8080" in umbrella_values, (
        "Umbrella chart must default KEYCLOAK_URL to the bundled Keycloak service"
    )

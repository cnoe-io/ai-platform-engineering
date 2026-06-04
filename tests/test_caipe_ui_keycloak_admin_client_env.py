# assisted-by Claude:claude-opus-4-7
"""Helm-render tests for the caipe-ui ↔ keycloak.platformClient secret wiring.

This is the chart-side counterpart to
``ui/src/lib/rbac/__tests__/keycloak-admin-token.test.ts``. The BFF's
``fetchFreshAdminToken`` MUST have ``KEYCLOAK_ADMIN_CLIENT_SECRET`` set
in the caipe-ui pod environment for ``client_credentials`` against the
Keycloak Admin API to work. When it is missing, the BFF silently falls
back to a ``password`` grant against ``/realms/master`` with the dev-only
``admin/admin`` credentials — which Kevin's in-cluster install exposed
as a 401 ``invalid_grant`` once the master-realm admin password was
rotated. Since R1 (production-safety gate, May 2026) the BFF refuses
that fallback in production, so a misconfigured install fails LOUD
instead of silently calling ``/realms/master``.

R1 upstream fix (May 2026) — implemented:
The umbrella chart now defaults BOTH
``keycloak.platformClient.secretRef`` AND
``caipe-ui.keycloakAdminClient.secretName`` to ``caipe-platform-secret``,
and the caipe-ui chart auto-wires ``KEYCLOAK_ADMIN_CLIENT_ID`` (via the
ConfigMap) plus ``KEYCLOAK_ADMIN_CLIENT_SECRET`` (via
``valueFrom.secretKeyRef``) whenever ``keycloakAdminClient.secretName``
is non-empty. This file pins six things now that the gap is closed:

1. **Default install** — out of the box, the caipe-ui Deployment has
   ``KEYCLOAK_ADMIN_CLIENT_SECRET`` sourced from ``caipe-platform-secret``
   and ``KEYCLOAK_ADMIN_CLIENT_ID=caipe-platform`` in the ConfigMap.
   This is the green-path replacement for the old "regression guard"
   Pin 1.
2. **Legacy operator workaround** — setting ``caipe-ui.existingSecret``
   alongside still mounts the Secret via ``envFrom`` for back-compat
   with the half-fix operators may already have in their values.yaml.
3. **Explicit ``platformClient.secretRef``** — same auto-wiring,
   confirms the secretRef path renders identically to the default.
4. **ExternalSecret path** — ``platformClient.externalSecret.enabled=true``
   produces a Secret named ``caipe-platform-secret`` (now that the
   umbrella defaults ``platformClient.secretRef``), and the caipe-ui
   pod picks it up by the same path as the K8s-Secret-ref case.
5. **R1 production-safety gate (BFF)** — ``NODE_ENV=production`` and
   ``ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK`` not defaulted to ``true``.
6. **R1 explicit dev opt-in** — operators can flip the BFF gate open
   in throwaway clusters by setting the explicit override.
7. **NEW (R1 upstream fix)** — operator override of
   ``caipe-ui.keycloakAdminClient.secretName`` lets them point the BFF
   at a non-default Secret name (e.g. one ESO-managed by a different
   secret store).
8. **NEW (R1 upstream fix)** — when an operator explicitly empties
   ``caipe-ui.keycloakAdminClient.secretName=""`` (standalone caipe-ui
   dev install with no in-cluster Keycloak), the chart skips the
   ``KEYCLOAK_ADMIN_CLIENT_*`` wiring entirely so the pod still starts.
9. **NEW (R1 upstream fix)** — an explicit
   ``caipe-ui.config.KEYCLOAK_ADMIN_CLIENT_ID`` override wins over the
   chart-injected default (no clobber).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[1]
CHART_PATH = REPO_ROOT / "charts" / "ai-platform-engineering"


def _require_helm() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is required for umbrella chart tests")


# The umbrella chart has dozens of subcharts behind `tags:` gates. Enable
# only what we need (caipe-ui + keycloak) so each helm template render is
# < 1 second and the test output stays focused on the relevant manifests.
#
# The keycloak subchart hard-fails the template render unless the operator
# supplies either ``admin.secretRef`` or ``admin.password`` — pick the
# secretRef path (parity with what an ESO-driven prod install would do)
# so the test isolates the platformClient wiring under test rather than
# the bootstrap-admin password.
_BASE_SET = [
    "tags.caipe-ui=true",
    "tags.keycloak=true",
    "keycloak.admin.secretRef=caipe-keycloak-admin",
]


def _helm_template(*extra_set_args: str) -> list[dict[str, Any]]:
    _require_helm()
    cmd = ["helm", "template", "test", str(CHART_PATH)]
    for arg in _BASE_SET + list(extra_set_args):
        cmd.extend(["--set", arg])
    rendered = subprocess.run(cmd, check=True, text=True, capture_output=True).stdout
    return [doc for doc in yaml.safe_load_all(rendered) if doc]


def _find_caipe_ui_deployment(docs: list[dict[str, Any]]) -> dict[str, Any]:
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        name = doc.get("metadata", {}).get("name", "")
        # caipe-ui-mongodb is a sibling deployment in the umbrella; filter it out.
        if "caipe-ui" in name and "mongodb" not in name:
            return doc
    raise AssertionError("caipe-ui Deployment not found in umbrella render")


def _container_env_names(deployment: dict[str, Any]) -> set[str]:
    containers = deployment["spec"]["template"]["spec"]["containers"]
    env_names: set[str] = set()
    for container in containers:
        for entry in container.get("env", []) or []:
            name = entry.get("name")
            if name:
                env_names.add(name)
    return env_names


def _container_env_value(deployment: dict[str, Any], name: str) -> Any:
    containers = deployment["spec"]["template"]["spec"]["containers"]
    for container in containers:
        for entry in container.get("env", []) or []:
            if entry.get("name") == name:
                return entry
    raise AssertionError(f"env var {name!r} not found in caipe-ui deployment")


def _env_from_secret_names(deployment: dict[str, Any]) -> list[str]:
    """List every Secret that the caipe-ui container mounts via
    ``envFrom: secretRef``. The BFF receives admin-client credentials
    through this mechanism when the operator applies Sri's workaround.
    """
    containers = deployment["spec"]["template"]["spec"]["containers"]
    secret_names: list[str] = []
    for container in containers:
        for entry in container.get("envFrom", []) or []:
            secret_ref = entry.get("secretRef")
            if secret_ref and secret_ref.get("name"):
                secret_names.append(secret_ref["name"])
    return secret_names


def _find_configmap(docs: list[dict[str, Any]], name_contains: str) -> dict[str, Any]:
    for doc in docs:
        if doc.get("kind") != "ConfigMap":
            continue
        name = doc.get("metadata", {}).get("name", "")
        if name_contains in name:
            return doc
    raise AssertionError(f"ConfigMap containing {name_contains!r} not found")


# ---------------------------------------------------------------------------
# Pin 1 — default install: caipe-platform-secret auto-wired
# ---------------------------------------------------------------------------


def test_default_install_auto_wires_caipe_ui_admin_client() -> None:
    """Out of the box, the umbrella chart defaults
    ``caipe-ui.keycloakAdminClient.secretName`` to ``caipe-platform-secret``
    so the BFF's ``fetchFreshAdminToken`` path is wired without any
    operator action.

    This is the green-path replacement for the old "regression guard"
    Pin 1 from the pre-R1-upstream-fix world. If this test fails, the
    default lost its wiring — most likely because someone changed the
    umbrella default to ``""`` or renamed ``keycloakAdminClient``.
    """
    docs = _helm_template()
    deployment = _find_caipe_ui_deployment(docs)
    config = _find_configmap(docs, "-caipe-ui-config")["data"]

    # KEYCLOAK_ADMIN_CLIENT_ID lands in the ConfigMap.
    assert config.get("KEYCLOAK_ADMIN_CLIENT_ID") == "caipe-platform", (
        "Default install should inject KEYCLOAK_ADMIN_CLIENT_ID=caipe-platform "
        "into the caipe-ui ConfigMap. If this fires, did someone unset the "
        "umbrella default caipe-ui.keycloakAdminClient.secretName=caipe-platform-secret?"
    )

    # KEYCLOAK_ADMIN_CLIENT_SECRET comes from a secretKeyRef, never inlined.
    admin_secret_env = _container_env_value(deployment, "KEYCLOAK_ADMIN_CLIENT_SECRET")
    secret_key_ref = admin_secret_env.get("valueFrom", {}).get("secretKeyRef", {})
    assert secret_key_ref.get("name") == "caipe-platform-secret"
    assert secret_key_ref.get("key") == "OIDC_CLIENT_SECRET"

    # And the value: must NEVER be inlined into the ConfigMap (only the
    # ID is safe to inline; the secret crosses the trust boundary).
    assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in config


# ---------------------------------------------------------------------------
# Pin 2 — legacy operator workaround (existingSecret still works)
# ---------------------------------------------------------------------------


def test_legacy_existing_secret_workaround_still_mounts_the_secret() -> None:
    """An operator who pinned the old half-fix into their values.yaml
    (``caipe-ui.existingSecret=caipe-platform-secret``) should not have
    their install break under the R1 upstream fix. The new auto-wiring
    coexists with ``existingSecret``; both mount the same physical
    Secret, which is fine — there is no env-var collision because
    ``existingSecret`` mounts it as ``OIDC_CLIENT_SECRET`` (the Secret's
    own key) while the new wiring projects only the value under the
    new env name ``KEYCLOAK_ADMIN_CLIENT_SECRET``.
    """
    docs = _helm_template(
        "caipe-ui.existingSecret=caipe-platform-secret",
    )
    deployment = _find_caipe_ui_deployment(docs)
    envfrom_secrets = _env_from_secret_names(deployment)
    env_names = _container_env_names(deployment)

    # Legacy: Secret is mounted via envFrom.
    assert "caipe-platform-secret" in envfrom_secrets, (
        "Legacy operator workaround broke. Operators who set "
        "caipe-ui.existingSecret should still see the Secret mounted."
    )
    # And the new R1 wiring also fires (since both default and explicit
    # paths converge on the same Secret name).
    assert "KEYCLOAK_ADMIN_CLIENT_SECRET" in env_names


# ---------------------------------------------------------------------------
# Pin 3 — explicit platformClient.secretRef path
# ---------------------------------------------------------------------------


def test_platform_client_secret_ref_auto_wires_caipe_ui_admin_client() -> None:
    """Pin the operator-facing fix: setting
    ``keycloak.platformClient.secretRef=caipe-platform-secret`` (i.e. the
    explicit form of the default) renders identically to the default
    install — no separate ``caipe-ui.existingSecret`` override or
    ``extraDeploy:`` parallel Secret required.

    Asserts:
      * ``KEYCLOAK_ADMIN_CLIENT_ID="caipe-platform"`` in the ConfigMap.
      * ``KEYCLOAK_ADMIN_CLIENT_SECRET`` sourced via
        ``valueFrom.secretKeyRef`` against the operator-supplied Secret,
        key ``OIDC_CLIENT_SECRET``.
    """
    docs = _helm_template(
        "keycloak.platformClient.secretRef=caipe-platform-secret",
    )
    deployment = _find_caipe_ui_deployment(docs)
    config = _find_configmap(docs, "-caipe-ui-config")["data"]

    assert config.get("KEYCLOAK_ADMIN_CLIENT_ID") == "caipe-platform"

    admin_secret_env = _container_env_value(deployment, "KEYCLOAK_ADMIN_CLIENT_SECRET")
    secret_key_ref = admin_secret_env.get("valueFrom", {}).get("secretKeyRef", {})
    assert secret_key_ref.get("name") == "caipe-platform-secret"
    assert secret_key_ref.get("key") == "OIDC_CLIENT_SECRET"


# ---------------------------------------------------------------------------
# Pin 4 — externalSecret (ESO) path
# ---------------------------------------------------------------------------


def test_platform_client_external_secret_auto_wires_caipe_ui_admin_client() -> None:
    """ESO path: ``platformClient.externalSecret.enabled=true`` emits an
    ExternalSecret whose target is also ``caipe-platform-secret`` (the
    keycloak chart's ``platformClientSecretName`` helper resolves to
    that name because the umbrella defaults ``platformClient.secretRef``).
    The caipe-ui pod picks it up by the same path as the K8s-Secret-ref
    case. This is the assertion that pins the ESO-only operator's
    out-of-the-box experience.
    """
    docs = _helm_template(
        "keycloak.platformClient.externalSecret.enabled=true",
        "keycloak.platformClient.externalSecret.secretStoreRef.name=vault",
        "keycloak.platformClient.externalSecret.secretStoreRef.kind=ClusterSecretStore",
        "keycloak.platformClient.externalSecret.remoteRef.key=dev/keycloak/caipe-platform",
        "keycloak.platformClient.externalSecret.remoteRef.property=client_secret",
    )
    deployment = _find_caipe_ui_deployment(docs)

    admin_secret_env = _container_env_value(deployment, "KEYCLOAK_ADMIN_CLIENT_SECRET")
    secret_key_ref = admin_secret_env.get("valueFrom", {}).get("secretKeyRef", {})
    # ExternalSecret target name lines up with the umbrella default for
    # platformClient.secretRef — both resolve to caipe-platform-secret.
    # See keycloak/templates/platform-client-external-secret.yaml +
    # keycloak/templates/_helpers.tpl `keycloak.platformClientSecretName`.
    assert secret_key_ref.get("name") == "caipe-platform-secret"
    assert secret_key_ref.get("key") == "OIDC_CLIENT_SECRET"

    # Also confirm the ESO resource actually targets the same name.
    eso_resources = [doc for doc in docs if doc.get("kind") == "ExternalSecret"]
    platform_eso = next(
        (doc for doc in eso_resources
         if doc.get("spec", {}).get("target", {}).get("name") == "caipe-platform-secret"),
        None,
    )
    assert platform_eso is not None, (
        "Expected an ExternalSecret with target.name=caipe-platform-secret. "
        "If this fires, the keycloak chart's platformClientSecretName helper "
        "no longer resolves to the umbrella default — both halves of the R1 "
        "upstream fix have to land together."
    )


# ---------------------------------------------------------------------------
# Pin 5 — R1 production-safety gate for the admin/admin BFF fallback
# ---------------------------------------------------------------------------
#
# These pin the chart side of the gate that lives in
# ``ui/src/lib/rbac/keycloak-admin.ts::adminPasswordFallbackAllowed``.
# The gate refuses the master-realm /admin-cli/admin/admin fallback when
# the BFF runs in production unless the operator explicitly opts in via
# ``ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK``. The corresponding env
# behaviour is tested by the Jest suite at
# ``ui/src/lib/rbac/__tests__/keycloak-admin-token.test.ts``.


def test_default_chart_render_has_node_env_production_and_no_admin_fallback_optin() -> None:
    """Production defaults: NODE_ENV=production AND the opt-in flag is
    rendered to an empty string (or absent). That combination is what
    forces ``adminPasswordFallbackAllowed()`` to return ``false`` so a
    misconfigured prod install fails loudly instead of silently calling
    ``/realms/master`` with ``admin/admin``.
    """
    docs = _helm_template()
    config = _find_configmap(docs, "-caipe-ui-config")["data"]

    # Defense-in-depth #1: NODE_ENV must be production by default.
    assert config.get("NODE_ENV") == "production", (
        "If NODE_ENV is no longer 'production' by default, the BFF "
        "admin/admin fallback gate flips OPEN in every fresh install. "
        "Restore the default before merging."
    )

    # Defense-in-depth #2: the opt-in flag must not default to "true".
    # An empty string or "false" both yield "fallback blocked" in the
    # BFF; the only dangerous value is "true" (or "1"). Pin both
    # reasonable defaults — operators can still set this to "true"
    # explicitly in their own values file for a throwaway cluster.
    allow_flag = config.get("ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK", "")
    assert allow_flag not in ("true", "1"), (
        "ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK must NOT default to "
        f"{allow_flag!r}; that re-enables master-realm admin "
        "escalation from the BFF in production. See R1 in "
        "docs/docs/security/rbac/secrets-bootstrap.md."
    )


def test_operator_can_opt_in_to_admin_password_fallback_in_dev_cluster() -> None:
    """An operator running a throwaway dev cluster with NODE_ENV=production
    can still re-enable the admin/admin fallback by flipping the explicit
    flag. This is the supported escape hatch — pin its shape so a future
    refactor can't silently rename it.
    """
    docs = _helm_template(
        "caipe-ui.config.ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK=true",
    )
    config = _find_configmap(docs, "-caipe-ui-config")["data"]
    assert config.get("ALLOW_KEYCLOAK_ADMIN_PASSWORD_FALLBACK") == "true"
    # The matching BFF behaviour ("true" overrides production) is pinned
    # in keycloak-admin-token.test.ts ("production safety gate" describe).


# ---------------------------------------------------------------------------
# Pin 7 — custom Secret name override (non-default install)
# ---------------------------------------------------------------------------


def test_operator_can_override_admin_client_secret_name() -> None:
    """Operators who deviate from the conventional Secret name must
    override BOTH halves of the wiring (Helm can't substitute across
    subchart boundaries). Pin that contract here so a future refactor
    can't silently break the only documented "non-default name" path.
    """
    docs = _helm_template(
        "keycloak.platformClient.secretRef=my-custom-platform-secret",
        "caipe-ui.keycloakAdminClient.secretName=my-custom-platform-secret",
    )
    deployment = _find_caipe_ui_deployment(docs)
    admin_secret_env = _container_env_value(deployment, "KEYCLOAK_ADMIN_CLIENT_SECRET")
    secret_key_ref = admin_secret_env.get("valueFrom", {}).get("secretKeyRef", {})
    assert secret_key_ref.get("name") == "my-custom-platform-secret"
    assert secret_key_ref.get("key") == "OIDC_CLIENT_SECRET"


# ---------------------------------------------------------------------------
# Pin 8 — standalone caipe-ui dev install: empty secretName skips wiring
# ---------------------------------------------------------------------------


def test_empty_admin_client_secret_name_skips_wiring() -> None:
    """A standalone caipe-ui deployment (no in-cluster Keycloak; the BFF
    talks to an external Keycloak via its own ``OIDC_CLIENT_SECRET`` in
    ``existingSecret``) MUST NOT carry a ``KEYCLOAK_ADMIN_CLIENT_SECRET``
    env entry that points at a non-existent Secret — that would block
    pod start with `CreateContainerConfigError`.

    Pin the explicit-empty escape hatch: setting
    ``caipe-ui.keycloakAdminClient.secretName=""`` removes the env entry
    cleanly. This is the path standalone subchart users take.
    """
    docs = _helm_template(
        "caipe-ui.keycloakAdminClient.secretName=",
    )
    deployment = _find_caipe_ui_deployment(docs)
    config = _find_configmap(docs, "-caipe-ui-config")["data"]
    env_names = _container_env_names(deployment)

    # No env entry for the secret value.
    assert "KEYCLOAK_ADMIN_CLIENT_SECRET" not in env_names, (
        "Empty caipe-ui.keycloakAdminClient.secretName MUST drop the "
        "KEYCLOAK_ADMIN_CLIENT_SECRET env entry; otherwise the pod "
        "fails to start when the Secret doesn't exist."
    )
    # The ConfigMap also drops KEYCLOAK_ADMIN_CLIENT_ID since the
    # auto-injection only fires when secretName is set.
    assert "KEYCLOAK_ADMIN_CLIENT_ID" not in config


# ---------------------------------------------------------------------------
# Pin 9 — explicit config.KEYCLOAK_ADMIN_CLIENT_ID override wins
# ---------------------------------------------------------------------------


def test_explicit_config_admin_client_id_overrides_auto_injection() -> None:
    """An operator who explicitly sets
    ``caipe-ui.config.KEYCLOAK_ADMIN_CLIENT_ID`` in their values file
    (e.g. they configured a separate confidential client for the BFF
    that isn't ``caipe-platform``) MUST have their value win — the
    chart's auto-injection only fires when the key is absent. Pin the
    no-clobber behaviour here.
    """
    docs = _helm_template(
        "caipe-ui.config.KEYCLOAK_ADMIN_CLIENT_ID=my-custom-admin-client",
    )
    config = _find_configmap(docs, "-caipe-ui-config")["data"]
    assert config.get("KEYCLOAK_ADMIN_CLIENT_ID") == "my-custom-admin-client", (
        "Operator-supplied caipe-ui.config.KEYCLOAK_ADMIN_CLIENT_ID was "
        "clobbered by the chart auto-injection. The `hasKey` guard in "
        "configmap.yaml protects against this; if it broke, restore it."
    )

# assisted-by Claude:claude-opus-4-7
"""Helm-render tests for the production hardening flag
``caipe-ui-mongodb.strictPasswords`` (R3).

When the operator sets ``strictPasswords=true`` AND
``externalSecrets.enabled=false``, the chart MUST refuse to render if
``auth.rootPassword`` is in the known-placeholder set (``"changeme"``,
``"admin"``, ``"password"``, …).

When ``strictPasswords=false`` (chart default) OR
``externalSecrets.enabled=true``, the chart MUST render successfully
regardless of ``auth.rootPassword``. The first branch preserves the
docker-compose dev flow; the second is the production-via-ESO escape
hatch (the in-cluster Secret comes from the external store, so the
chart's ``auth.rootPassword`` value is irrelevant).

This is the chart-side counterpart to the upcoming
``tests/integration/test_mongodb_strict_passwords.sh`` end-to-end test.
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
    / "caipe-ui-mongodb"
)

# Minimum set of values needed to render the subchart standalone. The
# vpa template dereferences `dig "vpa" dict .Values.global` which
# explodes if `global` is nil — so we always supply a flat global.
_BASE_SET = [
    "global.image.tag=0.5.1",
    "global.vpa.enabled=false",
]


def _require_helm() -> None:
    if shutil.which("helm") is None:
        pytest.skip("helm is required for caipe-ui-mongodb chart tests")


def _helm_template(*extra_set_args: str) -> subprocess.CompletedProcess[str]:
    """Run `helm template` and return the raw CompletedProcess so callers
    can inspect both stdout and stderr. We deliberately do NOT pass
    `check=True` here because the strict-mode tests EXPECT non-zero
    exits — the test asserts on the stderr message instead.
    """
    _require_helm()
    cmd = ["helm", "template", "test", str(CHART_PATH)]
    for arg in _BASE_SET + list(extra_set_args):
        cmd.extend(["--set", arg])
    return subprocess.run(cmd, capture_output=True, text=True)


def _docs(result: subprocess.CompletedProcess[str]) -> list[dict[str, Any]]:
    assert result.returncode == 0, (
        f"helm template failed unexpectedly:\nstdout:\n{result.stdout}\n"
        f"stderr:\n{result.stderr}"
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def _find_secret(docs: list[dict[str, Any]]) -> dict[str, Any]:
    for doc in docs:
        if doc.get("kind") == "Secret":
            return doc
    raise AssertionError("MongoDB Secret not rendered")


# ---------------------------------------------------------------------------
# Pin 1 — chart default: strict mode OFF, placeholder password is allowed
# ---------------------------------------------------------------------------


def test_default_render_allows_changeme_placeholder() -> None:
    """The chart default is `strictPasswords=false`, so the docker-compose
    dev flow that ships `rootPassword=changeme` continues to render.

    If this test FIRES (i.e. the chart now refuses to render with default
    values), then either (a) the default flipped to true — that's a
    breaking change worth documenting in CHANGELOG.md — or (b) the
    placeholder set ate a legitimate user-chosen value.
    """
    result = _helm_template()
    docs = _docs(result)
    secret = _find_secret(docs)
    assert secret["stringData"]["MONGO_INITDB_ROOT_PASSWORD"] == "changeme"


# ---------------------------------------------------------------------------
# Pin 2 — strict mode ON: each known placeholder is rejected by name
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "placeholder",
    [
        # Exact chart default — the regression guard. If this test ever
        # passes silently it means the chart default leaked through.
        "changeme",
        # Other entries from `_strict-passwords.tpl::placeholders`. We
        # parametrize them all so a future maintainer who adds a new
        # placeholder MUST add a matching test case here.
        "admin",
        "password",
        "mongo",
        "root",
        "test",
        "secret",
        "your-password-here",
    ],
)
def test_strict_mode_rejects_known_placeholder(placeholder: str) -> None:
    """For each known placeholder, the chart MUST refuse to render with
    a non-zero exit AND a stderr message that points the operator at
    both the override path AND the docs.
    """
    result = _helm_template(
        "strictPasswords=true",
        f"auth.rootPassword={placeholder}",
    )
    assert result.returncode != 0, (
        f"Expected helm template to fail for placeholder {placeholder!r}; "
        f"got exit 0 with stdout:\n{result.stdout}"
    )
    # The stderr message must include the exact placeholder so the
    # operator can grep their values.yaml and find the offending line.
    # We compare lower() because the helper itself lower()s the input.
    assert placeholder.lower() in result.stderr.lower(), (
        f"Expected stderr to mention placeholder {placeholder!r}; "
        f"got:\n{result.stderr}"
    )
    # The error must also link the docs so an operator can find context.
    assert "secrets-bootstrap.md" in result.stderr


def test_strict_mode_rejects_case_insensitive_placeholder() -> None:
    """An operator who types `ChangeMe` (mixed case) MUST still get
    rejected — placeholder detection is case-folded so the gate isn't
    trivially bypassable by capitalization tricks.
    """
    result = _helm_template(
        "strictPasswords=true",
        "auth.rootPassword=ChangeMe",
    )
    assert result.returncode != 0
    assert "changeme" in result.stderr.lower()


def test_strict_mode_rejects_short_passwords() -> None:
    """A 7-char password that ISN'T in the placeholder set is still
    likely a typo / leftover dev value. Pin the 8-char minimum here so
    the floor can't silently drop without a test failing.
    """
    result = _helm_template(
        "strictPasswords=true",
        "auth.rootPassword=abc1234",  # 7 chars, not a placeholder
    )
    assert result.returncode != 0
    assert "too short" in result.stderr.lower()
    assert "minimum 8" in result.stderr.lower()


# ---------------------------------------------------------------------------
# Pin 3 — strict mode ON: real password renders cleanly
# ---------------------------------------------------------------------------


def test_strict_mode_accepts_real_password() -> None:
    """A real CSPRNG-shaped password (≥8 chars, not a placeholder) MUST
    render the Secret as usual. This is the happy path for the operator
    who has already rotated their password.
    """
    real_password = "kQXf8vN3p2RmHcLwYj7tBdAeUg"
    result = _helm_template(
        "strictPasswords=true",
        f"auth.rootPassword={real_password}",
    )
    docs = _docs(result)
    secret = _find_secret(docs)
    assert secret["stringData"]["MONGO_INITDB_ROOT_PASSWORD"] == real_password


# ---------------------------------------------------------------------------
# Pin 4 — strict mode ON + ESO: the gate skips the check entirely
# ---------------------------------------------------------------------------


def test_strict_mode_with_external_secrets_skips_check() -> None:
    """When `externalSecrets.enabled=true`, the in-cluster Secret is
    sourced from Vault / AWS Secrets Manager / etc., and the chart's
    `auth.rootPassword` value never lands in etcd. The strict-mode
    gate MUST skip its placeholder check in that case — otherwise we
    block legitimate prod installs that have left `auth.rootPassword`
    at the chart default while their actual secret comes from ESO.
    """
    result = _helm_template(
        "strictPasswords=true",
        "externalSecrets.enabled=true",
        # Leave auth.rootPassword at the chart default ("changeme") —
        # the assertion is that strict mode IGNORES that value when ESO
        # is on.
    )
    docs = _docs(result)
    # When ESO is enabled, the chart's own Secret is NOT rendered (the
    # ExternalSecret CRD will produce it). So the absence of a Secret
    # named …-secret is the right signal here.
    secret_kinds = [doc.get("kind") for doc in docs]
    # The ExternalSecret resource SHOULD be present.
    assert "ExternalSecret" in secret_kinds, (
        "Expected an ExternalSecret resource when externalSecrets.enabled=true; "
        f"got kinds: {secret_kinds}"
    )
    # And the chart's own Secret SHOULD NOT be present.
    chart_secret_present = any(
        doc.get("kind") == "Secret"
        and doc.get("metadata", {}).get("name", "").endswith("-mongodb-secret")
        and "MONGO_INITDB_ROOT_PASSWORD" in (doc.get("stringData") or {})
        for doc in docs
    )
    assert not chart_secret_present, (
        "Chart-built MongoDB Secret should NOT be rendered when "
        "externalSecrets.enabled=true. ESO produces it instead."
    )


# ---------------------------------------------------------------------------
# Pin 5 — strict mode OFF: short passwords still allowed (back-compat)
# ---------------------------------------------------------------------------


def test_default_render_allows_short_password() -> None:
    """With `strictPasswords=false` (the chart default), the 8-char
    minimum doesn't apply either. This pins the dev escape hatch — if
    we ever decide to enforce length unconditionally, this test will
    FAIL and the change can be documented as a breaking one.
    """
    result = _helm_template("auth.rootPassword=short")
    docs = _docs(result)
    secret = _find_secret(docs)
    assert secret["stringData"]["MONGO_INITDB_ROOT_PASSWORD"] == "short"

"""Unit tests for the **vendored** ``dynamic_agents.auth.jwks_validate``.

This module is a copy of ``ai_platform_engineering.utils.auth.jwks_validate``
that ships *inside* the dynamic-agents runtime container (the shared
``ai_platform_engineering.utils.*`` package is NOT installed in that image,
so the vendored copy is what every Bearer-validated request actually
loads — see ``jwt_middleware._validate_bearer_or_none``).

The shared copy has its own tests in ``tests/rbac/unit/py/test_jwks_validate.py``.
This file pins the **vendored** copy independently so a drift between the two
(env-var names, defaults, audience semantics, etc.) cannot silently regress
the runtime path that Kevin's pod actually executes.

Specifically, these tests document and pin the two failure modes that bit a
recent in-cluster install:

1. ``KEYCLOAK_URL`` unset → ``_kc_base_url()`` falls back to
   ``http://localhost:7080``. Inside a pod that fetches JWKS server-to-server
   and the result is ``Connection refused`` — this test makes that default
   explicit so anyone touching the resolver knows the trap.
2. ``OIDC_ISSUER`` unset but the token's ``iss`` is the *browser-facing*
   issuer (e.g. ``https://idp.public/realms/caipe``) while ``KEYCLOAK_URL``
   points at the *in-cluster* service (``http://caipe-keycloak:8080``).
   ``_kc_issuer()`` derives ``http://caipe-keycloak:8080/realms/caipe`` and
   PyJWT rejects the token with ``InvalidIssuerError`` even though JWKS
   fetch itself works.

assisted-by Claude:claude-opus-4-7
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from dynamic_agents.auth import jwks_validate

# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


@dataclass
class _Keypair:
    private_pem: bytes
    public_key: object  # cryptography RSAPublicKey


@pytest.fixture(scope="module")
def keypair() -> _Keypair:
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return _Keypair(private_pem=pem, public_key=priv.public_key())


def _mint(
    keypair: _Keypair,
    *,
    issuer: str,
    audience: str = "caipe-platform",
    sub: str = "test-user",
    exp_offset_s: int = 600,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": issuer,
            "aud": audience,
            "sub": sub,
            "iat": now,
            "exp": now + exp_offset_s,
        },
        keypair.private_pem,
        algorithm="RS256",
    )


@pytest.fixture
def patch_jwks(keypair: _Keypair, monkeypatch: pytest.MonkeyPatch) -> None:
    """Make ``PyJWKClient.get_signing_key_from_jwt`` return our public key
    so the validator never reaches the network. The resolver functions
    (``_kc_jwks_uri`` etc.) still run with whatever env vars the test set.
    """

    class _SigningKey:
        key = keypair.public_key

    def _fake(self, _token):  # noqa: ANN001
        return _SigningKey()

    monkeypatch.setattr(jwks_validate.PyJWKClient, "get_signing_key_from_jwt", _fake)


@pytest.fixture(autouse=True)
def _reset_jwks_cache() -> None:
    """Each test starts with an empty JWKS-client cache so module-level state
    doesn't leak across tests. The cache key is the JWKS URI, so a test that
    mints with ``KEYCLOAK_URL=http://kc-a`` and one that mints with
    ``KEYCLOAK_URL=http://kc-b`` MUST get distinct PyJWKClient instances.
    """
    jwks_validate.reset_jwks_cache_for_tests()
    yield
    jwks_validate.reset_jwks_cache_for_tests()


@pytest.fixture
def _clear_kc_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Strip every Keycloak/OIDC env var the resolver looks at so each test
    starts from a clean slate and ``os.environ.get(..., default)`` returns
    the in-code default, not whatever the caller's shell happens to export.
    """
    for var in (
        "KEYCLOAK_URL",
        "KEYCLOAK_REALM",
        "OIDC_ISSUER",
        "KEYCLOAK_ISSUER",
        "OIDC_DISCOVERY_URL",
        "KEYCLOAK_JWKS_URL",
        "OIDC_JWKS_URL",
        "KEYCLOAK_AUDIENCE",
        "OIDC_AUDIENCE",
    ):
        monkeypatch.delenv(var, raising=False)


# ---------------------------------------------------------------------------
# Resolver-layer tests (this is where the Kevin bug lives)
# ---------------------------------------------------------------------------


def test_kc_base_url_unset_defaults_to_localhost_trap(_clear_kc_env) -> None:
    """``KEYCLOAK_URL`` unset → ``http://localhost:7080``.

    Pinning this default is intentional: it documents the trap that bites
    deployments where the chart forgets to plumb ``KEYCLOAK_URL`` into the
    dynamic-agents pod. Anyone changing the default must also update the
    chart wiring (see ``tests/test_dynamic_agents_chart_keycloak_env.py``).
    """
    assert jwks_validate._kc_base_url() == "http://localhost:7080"


def test_kc_base_url_strips_trailing_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080/")
    assert jwks_validate._kc_base_url() == "http://caipe-keycloak:8080"


def test_kc_realm_defaults_to_caipe(_clear_kc_env) -> None:
    assert jwks_validate._kc_realm() == "caipe"


def test_kc_issuer_explicit_oidc_issuer_wins(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """``OIDC_ISSUER`` set → returned verbatim, NOT derived from KEYCLOAK_URL.

    This is the only configuration that lets in-cluster JWKS fetch
    (``KEYCLOAK_URL=http://caipe-keycloak:8080``) coexist with the
    browser-facing ``iss`` claim baked in by Keycloak's ``KC_HOSTNAME``.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("OIDC_ISSUER", "https://idp.public.example.com/realms/caipe")
    assert jwks_validate._kc_issuer() == "https://idp.public.example.com/realms/caipe"


def test_kc_issuer_keycloak_issuer_legacy_env(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """Legacy ``KEYCLOAK_ISSUER`` is still honoured when ``OIDC_ISSUER`` is unset."""
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_ISSUER", "https://idp.legacy.example.com/realms/caipe")
    assert jwks_validate._kc_issuer() == "https://idp.legacy.example.com/realms/caipe"


def test_kc_issuer_derived_from_keycloak_url_when_no_explicit(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """``OIDC_ISSUER`` unset → derived from ``KEYCLOAK_URL``.

    This is fine when KEYCLOAK_URL is browser-facing too (dev compose), but
    breaks the moment the cluster splits the in-network service URL from the
    public issuer — see ``test_token_with_public_issuer_fails_without_oidc_issuer``.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_REALM", "caipe")
    assert jwks_validate._kc_issuer() == "http://caipe-keycloak:8080/realms/caipe"


def test_kc_issuer_strips_trailing_slash(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    monkeypatch.setenv("OIDC_ISSUER", "https://idp.public.example.com/realms/caipe/")
    assert jwks_validate._kc_issuer() == "https://idp.public.example.com/realms/caipe"


def test_kc_jwks_uri_derived_from_keycloak_url(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """JWKS URI MUST be the in-cluster URL (so the server-to-server fetch
    actually works), not the browser-facing issuer. That's the whole reason
    the resolver picks ``KEYCLOAK_URL`` not ``OIDC_ISSUER`` here.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("OIDC_ISSUER", "https://idp.public.example.com/realms/caipe")
    assert (
        jwks_validate._kc_jwks_uri()
        == "http://caipe-keycloak:8080/realms/caipe/protocol/openid-connect/certs"
    )


def test_kc_jwks_uri_explicit_override_wins(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """``KEYCLOAK_JWKS_URL`` overrides the derived path."""
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_JWKS_URL", "http://kc-internal.example/realms/caipe/protocol/openid-connect/certs")
    assert (
        jwks_validate._kc_jwks_uri()
        == "http://kc-internal.example/realms/caipe/protocol/openid-connect/certs"
    )


def test_kc_jwks_uri_oidc_jwks_url_alias(monkeypatch: pytest.MonkeyPatch, _clear_kc_env) -> None:
    """``OIDC_JWKS_URL`` is the alternate spelling and also wins over the derived path."""
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("OIDC_JWKS_URL", "http://kc-alt.example/realms/caipe/protocol/openid-connect/certs")
    assert (
        jwks_validate._kc_jwks_uri()
        == "http://kc-alt.example/realms/caipe/protocol/openid-connect/certs"
    )


# ---------------------------------------------------------------------------
# End-to-end validator tests — exercising the resolver via validate_bearer_jwt
# ---------------------------------------------------------------------------


def test_token_with_public_issuer_validates_when_oidc_issuer_is_set(
    patch_jwks,
    keypair: _Keypair,
    monkeypatch: pytest.MonkeyPatch,
    _clear_kc_env,
) -> None:
    """Kevin's prod topology: public issuer ≠ in-cluster KEYCLOAK_URL,
    but ``OIDC_ISSUER`` is configured → token passes validation.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("OIDC_ISSUER", "https://idp.public.example.com/realms/caipe")
    monkeypatch.setenv("KEYCLOAK_AUDIENCE", "caipe-platform")

    token = _mint(
        keypair,
        issuer="https://idp.public.example.com/realms/caipe",
        audience="caipe-platform",
    )

    claims = jwks_validate.validate_bearer_jwt(token)
    assert claims["sub"] == "test-user"
    assert claims["iss"] == "https://idp.public.example.com/realms/caipe"


def test_token_with_public_issuer_fails_without_oidc_issuer(
    patch_jwks,
    keypair: _Keypair,
    monkeypatch: pytest.MonkeyPatch,
    _clear_kc_env,
) -> None:
    """Kevin's failure mode: token carries ``iss=https://idp.public/...``
    but ``OIDC_ISSUER`` is unset so the validator derives the issuer from
    the (in-cluster) ``KEYCLOAK_URL`` and rejects the mismatch.

    PyJWT raises ``InvalidIssuerError`` (subclass of ``InvalidTokenError``).
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://caipe-keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_AUDIENCE", "caipe-platform")
    # OIDC_ISSUER intentionally NOT set.

    token = _mint(
        keypair,
        issuer="https://idp.public.example.com/realms/caipe",
        audience="caipe-platform",
    )

    with pytest.raises(jwks_validate.InvalidTokenError):
        jwks_validate.validate_bearer_jwt(token)


def test_audience_list_accepts_either_aud(
    patch_jwks,
    keypair: _Keypair,
    monkeypatch: pytest.MonkeyPatch,
    _clear_kc_env,
) -> None:
    """Default audience list is ``caipe-platform,agentgateway`` — a token
    carrying either ``aud`` value should pass. This is the spec-104 hot
    path where Slack-bot OBO mints ``aud=agentgateway`` and UI flows mint
    ``aud=caipe-platform``; the dynamic-agents service sits in front of
    both and accepts either.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://kc.example:7080")
    monkeypatch.setenv("OIDC_ISSUER", "http://kc.example:7080/realms/caipe")
    # KEYCLOAK_AUDIENCE intentionally unset → in-code default applies.

    token_agentgateway = _mint(
        keypair,
        issuer="http://kc.example:7080/realms/caipe",
        audience="agentgateway",
    )
    token_platform = _mint(
        keypair,
        issuer="http://kc.example:7080/realms/caipe",
        audience="caipe-platform",
    )

    assert jwks_validate.validate_bearer_jwt(token_agentgateway)["aud"] == "agentgateway"
    assert jwks_validate.validate_bearer_jwt(token_platform)["aud"] == "caipe-platform"


def test_empty_audience_disables_aud_check(
    patch_jwks,
    keypair: _Keypair,
    monkeypatch: pytest.MonkeyPatch,
    _clear_kc_env,
) -> None:
    """Empty / comma-only ``KEYCLOAK_AUDIENCE`` disables the audience check.

    Dev escape hatch only — production should always pin an audience list.
    """
    monkeypatch.setenv("KEYCLOAK_URL", "http://kc.example:7080")
    monkeypatch.setenv("OIDC_ISSUER", "http://kc.example:7080/realms/caipe")
    monkeypatch.setenv("KEYCLOAK_AUDIENCE", "  ,  ,  ")

    token = _mint(
        keypair,
        issuer="http://kc.example:7080/realms/caipe",
        audience="some-other-aud",
    )

    claims = jwks_validate.validate_bearer_jwt(token)
    assert claims["aud"] == "some-other-aud"

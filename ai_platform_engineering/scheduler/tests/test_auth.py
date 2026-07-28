import pytest
from fastapi import HTTPException

from caipe_scheduler import auth
from caipe_scheduler.app import require_caller_identity, require_service_token
from caipe_scheduler.config import Settings


def test_service_token_auth_fails_closed_when_unconfigured():
  with pytest.raises(HTTPException) as exc_info:
    require_service_token(
      x_scheduler_token=None,
      settings=Settings(service_token=""),
    )

  assert exc_info.value.status_code == 503


def test_service_token_auth_rejects_wrong_token():
  with pytest.raises(HTTPException) as exc_info:
    require_service_token(
      x_scheduler_token="wrong",
      settings=Settings(service_token="expected"),
    )

  assert exc_info.value.status_code == 401


def test_service_token_auth_accepts_exact_token():
  assert (
    require_service_token(
      x_scheduler_token="expected",
      settings=Settings(service_token="expected"),
    )
    is None
  )


def _jwt_settings() -> Settings:
  return Settings(
    jwt_jwks_url="https://issuer.example/jwks",
    jwt_issuer="https://issuer.example",
    jwt_audiences=("caipe-platform",),
  )


def test_caller_auth_fails_closed_when_unconfigured():
  with pytest.raises(HTTPException) as exc_info:
    require_caller_identity(
      authorization="Bearer token",
      settings=Settings(jwt_jwks_url="", jwt_issuer=""),
    )

  assert exc_info.value.status_code == 503


def test_caller_auth_rejects_missing_bearer():
  with pytest.raises(HTTPException) as exc_info:
    require_caller_identity(authorization=None, settings=_jwt_settings())

  assert exc_info.value.status_code == 401


def test_caller_auth_reports_jwks_connection_failure(monkeypatch):
  class _JwksClient:
    def get_signing_key_from_jwt(self, _token):
      raise auth.jwt.PyJWKClientConnectionError("JWKS unavailable")

  monkeypatch.setattr(auth, "_jwks_client", lambda _url: _JwksClient())

  with pytest.raises(HTTPException) as exc_info:
    require_caller_identity(
      authorization="Bearer caller-token",
      settings=_jwt_settings(),
    )

  assert exc_info.value.status_code == 503


def test_caller_auth_derives_subject_and_normalized_email(monkeypatch):
  class _SigningKey:
    key = "public-key"

  class _JwksClient:
    def get_signing_key_from_jwt(self, token):
      assert token == "caller-token"
      return _SigningKey()

  monkeypatch.setattr(auth, "_jwks_client", lambda _url: _JwksClient())
  monkeypatch.setattr(
    auth.jwt,
    "decode",
    lambda *_args, **_kwargs: {
      "sub": "keycloak-user-id",
      "email": "Owner@Example.com",
    },
  )

  caller = require_caller_identity(
    authorization="Bearer caller-token",
    settings=_jwt_settings(),
  )

  assert caller.sub == "keycloak-user-id"
  assert caller.email == "owner@example.com"

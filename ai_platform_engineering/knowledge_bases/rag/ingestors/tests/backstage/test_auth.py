"""
Proposed test file for the BACKSTAGE_AUTH_MODE changes.

Add this file to the upstream repo at:
  ai_platform_engineering/knowledge_bases/rag/ingestors/tests/backstage/test_auth.py

Also create an empty __init__.py:
  ai_platform_engineering/knowledge_bases/rag/ingestors/tests/backstage/__init__.py

Run with:
  cd ai_platform_engineering/knowledge_bases/rag/ingestors
  uv run pytest tests/backstage/ -v
"""

from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers — patch module-level state without reimporting the module.
# The ingestor has top-level validation that runs at import time, so we
# patch os.environ before importing and use importlib.reload() between tests
# that need different env configurations.
# ---------------------------------------------------------------------------

BASE_ENV = {
    "BACKSTAGE_URL": "http://backstage.example.svc.cluster.local:7007",
    "BACKSTAGE_API_TOKEN": "test-static-token",
    "BACKSTAGE_AUTH_MODE": "static",
}

OAUTH2_ENV = {
    "BACKSTAGE_URL": "http://backstage.example.svc.cluster.local:7007",
    "BACKSTAGE_AUTH_MODE": "oauth2",
    "BACKSTAGE_OIDC_TOKEN_URL": "https://keycloak.example.com/realms/test/protocol/openid-connect/token",
    "BACKSTAGE_OIDC_CLIENT_ID": "rag-ingestor",
    "BACKSTAGE_OIDC_CLIENT_SECRET": "test-client-secret",
    "BACKSTAGE_OIDC_SCOPES": "openid",
}


def _load_ingestor(env: dict):
    """Import (or reload) the ingestor module with a given environment."""
    import importlib
    import os
    with patch.dict(os.environ, env, clear=True):
        import ingestors.backstage.ingestor as mod
        importlib.reload(mod)
    return mod


# ---------------------------------------------------------------------------
# get_auth_headers — static mode
# ---------------------------------------------------------------------------

class TestGetAuthHeadersStatic:

    def test_returns_bearer_token(self):
        mod = _load_ingestor(BASE_ENV)
        with patch.dict("os.environ", BASE_ENV, clear=True):
            # Patch module-level variables as reloaded
            mod.BACKSTAGE_AUTH_MODE = "static"
            mod.BACKSTAGE_API_TOKEN = "test-static-token"
            headers = mod.get_auth_headers()
        assert headers == {"Authorization": "Bearer test-static-token"}

    def test_token_value_is_used_verbatim(self):
        mod = _load_ingestor(BASE_ENV)
        mod.BACKSTAGE_AUTH_MODE = "static"
        mod.BACKSTAGE_API_TOKEN = "some-hex-value-abc123"
        headers = mod.get_auth_headers()
        assert headers["Authorization"] == "Bearer some-hex-value-abc123"


# ---------------------------------------------------------------------------
# get_auth_headers — oauth2 mode
# ---------------------------------------------------------------------------

class TestGetAuthHeadersOAuth2:

    def test_calls_get_oauth2_token(self):
        mod = _load_ingestor(OAUTH2_ENV)
        mod.BACKSTAGE_AUTH_MODE = "oauth2"
        with patch.object(mod, "_get_oauth2_token", return_value="jwt-from-keycloak") as mock_token:
            headers = mod.get_auth_headers()
        mock_token.assert_called_once()
        assert headers == {"Authorization": "Bearer jwt-from-keycloak"}

    def test_unknown_mode_raises(self):
        mod = _load_ingestor(BASE_ENV)
        mod.BACKSTAGE_AUTH_MODE = "ldap"
        with pytest.raises(ValueError, match="Unknown BACKSTAGE_AUTH_MODE"):
            mod.get_auth_headers()


# ---------------------------------------------------------------------------
# _get_oauth2_token — token fetch and caching
# ---------------------------------------------------------------------------

class TestGetOAuth2Token:

    def _make_token_response(self, access_token: str = "jwt-access-token", expires_in: int = 300):
        resp = MagicMock()
        resp.json.return_value = {"access_token": access_token, "expires_in": expires_in}
        resp.raise_for_status = MagicMock()
        return resp

    def test_fetches_token_on_first_call(self):
        mod = _load_ingestor(OAUTH2_ENV)
        # Clear any cached state
        mod._oauth2_token_cache["token"] = None
        mod._oauth2_token_cache["expires_at"] = 0.0

        mock_resp = self._make_token_response("fresh-jwt", expires_in=300)
        with patch("requests.post", return_value=mock_resp) as mock_post:
            token = mod._get_oauth2_token()

        assert token == "fresh-jwt"
        mock_post.assert_called_once_with(
            OAUTH2_ENV["BACKSTAGE_OIDC_TOKEN_URL"],
            data={
                "grant_type":    "client_credentials",
                "client_id":     "rag-ingestor",
                "client_secret": "test-client-secret",
                "scope":         "openid",
            },
            timeout=10,
        )

    def test_returns_cached_token_if_not_expired(self):
        mod = _load_ingestor(OAUTH2_ENV)
        mod._oauth2_token_cache["token"] = "cached-jwt"
        mod._oauth2_token_cache["expires_at"] = time.time() + 120  # valid for 2 more minutes

        with patch("requests.post") as mock_post:
            token = mod._get_oauth2_token()

        assert token == "cached-jwt"
        mock_post.assert_not_called()

    def test_refreshes_token_when_near_expiry(self):
        """Token with < 60s remaining should trigger a refresh."""
        mod = _load_ingestor(OAUTH2_ENV)
        mod._oauth2_token_cache["token"] = "old-jwt"
        mod._oauth2_token_cache["expires_at"] = time.time() + 30  # only 30s left

        mock_resp = self._make_token_response("new-jwt", expires_in=300)
        with patch("requests.post", return_value=mock_resp):
            token = mod._get_oauth2_token()

        assert token == "new-jwt"

    def test_refreshes_token_when_expired(self):
        mod = _load_ingestor(OAUTH2_ENV)
        mod._oauth2_token_cache["token"] = "expired-jwt"
        mod._oauth2_token_cache["expires_at"] = time.time() - 10  # already expired

        mock_resp = self._make_token_response("refreshed-jwt", expires_in=300)
        with patch("requests.post", return_value=mock_resp):
            token = mod._get_oauth2_token()

        assert token == "refreshed-jwt"

    def test_updates_cache_after_fetch(self):
        mod = _load_ingestor(OAUTH2_ENV)
        mod._oauth2_token_cache["token"] = None
        mod._oauth2_token_cache["expires_at"] = 0.0

        mock_resp = self._make_token_response("new-jwt", expires_in=600)
        with patch("requests.post", return_value=mock_resp):
            mod._get_oauth2_token()

        assert mod._oauth2_token_cache["token"] == "new-jwt"
        assert mod._oauth2_token_cache["expires_at"] > time.time() + 500


# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------

class TestStartupValidation:

    def test_static_mode_missing_api_token_raises(self):
        env = {"BACKSTAGE_URL": "http://backstage.example:7007", "BACKSTAGE_AUTH_MODE": "static"}
        with pytest.raises(ValueError, match="BACKSTAGE_API_TOKEN"):
            _load_ingestor(env)

    def test_oauth2_mode_missing_token_url_raises(self):
        env = {
            "BACKSTAGE_URL": "http://backstage.example:7007",
            "BACKSTAGE_AUTH_MODE": "oauth2",
            "BACKSTAGE_OIDC_CLIENT_ID": "rag-ingestor",
            "BACKSTAGE_OIDC_CLIENT_SECRET": "secret",
        }
        with pytest.raises(ValueError, match="BACKSTAGE_OIDC_TOKEN_URL"):
            _load_ingestor(env)

    def test_oauth2_mode_missing_client_id_raises(self):
        env = {
            "BACKSTAGE_URL": "http://backstage.example:7007",
            "BACKSTAGE_AUTH_MODE": "oauth2",
            "BACKSTAGE_OIDC_TOKEN_URL": "https://keycloak.example.com/token",
            "BACKSTAGE_OIDC_CLIENT_SECRET": "secret",
        }
        with pytest.raises(ValueError, match="BACKSTAGE_OIDC_CLIENT_ID"):
            _load_ingestor(env)

    def test_oauth2_mode_missing_client_secret_raises(self):
        env = {
            "BACKSTAGE_URL": "http://backstage.example:7007",
            "BACKSTAGE_AUTH_MODE": "oauth2",
            "BACKSTAGE_OIDC_TOKEN_URL": "https://keycloak.example.com/token",
            "BACKSTAGE_OIDC_CLIENT_ID": "rag-ingestor",
        }
        with pytest.raises(ValueError, match="BACKSTAGE_OIDC_CLIENT_SECRET"):
            _load_ingestor(env)

    def test_unknown_mode_raises(self):
        env = {"BACKSTAGE_URL": "http://backstage.example:7007", "BACKSTAGE_AUTH_MODE": "magic"}
        with pytest.raises(ValueError, match="Unknown BACKSTAGE_AUTH_MODE"):
            _load_ingestor(env)

    def test_missing_backstage_url_raises(self):
        env = {"BACKSTAGE_AUTH_MODE": "static", "BACKSTAGE_API_TOKEN": "token"}
        with pytest.raises(ValueError, match="BACKSTAGE_URL"):
            _load_ingestor(env)


# ---------------------------------------------------------------------------
# fetch_backstage_entities — uses get_auth_headers()
# ---------------------------------------------------------------------------

class TestFetchBackstageEntities:

    def test_uses_get_auth_headers(self):
        """fetch_backstage_entities must call get_auth_headers, not read
        BACKSTAGE_API_TOKEN directly."""
        mod = _load_ingestor(BASE_ENV)
        mod.BACKSTAGE_AUTH_MODE = "static"
        mod.BACKSTAGE_API_TOKEN = "static-token"

        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = {"items": [{"kind": "Component"}], "pageInfo": {}}

        with patch("requests.get", return_value=mock_resp) as mock_get:
            result = mod.fetch_backstage_entities()

        call_kwargs = mock_get.call_args
        assert call_kwargs[1]["headers"] == {"Authorization": "Bearer static-token"}
        assert len(result) == 1

    def test_paginates_until_no_cursor(self):
        mod = _load_ingestor(BASE_ENV)
        mod.BACKSTAGE_AUTH_MODE = "static"
        mod.BACKSTAGE_API_TOKEN = "token"

        page1 = MagicMock()
        page1.raise_for_status = MagicMock()
        page1.json.return_value = {
            "items": [{"kind": "Component"}, {"kind": "System"}],
            "pageInfo": {"nextCursor": "cursor-abc"},
        }
        page2 = MagicMock()
        page2.raise_for_status = MagicMock()
        page2.json.return_value = {
            "items": [{"kind": "Group"}],
            "pageInfo": {},
        }

        with patch("requests.get", side_effect=[page1, page2]):
            result = mod.fetch_backstage_entities()

        assert len(result) == 3

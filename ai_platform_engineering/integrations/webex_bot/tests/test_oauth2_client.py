"""Unit tests for OAuth2 client credentials."""

import os
from unittest.mock import MagicMock, patch

import pytest

from oauth2_client import OAuth2ClientCredentials


class TestOAuth2FromEnv:
    """Tests for OAuth2ClientCredentials.from_env()."""

    def test_from_env_reads_webex_integration_auth_vars(self):
        with patch.dict(
            os.environ,
            {
                "WEBEX_INTEGRATION_AUTH_TOKEN_URL": "https://auth.example.com/token",
                "WEBEX_INTEGRATION_AUTH_CLIENT_ID": "client_id",
                "WEBEX_INTEGRATION_AUTH_CLIENT_SECRET": "secret",
            },
            clear=False,
        ):
            client = OAuth2ClientCredentials.from_env()
            assert client.token_url == "https://auth.example.com/token"
            assert client.client_id == "client_id"
            assert client.client_secret == "secret"

    def test_from_env_falls_back_to_oauth2_vars(self):
        with patch.dict(
            os.environ,
            {
                "OAUTH2_TOKEN_URL": "https://oauth.example.com/token",
                "OAUTH2_CLIENT_ID": "oauth_client",
                "OAUTH2_CLIENT_SECRET": "oauth_secret",
            },
            clear=False,
        ):
            # Clear any WEBEX_* vars that might override
            for key in list(os.environ.keys()):
                if key.startswith("WEBEX_INTEGRATION_AUTH_"):
                    del os.environ[key]
            client = OAuth2ClientCredentials.from_env()
            assert client.token_url == "https://oauth.example.com/token"
            assert client.client_id == "oauth_client"
            assert client.client_secret == "oauth_secret"

    def test_from_env_webex_takes_precedence_over_oauth2(self):
        with patch.dict(
            os.environ,
            {
                "WEBEX_INTEGRATION_AUTH_TOKEN_URL": "https://webex.auth/token",
                "WEBEX_INTEGRATION_AUTH_CLIENT_ID": "webex_id",
                "WEBEX_INTEGRATION_AUTH_CLIENT_SECRET": "webex_secret",
                "OAUTH2_TOKEN_URL": "https://oauth.auth/token",
                "OAUTH2_CLIENT_ID": "oauth_id",
                "OAUTH2_CLIENT_SECRET": "oauth_secret",
            },
            clear=False,
        ):
            client = OAuth2ClientCredentials.from_env()
            assert client.token_url == "https://webex.auth/token"
            assert client.client_id == "webex_id"

    def test_from_env_raises_on_missing_required_vars(self):
        env_backup = {k: v for k, v in os.environ.items()}
        for key in list(os.environ.keys()):
            if "OAUTH2" in key or "WEBEX_INTEGRATION_AUTH" in key:
                del os.environ[key]

        try:
            with pytest.raises(RuntimeError) as exc_info:
                OAuth2ClientCredentials.from_env()

            assert "Missing required" in str(exc_info.value)
        finally:
            os.environ.clear()
            os.environ.update(env_backup)


class TestOAuth2GetAccessToken:
    """Tests for get_access_token() caching."""

    @patch("oauth2_client.requests.post")
    def test_get_access_token_caching_behavior(self, mock_post):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "token-1", "expires_in": 3600},
        )

        client = OAuth2ClientCredentials(
            token_url="https://auth.example.com/token",
            client_id="cid",
            client_secret="secret",
        )

        token1 = client.get_access_token()
        token2 = client.get_access_token()

        assert token1 == token2 == "token-1"
        # Should only fetch once (cached)
        assert mock_post.call_count == 1

    @patch("oauth2_client.requests.post")
    def test_clear_cache_forces_refetch(self, mock_post):
        mock_post.return_value = MagicMock(
            ok=True,
            json=lambda: {"access_token": "token-1", "expires_in": 3600},
        )

        client = OAuth2ClientCredentials(
            token_url="https://auth.example.com/token",
            client_id="cid",
            client_secret="secret",
        )

        client.get_access_token()
        client.clear_cache()
        client.get_access_token()

        assert mock_post.call_count == 2

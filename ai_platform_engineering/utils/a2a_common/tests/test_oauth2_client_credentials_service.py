# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for OAuth2ClientCredentialsService.

Focuses on:
  - SCHEME_NAME filter (returns None for non-matching scheme)
  - Token caching + 80%-of-TTL soft refresh
  - Stale-on-error (refresh failure but unexpired token continues serving)
  - Hard-fail when refresh fails AND no usable token
  - Opaque-token (non-JWT) fallback to default TTL
  - Client secret scrubbed from exception text
  - Plaintext TOKEN_ENDPOINT warning on non-loopback host
"""

import os
import time
import types
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Stub jwt before module import so we can drive `jwt.decode` deterministically.
import sys
if "jwt" not in sys.modules:
    fake_jwt = types.ModuleType("jwt")
    fake_jwt.decode = MagicMock(return_value={})
    fake_jwt.PyJWTError = Exception
    sys.modules["jwt"] = fake_jwt

from ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service import (  # noqa: E402
    OAuth2ClientCredentialsService,
    _scrub_secret,
    _validate_token_endpoint_scheme,
)


_MIN_ENV = {
    "OAUTH2_CLIENT_ID": "supervisor",
    "OAUTH2_CLIENT_SECRET": "topsecret",
    "TOKEN_ENDPOINT": "https://idp.example/token",
}


def _make_response(token="abc.def.ghi", exp_in=300):
    """Build a fake httpx.Response."""
    resp = MagicMock()
    resp.json.return_value = {"access_token": token}
    resp.raise_for_status.return_value = None
    return resp


class TestSchemeFilter(unittest.IsolatedAsyncioTestCase):
    async def test_returns_none_for_non_matching_scheme(self):
        svc = OAuth2ClientCredentialsService()
        result = await svc.get_credentials("api_key", context=None)
        self.assertIsNone(result)


class TestRefreshAndCache(unittest.IsolatedAsyncioTestCase):
    @patch.dict(os.environ, _MIN_ENV, clear=False)
    async def test_first_call_mints_and_caches(self):
        svc = OAuth2ClientCredentialsService()
        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.return_value = _make_response("tok-1", exp_in=600)
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            with patch(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.jwt.decode",
                return_value={"exp": time.time() + 600},
            ):
                tok = await svc.get_credentials("oauth2", context=None)
        self.assertEqual(tok, "tok-1")
        self.assertEqual(fake_client.post.call_count, 1)

    @patch.dict(os.environ, _MIN_ENV, clear=False)
    async def test_second_call_within_ttl_does_not_remint(self):
        svc = OAuth2ClientCredentialsService()
        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.return_value = _make_response("tok-1")
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            with patch(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.jwt.decode",
                return_value={"exp": time.time() + 3600},
            ):
                tok1 = await svc.get_credentials("oauth2", context=None)
                tok2 = await svc.get_credentials("oauth2", context=None)
        self.assertEqual(tok1, tok2)
        self.assertEqual(fake_client.post.call_count, 1)


class TestStaleOnError(unittest.IsolatedAsyncioTestCase):
    @patch.dict(os.environ, _MIN_ENV, clear=False)
    async def test_refresh_failure_serves_stale_token_until_exp(self):
        svc = OAuth2ClientCredentialsService()

        # 1st call: mint successfully, exp = now + 600
        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.return_value = _make_response("tok-stale")
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            with patch(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.jwt.decode",
                return_value={"exp": time.time() + 600},
            ):
                first = await svc.get_credentials("oauth2", context=None)
        self.assertEqual(first, "tok-stale")

        # Force refresh window: set refresh_after to past, but token still
        # valid for ~600s. Next call attempts refresh; we make it fail.
        svc._refresh_after = 0.0
        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.side_effect = RuntimeError("transient IdP outage")
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            stale = await svc.get_credentials("oauth2", context=None)
        self.assertEqual(stale, "tok-stale", "stale token should be served on refresh failure")

    @patch.dict(os.environ, _MIN_ENV, clear=False)
    async def test_refresh_failure_with_no_usable_token_raises(self):
        svc = OAuth2ClientCredentialsService()
        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.side_effect = RuntimeError("IdP down")
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            with self.assertRaises(RuntimeError):
                await svc.get_credentials("oauth2", context=None)


class TestOpaqueTokenFallback(unittest.IsolatedAsyncioTestCase):
    @patch.dict(os.environ, _MIN_ENV, clear=False)
    async def test_opaque_token_uses_default_ttl(self):
        """If `jwt.decode` raises (token isn't a JWT), use conservative default TTL."""
        from ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service import (
            _DEFAULT_OPAQUE_TOKEN_TTL,
        )
        svc = OAuth2ClientCredentialsService()

        class _FakePyJWTError(Exception):
            pass

        with patch(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.httpx.AsyncClient"
        ) as fake_client_cls:
            fake_client = AsyncMock()
            fake_client.post.return_value = _make_response("opaque-token-xyz")
            fake_client_cls.return_value.__aenter__.return_value = fake_client
            with patch(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.jwt.decode",
                side_effect=_FakePyJWTError("not a jwt"),
            ), patch(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service.jwt.PyJWTError",
                _FakePyJWTError,
            ):
                start = time.time()
                tok = await svc.get_credentials("oauth2", context=None)
        self.assertEqual(tok, "opaque-token-xyz")
        # exp should be approximately start + _DEFAULT_OPAQUE_TOKEN_TTL
        self.assertAlmostEqual(
            svc._token_exp, start + _DEFAULT_OPAQUE_TOKEN_TTL, delta=2.0
        )


class TestSecretScrubbing(unittest.TestCase):
    def test_scrub_redacts_secret_in_text(self):
        text = "Bad request: invalid_client_secret=topsecret"
        scrubbed = _scrub_secret(text, "topsecret")
        self.assertNotIn("topsecret", scrubbed)
        self.assertIn("***REDACTED***", scrubbed)

    def test_scrub_no_match_returns_unchanged(self):
        self.assertEqual(_scrub_secret("hello world", "topsecret"), "hello world")

    def test_scrub_empty_secret_returns_unchanged(self):
        self.assertEqual(_scrub_secret("anything", ""), "anything")


class TestTokenEndpointSchemeValidation(unittest.TestCase):
    def setUp(self):
        # Reset the module-level _TOKEN_ENDPOINT_VALIDATED guard so each
        # test sees the warning path freshly.
        import ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service as mod
        mod._TOKEN_ENDPOINT_VALIDATED = False

    def test_https_endpoint_no_warning(self):
        with self.assertLogs(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service",
            level="WARNING",
        ) as logs:
            _validate_token_endpoint_scheme("https://idp.example/token")
            # Trigger a no-op log so assertLogs has something to inspect
            import logging
            logging.getLogger(
                "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service"
            ).warning("sentinel")
        # Only the sentinel should appear; no plaintext warning
        self.assertEqual(len(logs.records), 1)
        self.assertEqual(logs.records[0].message, "sentinel")

    def test_http_loopback_logs_info_not_warning(self):
        with self.assertLogs(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service",
            level="INFO",
        ) as logs:
            _validate_token_endpoint_scheme("http://localhost:8080/token")
        levels = [r.levelname for r in logs.records]
        self.assertIn("INFO", levels)
        self.assertNotIn("WARNING", levels)

    def test_http_non_loopback_warns(self):
        with self.assertLogs(
            "ai_platform_engineering.utils.a2a_common.oauth2_client_credentials_service",
            level="WARNING",
        ) as logs:
            _validate_token_endpoint_scheme("http://idp.example/token")
        self.assertTrue(any(r.levelname == "WARNING" for r in logs.records))


if __name__ == "__main__":
    unittest.main()

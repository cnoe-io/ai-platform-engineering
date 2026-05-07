# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""Tests for oauth2_middleware.verify_token client-identity claim handling.

Focuses on the OAUTH2_REQUIRE_CLIENT_CLAIM behavior and the azp/client_id/cid
allowlist matching. The module reads env at import time, so each test class
sets up its env BEFORE the module loads (or reloads).
"""

import importlib
import os
import sys
import unittest
from unittest.mock import patch


_OAUTH2_ENV = {
    "A2A_AUTH_OAUTH2": "true",
    "JWKS_URI": "https://idp.example/jwks",
    "AUDIENCE": "myagent",
    "ISSUER": "https://idp.example/realms/test",
    "OAUTH2_CLIENT_ID": "supervisor,backup-supervisor",
}


def _load_middleware(extra_env=None):
    """Import (or reimport) the middleware module under controlled env."""
    env = {**_OAUTH2_ENV, **(extra_env or {})}
    # Stub JwksCache so import doesn't try to fetch real JWKS.
    sys.modules.pop(
        "ai_platform_engineering.utils.auth.oauth2_middleware", None
    )
    with patch.dict(os.environ, env, clear=False), patch(
        "ai_platform_engineering.utils.auth.jwks_cache.JwksCache.__init__",
        return_value=None,
    ):
        return importlib.import_module(
            "ai_platform_engineering.utils.auth.oauth2_middleware"
        )


def _verify_with_payload(mod, payload):
    """Run verify_token with all jwt decoding stages mocked to a controlled payload."""
    with patch.object(mod.jwt, "get_unverified_header", return_value={"kid": "k1"}), \
         patch.object(mod._jwks_cache, "get_jwk", return_value={"kty": "RSA"}), \
         patch.object(mod, "_public_key_from_jwk", return_value="fake_pubkey"), \
         patch.object(mod.jwt, "decode", return_value=payload):
        return mod.verify_token("not.a.real.token")


class TestVerifyTokenClientClaim(unittest.TestCase):
    """Allowlist + claim-name matrix with default REQUIRE_CLIENT_CLAIM=false."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_middleware()

    def test_azp_in_allowlist_accepted(self):
        self.assertTrue(_verify_with_payload(self.mod, {"azp": "supervisor"}))

    def test_client_id_in_allowlist_accepted(self):
        self.assertTrue(_verify_with_payload(self.mod, {"client_id": "supervisor"}))

    def test_cid_in_allowlist_accepted(self):
        self.assertTrue(_verify_with_payload(self.mod, {"cid": "supervisor"}))

    def test_azp_not_in_allowlist_rejected(self):
        self.assertFalse(_verify_with_payload(self.mod, {"azp": "intruder"}))

    def test_client_id_not_in_allowlist_rejected(self):
        self.assertFalse(_verify_with_payload(self.mod, {"client_id": "intruder"}))

    def test_azp_takes_precedence_over_client_id(self):
        # azp is in allowlist; client_id is not → still accepted (azp wins)
        self.assertTrue(
            _verify_with_payload(
                self.mod, {"azp": "supervisor", "client_id": "intruder"}
            )
        )

    def test_missing_claim_accepted_in_permissive_default(self):
        """Default REQUIRE_CLIENT_CLAIM=false preserves legacy behavior."""
        self.assertTrue(_verify_with_payload(self.mod, {"sub": "user@example"}))


class TestVerifyTokenStrictMode(unittest.TestCase):
    """OAUTH2_REQUIRE_CLIENT_CLAIM=true rejects tokens without the claim."""

    @classmethod
    def setUpClass(cls):
        cls.mod = _load_middleware({"OAUTH2_REQUIRE_CLIENT_CLAIM": "true"})

    def test_missing_claim_rejected_in_strict_mode(self):
        self.assertFalse(_verify_with_payload(self.mod, {"sub": "user@example"}))

    def test_azp_in_allowlist_still_accepted_in_strict_mode(self):
        self.assertTrue(_verify_with_payload(self.mod, {"azp": "supervisor"}))

    def test_unknown_azp_rejected_in_strict_mode(self):
        self.assertFalse(_verify_with_payload(self.mod, {"azp": "intruder"}))


if __name__ == "__main__":
    unittest.main()

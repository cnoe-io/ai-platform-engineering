"""Unit tests for dynamic_agents.auth.auth module.

Covers:
- extract_email_from_claims: fallback chain (email → preferred_username → upn → sub)
- extract_name_from_claims: standard OIDC, Duo/Keycloak, combined given/family name
- extract_groups_from_claims: configured claim, auto-detect, comma-separated values,
  list values, deduplication
- check_admin_role: configured group exact match, case-insensitive, DN format,
  fallback pattern matching when no group configured
- get_current_user (FastAPI dependency):
  - auth disabled → returns dev user unconditionally
  - missing Authorization header → 401
  - malformed Authorization header → 401
  - valid token, user in OIDC_REQUIRED_GROUP → passes group check
  - valid token, user NOT in OIDC_REQUIRED_GROUP → 403
  - DN-format group matched case-insensitively
  - OIDC_REQUIRED_GROUP not set → no group gate (falls through to admin check)
  - userinfo endpoint available → groups from userinfo take precedence
  - userinfo endpoint unavailable → falls back to access token claims
  - admin group membership → is_admin=True in returned UserContext
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from dynamic_agents.auth.auth import (
    check_admin_role,
    extract_email_from_claims,
    extract_groups_from_claims,
    extract_name_from_claims,
    get_current_user,
)
from dynamic_agents.config import Settings
from dynamic_agents.models import UserContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_settings(**kwargs) -> Settings:
    """Build a Settings instance with auth enabled by default."""
    defaults = {
        "auth_enabled": True,
        "oidc_issuer": "https://oidc.example.com",
        "oidc_client_id": "test-client",
    }
    defaults.update(kwargs)
    return Settings.model_validate(defaults)


def make_request(headers: dict | None = None):
    """Return a mock FastAPI Request with the given headers."""
    req = MagicMock()
    req.headers = headers or {}
    return req


# ---------------------------------------------------------------------------
# extract_email_from_claims
# ---------------------------------------------------------------------------

class TestExtractEmailFromClaims:
    def test_prefers_email(self):
        claims = {"email": "alice@example.com", "preferred_username": "alice", "sub": "123"}
        assert extract_email_from_claims(claims) == "alice@example.com"

    def test_falls_back_to_preferred_username(self):
        claims = {"preferred_username": "alice", "sub": "123"}
        assert extract_email_from_claims(claims) == "alice"

    def test_falls_back_to_upn(self):
        claims = {"upn": "alice@corp.com", "sub": "123"}
        assert extract_email_from_claims(claims) == "alice@corp.com"

    def test_falls_back_to_sub(self):
        claims = {"sub": "user-abc-123"}
        assert extract_email_from_claims(claims) == "user-abc-123"

    def test_returns_unknown_when_all_missing(self):
        assert extract_email_from_claims({}) == "unknown"

    def test_skips_empty_string(self):
        claims = {"email": "", "preferred_username": "alice"}
        assert extract_email_from_claims(claims) == "alice"


# ---------------------------------------------------------------------------
# extract_name_from_claims
# ---------------------------------------------------------------------------

class TestExtractNameFromClaims:
    def test_standard_oidc_name_claim(self):
        claims = {"name": "Alice Smith"}
        assert extract_name_from_claims(claims) == "Alice Smith"

    def test_keycloak_fullname(self):
        claims = {"fullname": "Alice Smith"}
        assert extract_name_from_claims(claims) == "Alice Smith"

    def test_azure_displayname(self):
        claims = {"displayName": "Alice Smith"}
        assert extract_name_from_claims(claims) == "Alice Smith"

    def test_given_and_family_name(self):
        claims = {"given_name": "Alice", "family_name": "Smith"}
        assert extract_name_from_claims(claims) == "Alice Smith"

    def test_given_name_only(self):
        claims = {"given_name": "Alice"}
        assert extract_name_from_claims(claims) == "Alice"

    def test_duo_firstname_lastname(self):
        claims = {"firstname": "Alice", "lastname": "Smith"}
        assert extract_name_from_claims(claims) == "Alice Smith"

    def test_returns_none_when_no_name_claims(self):
        claims = {"email": "alice@example.com", "sub": "123"}
        assert extract_name_from_claims(claims) is None

    def test_strips_whitespace(self):
        claims = {"name": "  Alice Smith  "}
        assert extract_name_from_claims(claims) == "Alice Smith"


# ---------------------------------------------------------------------------
# extract_groups_from_claims
# ---------------------------------------------------------------------------

class TestExtractGroupsFromClaims:
    def test_extracts_groups_list_from_groups_claim(self):
        settings = make_settings()
        claims = {"groups": ["eng", "backend", "platform"]}
        result = extract_groups_from_claims(claims, settings)
        assert set(result) == {"eng", "backend", "platform"}

    def test_extracts_groups_from_members_claim(self):
        settings = make_settings()
        claims = {"members": ["cn=sre-admin,dc=example,dc=com", "cn=dev,dc=example,dc=com"]}
        result = extract_groups_from_claims(claims, settings)
        assert "cn=sre-admin,dc=example,dc=com" in result

    def test_comma_separated_string_value(self):
        settings = make_settings()
        claims = {"groups": "eng,backend,platform"}
        result = extract_groups_from_claims(claims, settings)
        assert set(result) == {"eng", "backend", "platform"}

    def test_configured_claim_takes_priority(self):
        settings = make_settings(oidc_group_claim="memberOf")
        claims = {"memberOf": ["cn=sre,dc=example"], "groups": ["other-group"]}
        result = extract_groups_from_claims(claims, settings)
        assert "cn=sre,dc=example" in result
        assert "other-group" not in result

    def test_configured_comma_separated_claims(self):
        settings = make_settings(oidc_group_claim="groups,members")
        claims = {"groups": ["eng"], "members": ["cn=platform,dc=example"]}
        result = extract_groups_from_claims(claims, settings)
        assert "eng" in result
        assert "cn=platform,dc=example" in result

    def test_deduplicates_groups(self):
        settings = make_settings()
        claims = {"groups": ["eng", "eng"], "members": ["eng"]}
        result = extract_groups_from_claims(claims, settings)
        assert result.count("eng") == 1

    def test_empty_claims_returns_empty(self):
        settings = make_settings()
        assert extract_groups_from_claims({}, settings) == []

    def test_missing_configured_claim_returns_empty(self):
        settings = make_settings(oidc_group_claim="nonexistent")
        claims = {"groups": ["eng"]}
        result = extract_groups_from_claims(claims, settings)
        assert result == []


# ---------------------------------------------------------------------------
# check_admin_role
# ---------------------------------------------------------------------------

class TestCheckAdminRole:
    def test_exact_match_with_configured_group(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        assert check_admin_role(["sre-admin", "eng"], settings) is True

    def test_no_match_with_configured_group(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        assert check_admin_role(["eng", "platform"], settings) is False

    def test_case_insensitive_match(self):
        settings = make_settings(oidc_required_admin_group="SRE-Admin")
        assert check_admin_role(["sre-admin"], settings) is True

    def test_dn_format_match(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        groups = ["CN=sre-admin,OU=Groups,DC=example,DC=com"]
        assert check_admin_role(groups, settings) is True

    def test_dn_format_case_insensitive(self):
        settings = make_settings(oidc_required_admin_group="SRE-ADMIN")
        groups = ["cn=sre-admin,ou=groups,dc=example,dc=com"]
        assert check_admin_role(groups, settings) is True

    def test_empty_groups_returns_false(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        assert check_admin_role([], settings) is False

    def test_fallback_pattern_matching_admin(self):
        settings = make_settings()  # no oidc_required_admin_group
        assert check_admin_role(["platform-admin"], settings) is True

    def test_fallback_pattern_matching_administrators(self):
        settings = make_settings()
        assert check_admin_role(["administrators"], settings) is True

    def test_fallback_returns_false_for_non_admin_groups(self):
        settings = make_settings()
        assert check_admin_role(["eng", "backend"], settings) is False

    def test_fallback_returns_false_for_empty_groups(self):
        settings = make_settings()
        assert check_admin_role([], settings) is False


# ---------------------------------------------------------------------------
# get_current_user — auth disabled
# ---------------------------------------------------------------------------

class TestGetCurrentUserAuthDisabled:
    @pytest.mark.asyncio
    async def test_returns_dev_user_when_auth_disabled(self):
        settings = make_settings(auth_enabled=False)
        request = make_request()  # no Authorization header

        user = await get_current_user(request=request, settings=settings)

        assert isinstance(user, UserContext)
        assert user.email == "dev@localhost"
        assert user.is_admin is True
        assert "admin" in user.groups

    @pytest.mark.asyncio
    async def test_ignores_token_when_auth_disabled(self):
        """Even if a (bad) token is provided, auth=false bypasses all validation."""
        settings = make_settings(auth_enabled=False)
        request = make_request({"Authorization": "Bearer invalid.token.here"})

        user = await get_current_user(request=request, settings=settings)

        assert user.email == "dev@localhost"
        assert user.is_admin is True

    @pytest.mark.asyncio
    async def test_dev_user_bypasses_required_group_check(self):
        """OIDC_REQUIRED_GROUP is ignored when auth is disabled."""
        settings = make_settings(auth_enabled=False, oidc_required_group="backstage-access")
        request = make_request()

        user = await get_current_user(request=request, settings=settings)

        assert user.email == "dev@localhost"
        assert user.is_admin is True


# ---------------------------------------------------------------------------
# get_current_user — missing / malformed header
# ---------------------------------------------------------------------------

class TestGetCurrentUserHeaderValidation:
    @pytest.mark.asyncio
    async def test_raises_401_when_no_authorization_header(self):
        settings = make_settings()
        request = make_request()

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_raises_401_for_non_bearer_scheme(self):
        settings = make_settings()
        request = make_request({"Authorization": "Basic dXNlcjpwYXNz"})

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 401
        assert "Bearer" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_raises_401_for_bare_bearer_word(self):
        settings = make_settings()
        request = make_request({"Authorization": "Bearer"})

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# get_current_user — OIDC_REQUIRED_GROUP enforcement (the new feature)
# ---------------------------------------------------------------------------

VALID_CLAIMS = {
    "sub": "user-123",
    "email": "alice@example.com",
    "name": "Alice Smith",
}


class TestGetCurrentUserRequiredGroup:
    """Tests for the OIDC_REQUIRED_GROUP gate added in this PR."""

    @pytest.mark.asyncio
    async def test_passes_when_user_in_required_group(self):
        settings = make_settings(oidc_required_group="backstage-access")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["backstage-access", "eng"]}),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.email == "alice@example.com"
        assert "backstage-access" in user.groups

    @pytest.mark.asyncio
    async def test_raises_403_when_user_not_in_required_group(self):
        settings = make_settings(oidc_required_group="backstage-access")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["eng", "platform"]}),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 403
        assert "required group membership missing" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_raises_403_when_user_has_no_groups(self):
        settings = make_settings(oidc_required_group="backstage-access")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com"}),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_dn_format_group_passes_check(self):
        """LDAP DN group strings like CN=backstage-access,OU=... must match."""
        settings = make_settings(oidc_required_group="backstage-access")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(
                    return_value={
                        "email": "alice@example.com",
                        "groups": ["CN=backstage-access,OU=Groups,DC=example,DC=com"],
                    }
                ),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.email == "alice@example.com"

    @pytest.mark.asyncio
    async def test_required_group_check_is_case_insensitive(self):
        settings = make_settings(oidc_required_group="Backstage-Access")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["backstage-access"]}),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.email == "alice@example.com"

    @pytest.mark.asyncio
    async def test_no_required_group_allows_any_authenticated_user(self):
        """When OIDC_REQUIRED_GROUP is not set, no group gate is applied."""
        settings = make_settings()  # oidc_required_group=None by default
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["random-group"]}),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.email == "alice@example.com"

    @pytest.mark.asyncio
    async def test_required_group_checked_before_admin_check(self):
        """403 for missing required group even if user would otherwise be admin."""
        settings = make_settings(
            oidc_required_group="backstage-access",
            oidc_required_admin_group="sre-admin",
        )
        request = make_request({"Authorization": "Bearer valid.token"})

        # User is in sre-admin (admin group) but NOT in backstage-access (required group)
        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["sre-admin"]}),
            ),
        ):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(request=request, settings=settings)

        assert exc_info.value.status_code == 403


# ---------------------------------------------------------------------------
# get_current_user — userinfo vs. token claims fallback
# ---------------------------------------------------------------------------

class TestGetCurrentUserUserinfoBehavior:
    @pytest.mark.asyncio
    async def test_uses_userinfo_groups_when_available(self):
        settings = make_settings()
        request = make_request({"Authorization": "Bearer valid.token"})

        token_claims = {**VALID_CLAIMS, "groups": ["token-group"]}
        userinfo = {"email": "alice@example.com", "name": "Alice", "groups": ["userinfo-group"]}

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=token_claims)),
            patch("dynamic_agents.auth.auth.fetch_userinfo_cached", new=AsyncMock(return_value=userinfo)),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert "userinfo-group" in user.groups
        assert "token-group" not in user.groups

    @pytest.mark.asyncio
    async def test_falls_back_to_token_claims_when_userinfo_unavailable(self):
        settings = make_settings()
        request = make_request({"Authorization": "Bearer valid.token"})

        token_claims = {**VALID_CLAIMS, "groups": ["token-group"]}

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=token_claims)),
            patch("dynamic_agents.auth.auth.fetch_userinfo_cached", new=AsyncMock(return_value=None)),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert "token-group" in user.groups

    @pytest.mark.asyncio
    async def test_userinfo_email_overrides_token_email(self):
        settings = make_settings()
        request = make_request({"Authorization": "Bearer valid.token"})

        token_claims = {**VALID_CLAIMS, "email": "old@example.com"}
        userinfo = {"email": "current@example.com", "groups": []}

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=token_claims)),
            patch("dynamic_agents.auth.auth.fetch_userinfo_cached", new=AsyncMock(return_value=userinfo)),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.email == "current@example.com"


# ---------------------------------------------------------------------------
# get_current_user — admin role assignment
# ---------------------------------------------------------------------------

class TestGetCurrentUserAdminRole:
    @pytest.mark.asyncio
    async def test_is_admin_true_when_in_admin_group(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["sre-admin", "eng"]}),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.is_admin is True

    @pytest.mark.asyncio
    async def test_is_admin_false_when_not_in_admin_group(self):
        settings = make_settings(oidc_required_admin_group="sre-admin")
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(return_value={"email": "alice@example.com", "groups": ["eng"]}),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.is_admin is False

    @pytest.mark.asyncio
    async def test_user_in_both_required_and_admin_groups(self):
        """User in both OIDC_REQUIRED_GROUP and admin group → passes gate AND is_admin=True."""
        settings = make_settings(
            oidc_required_group="backstage-access",
            oidc_required_admin_group="sre-admin",
        )
        request = make_request({"Authorization": "Bearer valid.token"})

        with (
            patch("dynamic_agents.auth.auth.validate_token", new=AsyncMock(return_value=VALID_CLAIMS)),
            patch(
                "dynamic_agents.auth.auth.fetch_userinfo_cached",
                new=AsyncMock(
                    return_value={
                        "email": "alice@example.com",
                        "groups": ["backstage-access", "sre-admin"],
                    }
                ),
            ),
        ):
            user = await get_current_user(request=request, settings=settings)

        assert user.is_admin is True
        assert "backstage-access" in user.groups
        assert "sre-admin" in user.groups


# ---------------------------------------------------------------------------
# Settings model — oidc_required_group field
# ---------------------------------------------------------------------------

class TestSettingsOidcRequiredGroup:
    def test_defaults_to_none(self):
        s = Settings.model_validate({"auth_enabled": False})
        assert s.oidc_required_group is None

    def test_accepts_group_name(self):
        s = Settings.model_validate({"auth_enabled": False, "oidc_required_group": "backstage-access"})
        assert s.oidc_required_group == "backstage-access"

    def test_accepts_empty_string(self):
        s = Settings.model_validate({"auth_enabled": False, "oidc_required_group": ""})
        assert s.oidc_required_group == ""

    def test_independent_of_admin_group(self):
        """Required group and admin group are separate fields."""
        s = Settings.model_validate({
            "auth_enabled": False,
            "oidc_required_group": "backstage-access",
            "oidc_required_admin_group": "sre-admin",
        })
        assert s.oidc_required_group == "backstage-access"
        assert s.oidc_required_admin_group == "sre-admin"

"""Keycloak-specific OIDC authentication tests for the RAG server."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from common.models.rbac import Role
from server.auth import OIDCProvider
from server.rbac import _authenticate_from_token, is_client_credentials_token


class TestKeycloakDiscoveryUrls:
    def test_realm_base_discovery_url_is_normalized_to_well_known(self):
        provider = OIDCProvider(
            issuer="http://localhost:7080/realms/caipe",
            audience="caipe-platform",
            name="ui",
            discovery_url="http://keycloak:7080/realms/caipe",
        )

        assert (
            provider._discovery_document_url()
            == "http://keycloak:7080/realms/caipe/.well-known/openid-configuration"
        )

    def test_full_discovery_url_is_preserved(self):
        provider = OIDCProvider(
            issuer="http://localhost:7080/realms/caipe",
            audience="caipe-platform",
            name="ingestor",
            discovery_url="http://keycloak:7080/realms/caipe/.well-known/openid-configuration",
        )

        assert (
            provider._discovery_document_url()
            == "http://keycloak:7080/realms/caipe/.well-known/openid-configuration"
        )


class TestKeycloakClientCredentials:
    def test_keycloak_service_account_token_is_client_credentials(self):
        claims = {
            "sub": "9d3fb2aa-0000-4000-9000-2f43b8d4ef00",
            "azp": "caipe-platform",
            "preferred_username": "service-account-caipe-platform",
            "realm_access": {"roles": ["chat_user", "admin"]},
        }

        assert is_client_credentials_token(claims) is True

    def test_keycloak_human_user_token_is_not_client_credentials(self):
        claims = {
            "sub": "9c7381c0-9f57-44c6-86ef-978b1c48811c",
            "azp": "caipe-ui",
            "preferred_username": "sri@example.com",
            "email": "sri@example.com",
        }

        assert is_client_credentials_token(claims) is False


class FakeAuthManager:
    def __init__(self, claims):
        self.claims = claims
        self.fetch_userinfo_called = False

    async def validate_token(self, _token):
        return SimpleNamespace(name="ui"), self.claims

    async def fetch_userinfo(self, *_args, **_kwargs):
        self.fetch_userinfo_called = True
        return {"email": "from-userinfo@example.com", "groups": ["ignored-admin-group"]}


class TestRebacFirstUserAuth:
    @pytest.mark.asyncio
    async def test_human_token_uses_keycloak_claims_without_userinfo_group_or_role_fallback(self):
        auth_manager = FakeAuthManager(
            {
                "sub": "user-sub",
                "email": "sri@example.com",
                "preferred_username": "sri@example.com",
                "realm_access": {
                    "roles": [
                        "chat_user",
                        "admin_user",
                        "kb_admin",
                        "kb_reader:ignored-kb",
                    ]
                },
                "groups": ["ignored-admin-group"],
            }
        )
        request = SimpleNamespace(
            headers={
                "Authorization": "Bearer user-token",
            }
        )

        user = await _authenticate_from_token(request, auth_manager)

        assert user is not None
        assert user.subject == "user-sub"
        assert user.email == "sri@example.com"
        assert user.role == Role.READONLY
        assert not hasattr(user, "groups")
        assert not hasattr(user, "kb_permissions")
        assert not hasattr(user, "realm_roles")
        assert auth_manager.fetch_userinfo_called is False

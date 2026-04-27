"""Tests for ``determine_role_from_keycloak_roles``.

Spec 104 follow-on — verifies that the ``admin_user`` realm role
(assigned by ``init-idp.sh`` to ``BOOTSTRAP_ADMIN_EMAILS`` users)
maps to RAG ``ADMIN``, even when other lower-privilege roles like
``chat_user`` or ``team_member:demo-team`` are also present in the JWT.

This is the bug that made the RAG status panel show ``readonly`` for
platform admins: ``chat_user`` was being matched first and the more
permissive ``admin_user`` was ignored because the mapper didn't
recognize it.
"""

from __future__ import annotations

from common.models.rbac import Role
from server.rbac import determine_role_from_keycloak_roles


class TestRoleMapping:
    def test_admin_user_maps_to_admin(self):
        """Spec 104 platform admin role grants RAG ADMIN."""
        assert determine_role_from_keycloak_roles(["admin_user"]) == Role.ADMIN

    def test_admin_user_wins_over_chat_user(self):
        """The exact bug we're fixing: bootstrap admin has BOTH roles in their
        JWT (``chat_user`` is the realm default-role, ``admin_user`` is the
        bootstrap grant). The mapper must return ADMIN, not READONLY."""
        roles = [
            "chat_user",
            "default-roles-caipe",
            "tool_user:*",
            "agent_admin:test-april-2025",
            "team_member:demo-team",
            "admin_user",
            "agent_user:test-april-2025",
        ]
        assert determine_role_from_keycloak_roles(roles) == Role.ADMIN

    def test_legacy_admin_role_still_works(self):
        """Don't regress the original ``admin`` realm role mapping."""
        assert determine_role_from_keycloak_roles(["admin"]) == Role.ADMIN

    def test_kb_admin_maps_to_ingestonly(self):
        assert determine_role_from_keycloak_roles(["kb_admin"]) == Role.INGESTONLY

    def test_chat_user_alone_maps_to_readonly(self):
        """Without admin_user, chat_user still means READONLY."""
        assert determine_role_from_keycloak_roles(["chat_user"]) == Role.READONLY

    def test_team_member_alone_maps_to_readonly(self):
        assert determine_role_from_keycloak_roles(["team_member"]) == Role.READONLY

    def test_denied_maps_to_anonymous(self):
        assert determine_role_from_keycloak_roles(["denied"]) == Role.ANONYMOUS

    def test_unknown_roles_map_to_anonymous(self):
        """Unrecognized roles fall through to ANONYMOUS so callers can decide
        to fall back to group-based mapping or the default authenticated role."""
        assert determine_role_from_keycloak_roles(["random:role"]) == Role.ANONYMOUS

    def test_empty_roles_map_to_anonymous(self):
        assert determine_role_from_keycloak_roles([]) == Role.ANONYMOUS

    def test_admin_beats_kb_admin(self):
        """Most-permissive-wins: admin > kb_admin even when both present."""
        assert (
            determine_role_from_keycloak_roles(["kb_admin", "admin_user"])
            == Role.ADMIN
        )

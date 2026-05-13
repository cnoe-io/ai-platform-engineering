"""Representative identity group fixtures for RBAC tests."""

from __future__ import annotations

from typing import Final, TypedDict


class IdentityGroupFixtureMember(TypedDict):
    """Member record carried by an upstream identity group fixture."""

    subject: str
    email: str
    display_name: str
    active: bool


class IdentityGroupFixture(TypedDict):
    """Upstream group record used by identity sync tests."""

    provider_id: str
    external_group_id: str
    immutable_id: str
    display_name: str
    members: tuple[IdentityGroupFixtureMember, ...]


IDENTITY_GROUP_FIXTURES: Final[tuple[IdentityGroupFixture, ...]] = (
    {
        "provider_id": "oidc-claims",
        "external_group_id": "eng-platform-admins",
        "immutable_id": "gid-eng-platform-admins",
        "display_name": "Engineering Platform Admins",
        "members": (
            {
                "subject": "alice-admin-sub",
                "email": "alice_admin@example.test",
                "display_name": "Alice Admin",
                "active": True,
            },
        ),
    },
    {
        "provider_id": "oidc-claims",
        "external_group_id": "eng-platform-users",
        "immutable_id": "gid-eng-platform-users",
        "display_name": "Engineering Platform Users",
        "members": (
            {
                "subject": "bob-chat-user-sub",
                "email": "bob_chat_user@example.test",
                "display_name": "Bob Chat User",
                "active": True,
            },
            {
                "subject": "dave-no-role-sub",
                "email": "dave_no_role@example.test",
                "display_name": "Dave No Role",
                "active": True,
            },
        ),
    },
    {
        "provider_id": "okta-primary",
        "external_group_id": "kb-ingestors",
        "immutable_id": "00g-kb-ingestors",
        "display_name": "Knowledge Base Ingestors",
        "members": (
            {
                "subject": "carol-kb-ingestor-sub",
                "email": "carol_kb_ingestor@example.test",
                "display_name": "Carol KB Ingestor",
                "active": True,
            },
        ),
    },
)

IDENTITY_GROUP_SYNC_RULE_FIXTURE: Final = {
    "id": "rule-platform-groups",
    "provider_id": "oidc-claims",
    "name": "Platform groups",
    "priority": 10,
    "include_patterns": (r"^Engineering Platform (?P<role>Admins|Users)$",),
    "exclude_patterns": (r"^Engineering Platform Contractors$",),
    "team_name_template": "Platform",
    "team_slug_template": "platform",
    "role_map": {
        "Admins": "admin",
        "Users": "member",
    },
    "auto_create_team": True,
}

__all__ = [
    "IDENTITY_GROUP_FIXTURES",
    "IDENTITY_GROUP_SYNC_RULE_FIXTURE",
    "IdentityGroupFixture",
    "IdentityGroupFixtureMember",
]

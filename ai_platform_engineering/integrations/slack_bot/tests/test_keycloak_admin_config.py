# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Regression tests for KeycloakAdminConfig env-var contract.

These tests pin the *names* of the environment variables consumed by
``slack_bot.utils.keycloak_admin``. They exist specifically to prevent a
recurrence of the 098 bug where the slack-bot read ``KEYCLOAK_ADMIN_*``
— the same env-var names used by the UI BFF — and a UI-oriented value in
``.env`` collapsed both services to ``admin-cli`` (a public client),
yielding ``HTTP 401 "Public client not allowed to retrieve service
account"`` on every Slack identity lookup.

The surface-specific ``KEYCLOAK_SLACK_BOT_ADMIN_*`` names eliminate that
namespace collision and leave room for future bot surfaces (e.g.
``KEYCLOAK_WEBEX_BOT_ADMIN_*``) without yet another rename. If anyone
ever drops the ``SLACK_`` prefix back to a generic ``KEYCLOAK_BOT_ADMIN_*``
or all the way back to ``KEYCLOAK_ADMIN_*``, this test catches it before
the slack-bot ever talks to Keycloak.
"""

from __future__ import annotations

import importlib

import pytest


def _reload_module():
    """Re-import the module so its module-level ``_default_config`` picks up
    the patched env vars."""
    from ai_platform_engineering.integrations.slack_bot.utils import (
        keycloak_admin as ka,
    )

    return importlib.reload(ka)


def test_uses_keycloak_slack_bot_admin_env_vars(monkeypatch: pytest.MonkeyPatch) -> None:
    """Config MUST read the surface-specific env names, not the shared
    KEYCLOAK_ADMIN_* names that the UI BFF uses, and not a generic
    KEYCLOAK_BOT_ADMIN_* (which would collide with future Webex/Teams bots)."""
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", "caipe-platform")
    monkeypatch.setenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", "platform-dev-secret")
    # If the implementation regressed to KEYCLOAK_ADMIN_* or the generic
    # KEYCLOAK_BOT_ADMIN_*, those would silently win and the test would
    # still pass — so explicitly UNSET them.
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_SECRET", raising=False)

    ka = _reload_module()
    cfg = ka.KeycloakAdminConfig()

    assert cfg.client_id == "caipe-platform"
    assert cfg.client_secret == "platform-dev-secret"


def test_default_client_id_has_admin_api_roles(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the env is fully unset, the default client_id MUST be one that
    has ``view-users`` + ``query-users`` on ``realm-management`` so the
    user-by-attribute lookup can succeed.

    The 098 realm seeder grants those roles to ``caipe-platform``, NOT to
    ``caipe-slack-bot`` (whose service account has zero realm-management
    roles). Defaulting to anything else would produce a 403 on every
    Slack mention.
    """
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_SECRET", raising=False)

    ka = _reload_module()
    cfg = ka.KeycloakAdminConfig()

    assert cfg.client_id == "caipe-platform", (
        "Default must be a client with realm-management roles. "
        "caipe-slack-bot has no admin roles in the seeded realm."
    )
    assert cfg.client_secret is None


def test_does_not_fall_back_to_ui_admin_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Setting only the UI-style ``KEYCLOAK_ADMIN_*`` MUST NOT influence the
    slack-bot's config. This is the regression guard for the namespace bug."""
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_BOT_ADMIN_CLIENT_SECRET", raising=False)
    # UI-flavoured values that previously poisoned slack-bot:
    monkeypatch.setenv("KEYCLOAK_ADMIN_CLIENT_ID", "admin-cli")
    monkeypatch.setenv("KEYCLOAK_ADMIN_CLIENT_SECRET", "")

    ka = _reload_module()
    cfg = ka.KeycloakAdminConfig()

    assert cfg.client_id != "admin-cli", (
        "slack-bot must NOT inherit KEYCLOAK_ADMIN_CLIENT_ID — that's the UI's var. "
        "Sharing it is exactly the bug we're guarding against."
    )
    assert cfg.client_id == "caipe-platform"
    assert cfg.client_secret is None


def test_does_not_fall_back_to_generic_bot_admin_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Setting the generic ``KEYCLOAK_BOT_ADMIN_*`` (no surface qualifier)
    MUST NOT influence the slack-bot's config. We use surface-specific names
    so future bots (Webex, Teams, …) get their own dedicated namespace."""
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_ID", raising=False)
    monkeypatch.delenv("KEYCLOAK_ADMIN_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("KEYCLOAK_BOT_ADMIN_CLIENT_ID", "some-other-client")
    monkeypatch.setenv("KEYCLOAK_BOT_ADMIN_CLIENT_SECRET", "some-other-secret")

    ka = _reload_module()
    cfg = ka.KeycloakAdminConfig()

    assert cfg.client_id == "caipe-platform", (
        "slack-bot must NOT inherit the generic KEYCLOAK_BOT_ADMIN_*. "
        "We use surface-specific KEYCLOAK_SLACK_BOT_ADMIN_* to leave room "
        "for future Webex/Teams bots."
    )
    assert cfg.client_secret is None

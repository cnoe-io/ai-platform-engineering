# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Tests for Webex identity linking."""

from __future__ import annotations

import asyncio
import importlib
import os
from typing import Optional

import pytest

from ai_platform_engineering.integrations.webex_bot.utils import identity_linker as il
from ai_platform_engineering.integrations.webex_bot.utils.identity_linker import (
    UI_WEBEX_LINK_NONCES_COLLECTION,
    WebexIdentityLinker,
)
from ai_platform_engineering.integrations.webex_bot.utils.keycloak_admin import (
    WEBEX_USER_ATTRIBUTE,
)


@pytest.fixture(autouse=True)
def _restore_identity_linker_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    yield
    monkeypatch.delenv("WEBEX_LINK_TTL_SECONDS", raising=False)
    importlib.reload(il)


def test_ui_nonce_collection_and_attribute_names() -> None:
    assert UI_WEBEX_LINK_NONCES_COLLECTION == "webex_link_nonces"
    assert WEBEX_USER_ATTRIBUTE == "webex_user_id"


def test_resolve_webex_user_rejects_invalid_person_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    async def fake_lookup(_attr: str, _value: str):
        nonlocal called
        called = True
        return None

    monkeypatch.setattr(il, "get_user_by_attribute", fake_lookup)
    assert asyncio.run(il.resolve_webex_user("bad/id")) is None
    assert called is False


def test_link_ttl_defaults_to_600_seconds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("WEBEX_LINK_TTL_SECONDS", raising=False)
    reloaded = importlib.reload(il)
    assert reloaded._LINK_TTL_SECONDS == 600
    assert int(os.environ.get("WEBEX_LINK_TTL_SECONDS", "600")) == 600


def test_link_ttl_honors_webex_link_ttl_seconds_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("WEBEX_LINK_TTL_SECONDS", "900")
    reloaded = importlib.reload(il)
    assert reloaded._LINK_TTL_SECONDS == 900


def test_resolve_webex_user_returns_none_when_unlinked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_lookup(_attr: str, _value: str):
        return None

    monkeypatch.setattr(il, "get_user_by_attribute", fake_lookup)
    assert asyncio.run(il.resolve_webex_user("person1234")) is None


def test_resolve_webex_user_returns_keycloak_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_lookup(_attr: str, _value: str):
        return {"id": "kc-uuid", "enabled": True}

    monkeypatch.setattr(il, "get_user_by_attribute", fake_lookup)
    assert asyncio.run(il.resolve_webex_user("person1234")) == "kc-uuid"


def test_webex_identity_linker_protocol(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    linker = WebexIdentityLinker()

    async def fake_resolve(webex_user_id: str) -> Optional[str]:
        return "kc-1" if webex_user_id == "person1234" else None

    monkeypatch.setattr(linker, "resolve", fake_resolve)
    assert asyncio.run(linker.resolve("person1234")) == "kc-1"

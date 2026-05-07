# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the idempotent Webex webhook registration helper.

The bot must:
  * reuse a webhook whose name+target_url already match,
  * delete and recreate when the name matches but the URL is stale
    (typical ngrok rotation in dev),
  * create when none exists,
  * never touch webhooks belonging to other names.
"""

from __future__ import annotations

import pytest

from webex_bot.webhook_setup import ensure_webhook_registered  # type: ignore[import-not-found]


class FakeWebexClient:
    """In-memory stand-in for ``WebexClient`` covering the surface
    ``ensure_webhook_registered`` actually exercises.
    """

    def __init__(self, existing: list[dict]) -> None:
        self._existing = list(existing)
        self.created: list[dict] = []
        self.deleted: list[str] = []
        self._next_id = 100

    async def list_webhooks(self) -> list[dict]:
        return list(self._existing)

    async def delete_webhook(self, webhook_id: str) -> None:
        self.deleted.append(webhook_id)
        self._existing = [w for w in self._existing if w.get("id") != webhook_id]

    async def create_webhook(self, **kwargs) -> dict:
        wh = {"id": f"wh-{self._next_id}", **kwargs}
        # Webex's response uses ``targetUrl`` not ``target_url``.
        if "target_url" in kwargs:
            wh["targetUrl"] = kwargs["target_url"]
        self._next_id += 1
        self._existing.append(wh)
        self.created.append(kwargs)
        return wh


@pytest.mark.asyncio
async def test_creates_when_none_exist():
    client = FakeWebexClient(existing=[])

    result = await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://abcd.ngrok-free.app/webex/events",
        secret="s",
    )

    assert client.deleted == []
    assert len(client.created) == 1
    assert client.created[0]["target_url"] == (
        "https://abcd.ngrok-free.app/webex/events"
    )
    assert client.created[0]["secret"] == "s"
    assert result["targetUrl"] == "https://abcd.ngrok-free.app/webex/events"


@pytest.mark.asyncio
async def test_reuses_when_name_and_target_and_signing_match():
    existing = [
        {
            "id": "wh-1",
            "name": "caipe-autonomous-followups",
            "targetUrl": "https://abcd.ngrok-free.app/webex/events",
            "secret": "",  # unsigned, matches our None secret below
        }
    ]
    client = FakeWebexClient(existing=existing)

    result = await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://abcd.ngrok-free.app/webex/events",
    )

    assert client.deleted == []
    assert client.created == []
    assert result["id"] == "wh-1"


@pytest.mark.asyncio
async def test_replaces_unsigned_webhook_when_secret_is_now_configured():
    """Regression: adding ``WEBEX_WEBHOOK_SECRET`` to .env on a
    restart must force re-registration. Otherwise Webex keeps
    delivering unsigned events and the bot 401s every one of them
    (we hit this in dev with PR #3)."""
    existing = [
        {
            "id": "wh-unsigned",
            "name": "caipe-autonomous-followups",
            "targetUrl": "https://abcd.ngrok-free.app/webex/events",
            "secret": "",  # registered without a secret
        }
    ]
    client = FakeWebexClient(existing=existing)

    await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://abcd.ngrok-free.app/webex/events",
        secret="now-configured",
    )

    assert client.deleted == ["wh-unsigned"]
    assert len(client.created) == 1
    assert client.created[0]["secret"] == "now-configured"


@pytest.mark.asyncio
async def test_replaces_signed_webhook_when_secret_was_removed():
    """The reverse: dropping ``WEBEX_WEBHOOK_SECRET`` from .env must
    also force re-registration so Webex stops signing events the bot
    isn't expecting to verify."""
    existing = [
        {
            "id": "wh-signed",
            "name": "caipe-autonomous-followups",
            "targetUrl": "https://abcd.ngrok-free.app/webex/events",
            "secret": "old-secret",
        }
    ]
    client = FakeWebexClient(existing=existing)

    await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://abcd.ngrok-free.app/webex/events",
        secret=None,
    )

    assert client.deleted == ["wh-signed"]
    assert len(client.created) == 1
    assert "secret" not in client.created[0]


@pytest.mark.asyncio
async def test_replaces_stale_target_url():
    """ngrok rotation case -- name matches, URL doesn't. We delete
    the stale one and create a fresh one with the new URL."""
    existing = [
        {
            "id": "wh-stale",
            "name": "caipe-autonomous-followups",
            "targetUrl": "https://OLD.ngrok-free.app/webex/events",
        }
    ]
    client = FakeWebexClient(existing=existing)

    await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://NEW.ngrok-free.app/webex/events",
    )

    assert client.deleted == ["wh-stale"]
    assert len(client.created) == 1
    assert (
        client.created[0]["target_url"]
        == "https://NEW.ngrok-free.app/webex/events"
    )


@pytest.mark.asyncio
async def test_ignores_webhooks_with_other_names():
    """Operators may run multiple bots against one Webex tenant. We
    only manage webhooks whose ``name`` matches ours."""
    existing = [
        {
            "id": "wh-other",
            "name": "some-other-bot",
            "targetUrl": "https://other.example.com/hook",
        }
    ]
    client = FakeWebexClient(existing=existing)

    await ensure_webhook_registered(
        client,  # type: ignore[arg-type]
        target_url="https://abcd.ngrok-free.app/webex/events",
    )

    # Other bot's webhook is untouched; we created our own.
    assert client.deleted == []
    assert len(client.created) == 1

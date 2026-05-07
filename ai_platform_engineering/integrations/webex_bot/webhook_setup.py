# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

"""Idempotent Webex webhook registration.

Lives in its own module (rather than inside ``app.py``) so unit tests
exercising the registration logic don't have to drag in FastAPI, motor,
or the dispatcher just to import a single async helper.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .webex_client import WebexClient


logger = logging.getLogger(__name__)


async def ensure_webhook_registered(
    webex: WebexClient,
    *,
    target_url: str,
    name: str = "caipe-autonomous-followups",
    secret: str | None = None,
) -> dict[str, Any]:
    """Make sure exactly one ``messages.created`` webhook points at us.

    Idempotent strategy:
        * If a webhook with our ``name`` exists pointing at the same
          ``target_url`` AND its signed/unsigned state matches our
          current ``secret`` argument -- leave it.
        * Otherwise (stale URL OR signed/unsigned mismatch) -- delete
          it and recreate with the current settings. This keeps the
          dev-loop on ngrok painless (rotating the public URL just
          needs a service restart) AND prevents the silent-rejection
          trap where we add a ``WEBEX_WEBHOOK_SECRET`` to ``.env``
          on a second restart but the webhook already exists in
          Webex without a secret -- every event then arrives without
          ``X-Spark-Signature`` and the bot 401s them.
        * If none exist -- create a fresh one.

    We deliberately do NOT scan for "any webhook pointing at this
    target_url" because operators may manage several caipe instances
    against one Webex bot; only webhooks matching ``name`` are ours
    to manage.

    Returns the surviving webhook record.
    """
    existing = await webex.list_webhooks()
    ours = [w for w in existing if w.get("name") == name]

    # Webex's GET /webhooks list response returns ``"secret": ""`` for
    # unsigned webhooks (and omits the field on some tenant flavours);
    # treat both as "no secret configured" for the comparison below.
    desired_signed = bool(secret)

    for wh in ours:
        existing_signed = bool(wh.get("secret"))
        if (
            wh.get("targetUrl") == target_url
            and existing_signed == desired_signed
        ):
            logger.info(
                "Webex webhook %s already points at %s (signed=%s) -- reusing",
                wh.get("id"),
                target_url,
                desired_signed,
            )
            return wh
        # Stale registration (URL changed OR signing posture flipped);
        # nuke and re-create. Logging the precise mismatch reason
        # makes the "I added a secret and now nothing arrives"
        # situation immediately obvious in the startup log.
        reason_bits: list[str] = []
        if wh.get("targetUrl") != target_url:
            reason_bits.append(
                f"url {wh.get('targetUrl')!r} -> {target_url!r}"
            )
        if existing_signed != desired_signed:
            reason_bits.append(
                f"signed {existing_signed} -> {desired_signed}"
            )
        try:
            await webex.delete_webhook(wh["id"])
            logger.info(
                "Deleted stale Webex webhook %s (%s)",
                wh["id"],
                "; ".join(reason_bits) or "no reason captured",
            )
        except httpx.HTTPError as exc:
            logger.warning("Failed to delete stale webhook %s: %s", wh["id"], exc)

    created = await webex.create_webhook(
        name=name,
        target_url=target_url,
        resource="messages",
        event="created",
        secret=secret,
    )
    logger.info(
        "Registered Webex webhook %s -> %s (signed=%s)",
        created.get("id"),
        target_url,
        secret is not None,
    )
    return created

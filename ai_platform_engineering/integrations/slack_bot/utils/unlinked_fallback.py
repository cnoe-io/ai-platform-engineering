# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Unlinked-fallback helper extracted from ``app.rbac_global_middleware``.

Extracted so the fallback logic is unit-testable without importing
``slack_bolt`` — mirroring how ``dispatch_identity.apply_execution_identity``
is tested (TEST-5/6).

Runtime behavior is UNCHANGED.  ``app.py`` calls
:func:`apply_unlinked_fallback` in place of the inlined block it replaced.

Decision table (Decision 5, anonymous-and-obo-routing):
    rbac_status | mint result | action
    ------------|-------------|---------------------------------------------------
    unlinked    | token       | stash token in context, nudge, PROCEED
    unlinked    | None        | nudge+stop (SA unavailable)
    other       | —           | no-op (return PROCEED)

Returns ``True`` when the request should PROCEED (``next()`` should be
called), ``False`` when it should be ABORTED (return the 200 short-circuit).

This module intentionally imports NO slack_bolt symbols so it can be
imported and tested in environments without the Slack SDK installed.
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger("caipe.slack_bot.unlinked_fallback")

# Type alias: async callable () -> Optional[str]
MintFn = Callable[[], Awaitable[Optional[str]]]

# Type alias: async callable (slack_user_id: str) -> Optional[str]
LinkingUrlFn = Callable[[str], Awaitable[Optional[str]]]


async def apply_unlinked_fallback(
    *,
    rbac_status: Any,
    slack_user_id: str,
    channel: Optional[str],
    context: Any,
    mint_fn: MintFn,
    linking_url_fn: Optional[LinkingUrlFn],
    last_sent: float,
    linking_prompt_cooldown: float,
    is_dm_channel_fn: Callable[[Optional[str]], bool],
) -> bool:
    """Apply the unlinked-fallback decision for ``unlinked`` status.

    Parameters
    ----------
    rbac_status:
        The value returned by ``_rbac_enrich_context``.
    slack_user_id:
        The Slack user ID for rate-limiting and nudge targeting.
    channel:
        The Slack channel ID (may be None for non-event payloads).
    context:
        Bolt request context dict; ``context["obo_token"]`` and
        ``context["unlinked_fallback"]`` are written on success.
        Also used to call ``context["client"].chat_postEphemeral/Message``.
    mint_fn:
        Async callable ``() -> Optional[str]``; mints the unlinked SA
        token.  Returns ``None`` when the SA is unavailable.
    linking_url_fn:
        Async callable ``(slack_user_id) -> Optional[str]``; generates a
        linking URL.  Pass ``None`` or a callable that returns ``None`` when
        URL generation is not available.
    last_sent:
        Timestamp (``time.time()``) of the last prompt sent to this user.
    linking_prompt_cooldown:
        Seconds between prompts (rate-limit).
    is_dm_channel_fn:
        Callable ``(channel_id) -> bool``; returns ``True`` for DM channels.
        Used to decide whether to send a visible ``chat_postMessage`` (UX-2).

    Returns
    -------
    bool
        ``True``  → PROCEED (caller should call ``next()``).
        ``False`` → ABORT  (caller should return the 200 short-circuit).
    """
    import time as _time

    if rbac_status != "unlinked":
        return True

    now = _time.time()

    # Try to mint the unlinked SA token.
    try:
        unlinked_token = await mint_fn()
    except Exception as exc:
        logger.warning(
            "apply_unlinked_fallback: unlinked SA token mint failed for user=%s: %s",
            slack_user_id,
            exc,
        )
        unlinked_token = None

    if unlinked_token is None:
        # Unlinked SA unavailable — nudge + stop.
        if now - last_sent < linking_prompt_cooldown:
            logger.debug("Suppressing linking prompt for %s (cooldown)", slack_user_id)
            return False
        if channel:
            try:
                linking_url: Optional[str] = None
                if linking_url_fn is not None:
                    try:
                        linking_url = await linking_url_fn(slack_user_id)
                    except Exception:
                        linking_url = None

                if linking_url:
                    text = (
                        "Your Slack account is not linked to an enterprise identity. "
                        f"<{linking_url}|Click here to link your account> "
                        "before using this feature."
                    )
                else:
                    text = (
                        "Your Slack account could not be linked because the bot is "
                        "not configured to mint linking URLs. Please contact your admin."
                    )
                context["client"].chat_postEphemeral(
                    channel=channel,
                    user=slack_user_id,
                    text=text,
                )
            except Exception:
                logger.warning("Could not send linking prompt to %s", slack_user_id)
        return False

    # Unlinked SA token acquired — stash it so _bind_obo_for_handler
    # picks it up unchanged, then fall through to next() and continue.
    context["obo_token"] = unlinked_token
    context["unlinked_fallback"] = True
    logger.info(
        "apply_unlinked_fallback: user=%s status=%s; "
        "proceeding with unlinked SA token (minimum access)",
        slack_user_id,
        rbac_status,
    )

    # Nudge the user (rate-limited) that they're on unlinked access.
    # These users haven't linked their enterprise/SSO identity — the copy
    # prompts them to link so they can act as themselves.
    if now - last_sent >= linking_prompt_cooldown and channel:
        try:
            linking_url = None
            if linking_url_fn is not None:
                try:
                    linking_url = await linking_url_fn(slack_user_id)
                except Exception:
                    linking_url = None

            if linking_url:
                text = (
                    "You're using minimum access (unlinked). "
                    f"<{linking_url}|Link your enterprise (SSO) identity> "
                    "to act as yourself and unlock more capabilities."
                )
            else:
                text = (
                    "You're using minimum access (unlinked). "
                    "Link your enterprise (SSO) identity to act as yourself "
                    "and unlock more capabilities. Contact your admin for help."
                )

            # UX-2: ephemeral is a Slack API no-op in DMs — use
            # chat_postMessage so the nudge actually appears.
            if is_dm_channel_fn(channel):
                context["client"].chat_postMessage(
                    channel=channel,
                    text=text,
                )
            else:
                context["client"].chat_postEphemeral(
                    channel=channel,
                    user=slack_user_id,
                    text=text,
                )
        except Exception:
            logger.warning("Could not send unlinked-access nudge to %s", slack_user_id)

    return True

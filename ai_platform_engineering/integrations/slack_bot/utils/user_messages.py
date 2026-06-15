"""User-facing Slack bot message copy and Slack messaging utilities."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("caipe.slack_bot.user_messages")

TEAM_SESSION_UNAVAILABLE_MESSAGE = (
    "I couldn't start your CAIPE session for this channel. "
    "Ask an admin to refresh this channel's team setup in CAIPE."
)

TEAM_SETUP_INCOMPLETE_MESSAGE = (
    "This {surface}'s team setup is incomplete. Ask an admin to refresh the "
    "{surface}'s team assignment in CAIPE, then try again."
)


def send_error_notice(
    *,
    event: dict[str, Any],
    client: Any,
    say: Any,
    is_bot: bool,
    text: str,
) -> None:
    """Post an ephemeral or in-thread error notice.

    For human senders (``is_bot=False``), uses ``client.chat_postEphemeral``
    so only they see the error. For bot senders (no ``user`` in event), falls
    back to ``say`` (in-thread visible to the channel).

    Moved here from dispatch_identity (PRC-3) so it sits with other
    Slack messaging helpers rather than in the identity module.
    """
    channel_id = event.get("channel")
    if not channel_id:
        return

    user_id = event.get("user") if not is_bot else None
    try:
        if user_id:
            client.chat_postEphemeral(channel=channel_id, user=user_id, text=text)
        else:
            # UX-1: prefer thread_ts (bot reply lives in the existing thread);
            # fall back to ts so a root-level bot message also gets a reply.
            say(text=text, thread_ts=event.get("thread_ts") or event.get("ts"))
    except Exception as notice_exc:
        logger.warning(
            "send_error_notice: could not send error notice to channel=%s: %s",
            channel_id,
            notice_exc,
        )

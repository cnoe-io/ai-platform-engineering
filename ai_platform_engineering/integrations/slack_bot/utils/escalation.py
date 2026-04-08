# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
Escalation workflows triggered by the 'Get help' button.

Supports three configurable actions (all fire if enabled):
1. VictorOps on-call ping — queries AI for the on-call email, resolves Slack user, @-mentions them
2. Direct user/group ping — @-mentions configured Slack users or groups
3. Emoji reaction — adds a configured emoji to the parent message
"""

import re

from loguru import logger

from utils.config_models import EscalationConfig


def execute_escalation(
    slack_client,
    sse_client,
    channel_id,
    thread_ts,
    parent_ts,
    user_id,
    escalation_config: EscalationConfig,
):
    """Run all configured escalation actions. Returns list of result summaries."""
    results = []

    if escalation_config.victorops.enabled and escalation_config.victorops.team:
        result = _ping_victorops_oncall(
            sse_client, slack_client, channel_id, thread_ts,
            escalation_config.victorops.team,
        )
        results.append(result)

    if escalation_config.users:
        result = _ping_users(slack_client, channel_id, thread_ts, escalation_config.users)
        results.append(result)

    if escalation_config.emoji.enabled:
        result = _add_emoji_reaction(
            slack_client, channel_id, parent_ts, escalation_config.emoji.name,
        )
        results.append(result)

    return results


def _ping_victorops_oncall(sse_client, slack_client, channel_id, thread_ts, team):
    """Query the AI for VictorOps on-call via SSE, resolve to Slack user, and ping them."""
    try:
        from sse_client import ChatRequest, SSEEventType  # type: ignore[import]
    except ImportError:
        try:
            from ..sse_client import ChatRequest, SSEEventType
        except ImportError:
            logger.error(f"[{thread_ts}] VictorOps: cannot import SSE client")
            slack_client.chat_postMessage(
                channel=channel_id, thread_ts=thread_ts,
                text=f"Could not determine on-call for team *{team}*. Please check VictorOps manually.",
            )
            return "victorops: sse_client import error"

    try:
        prompt = (
            f"RESPOND IN 1 WORD THAT IS USER EMAIL. "
            f"WHO IS ON CALL FOR TEAM {team}?"
        )
        logger.info(f"[{thread_ts}] VictorOps: querying on-call for team {team}")
        oncall_email = None
        accumulated_text = []

        request = ChatRequest(message=prompt, source="slack")
        for event in sse_client.stream_chat(request):
            if event.type == SSEEventType.TEXT_MESSAGE_CONTENT and event.delta:
                accumulated_text.append(event.delta)
            elif event.type == SSEEventType.RUN_FINISHED:
                break

        full_text = "".join(accumulated_text).strip()
        logger.debug(f"[{thread_ts}] VictorOps: raw SSE response: {full_text!r}")

        if full_text:
            email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', full_text)
            if email_match:
                oncall_email = email_match.group(0)

        if not oncall_email:
            logger.warning(f"[{thread_ts}] VictorOps: no email found in AI response for team {team}")
            slack_client.chat_postMessage(
                channel=channel_id, thread_ts=thread_ts,
                text=f"Could not determine on-call for team *{team}*. Please check VictorOps manually.",
            )
            return "victorops: could not determine on-call"

        # Resolve email to Slack user ID
        try:
            user_resp = slack_client.users_lookupByEmail(email=oncall_email)
            oncall_slack_id = user_resp["user"]["id"]
            slack_client.chat_postMessage(
                channel=channel_id, thread_ts=thread_ts,
                text=f"<@{oncall_slack_id}> — a user requested human help in this thread (on-call for *{team}*)",
            )
            return f"victorops: pinged {oncall_email} (<@{oncall_slack_id}>)"
        except Exception:
            slack_client.chat_postMessage(
                channel=channel_id, thread_ts=thread_ts,
                text=f"On-call for *{team}* is *{oncall_email}* but could not find their Slack account.",
            )
            return f"victorops: found {oncall_email} but no Slack account"

    except Exception as e:
        logger.exception(f"[{thread_ts}] VictorOps escalation failed: {e}")
        slack_client.chat_postMessage(
            channel=channel_id, thread_ts=thread_ts,
            text=f"Could not determine on-call for team *{team}*. Please check VictorOps manually.",
        )
        return f"victorops: error — {e}"


def _ping_users(slack_client, channel_id, thread_ts, user_ids):
    """Directly @-mention configured users/groups in the thread."""
    try:
        mentions = " ".join(f"<@{uid}>" for uid in user_ids)
        slack_client.chat_postMessage(
            channel=channel_id, thread_ts=thread_ts,
            text=f"{mentions} — a user requested human assistance in this thread",
        )
        return f"users: pinged {len(user_ids)} user(s)"
    except Exception as e:
        logger.exception(f"[{thread_ts}] User ping escalation failed: {e}")
        return f"users: error — {e}"


def _add_emoji_reaction(slack_client, channel_id, parent_ts, emoji_name):
    """Add an emoji reaction to the parent message."""
    try:
        slack_client.reactions_add(
            name=emoji_name, channel=channel_id, timestamp=parent_ts,
        )
        return f"emoji: added :{emoji_name}:"
    except Exception as e:
        logger.exception(f"[{parent_ts}] Emoji escalation failed: {e}")
        return f"emoji: error — {e}"

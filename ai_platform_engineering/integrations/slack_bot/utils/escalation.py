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
    a2a_client,
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
            a2a_client, slack_client, channel_id, thread_ts,
            escalation_config.victorops.team,
            escalation_config.victorops.escalation_policy,
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


def _ping_victorops_oncall(a2a_client, slack_client, channel_id, thread_ts, team, escalation_policy=""):
    """Query the AI for VictorOps on-call, resolve to Slack user, and ping them."""
    try:
        policy_clause = f" under escalation policy {escalation_policy}" if escalation_policy else ""
        prompt = (
            f"Respond with 1 email only. "
            f"Who is on call RIGHT NOW for team {team}{policy_clause}?"
        )
        logger.info(f"[{thread_ts}] VictorOps: querying on-call for team {team}")
        oncall_email = None
        raw_responses = []
        for event_data in a2a_client.send_message_stream(message_text=prompt):
            # Look for text content in artifact events
            if isinstance(event_data, dict) and "artifact" in event_data:
                artifact = event_data["artifact"]
                artifact_name = artifact.get("name", "")
                parts = artifact.get("parts", [])

                for part in parts:
                    if part.get("kind") == "text" and part.get("text", "").strip():
                        text = part["text"].strip()
                        # Only capture final_result artifacts for email extraction
                        if artifact_name == "final_result":
                            raw_responses.append(text)
                            # Extract email pattern from response
                            email_match = re.search(r'[\w.+-]+@[\w-]+\.[\w.]+', text)
                            if email_match:
                                oncall_email = email_match.group(0)

        logger.debug(f"[{thread_ts}] VictorOps: extracted text responses: {raw_responses}")
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

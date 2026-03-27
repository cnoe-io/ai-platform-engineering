# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
CAIPE Slack Bot - Entry Point

A Slack bot that uses the A2A protocol to communicate with the CAIPE supervisor.
Supports @mention queries, Q&A mode, AI alert processing, HITL forms, and feedback.
"""

import os
import sys
import time

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from loguru import logger
from utils.config import config
from utils import utils
from utils import ai
from utils import slack_context
from utils import slack_formatter
from utils.hitl_handler import HITLCallbackHandler

from a2a_client import A2AClient
from utils.session_manager import SessionManager
from utils.langfuse_client import FeedbackClient
from utils.scoring import submit_feedback_score
from utils.authorization import UserAuthorizer

app = App(token=os.environ.get("SLACK_INTEGRATION_BOT_TOKEN", os.environ.get("SLACK_BOT_TOKEN", "")))
APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))

# Initialize OAuth2 auth client if enabled
AUTH_ENABLED = os.environ.get("SLACK_INTEGRATION_ENABLE_AUTH", "false").lower() == "true"

auth_client = None
if AUTH_ENABLED:
    from utils.oauth2_client import OAuth2ClientCredentials
    try:
        auth_client = OAuth2ClientCredentials.from_env()
        logger.info("OAuth2 client credentials auth enabled for A2A requests")
    except RuntimeError as e:
        logger.error(f"Failed to initialize OAuth2 auth: {e}")
        raise
else:
    logger.info("A2A auth disabled (set SLACK_INTEGRATION_ENABLE_AUTH=true to enable)")

# Initialize A2A client - CAIPE_URL is required
CAIPE_URL = os.environ.get("CAIPE_URL")
if not CAIPE_URL:
    raise ValueError("CAIPE_URL environment variable is required")
a2a_client = A2AClient(CAIPE_URL, timeout=300, auth_client=auth_client)

# Initialize session manager (auto-selects MongoDB or in-memory based on MONGODB_URI env var)
session_manager = SessionManager()
logger.info(f"Session store type: {session_manager.get_store_type()}")

# Initialize Langfuse feedback client (optional for local development)
LANGFUSE_SCORING_ENABLED = os.environ.get("SLACK_INTEGRATION_LANGFUSE_ENABLED", os.environ.get("LANGFUSE_SCORING_ENABLED", "false")).lower() == "true"
feedback_client = FeedbackClient() if LANGFUSE_SCORING_ENABLED else None
if LANGFUSE_SCORING_ENABLED:
    logger.info("Langfuse feedback scoring enabled")
else:
    logger.info("Langfuse feedback scoring disabled (set LANGFUSE_SCORING_ENABLED=true to enable)")

hitl_handler = HITLCallbackHandler(a2a_client, session_manager)
authorizer = UserAuthorizer(channel_configs=config.channels)

max_retries = int(os.environ.get("CAIPE_CONNECT_RETRIES", "10"))
retry_delay = int(os.environ.get("CAIPE_CONNECT_RETRY_DELAY", "6"))

for attempt in range(1, max_retries + 1):
    try:
        logger.info(f"Connecting to {APP_NAME} at {CAIPE_URL} (attempt {attempt}/{max_retries})")
        agent_card = a2a_client.get_agent_card()
        logger.info(
            f"Connected to agent: {agent_card.get('name', 'Unknown')}, "
            f"version: {agent_card.get('version', 'Unknown')}"
        )
        break
    except Exception as e:
        if attempt < max_retries:
            logger.warning(f"Supervisor not ready, retrying in {retry_delay}s...")
            time.sleep(retry_delay)
        else:
            logger.error(
                f"Failed to connect to {APP_NAME} after {max_retries} attempts: {e}."
            )
            sys.exit(1)


# =============================================================================
# @mention handler (manually invoke CAIPE)
# =============================================================================
@app.event("app_mention")
def handle_mention(event, say, client):
    """Handle @mentions of the bot to query CAIPE."""
    try:
        if event.get("edited") or event.get("subtype") == "message_changed":
            logger.debug("Skipping edited @mention message")
            return

        channel_id = event.get("channel")

        if not utils.check_has_jira_info(channel_id):
            logger.info(f"Channel {channel_id} has no config, ignoring @mention")
            return

        channel_config = config.channels[channel_id]
        if not channel_config.ai_enabled:
            logger.info(f"Channel {channel_id} does not have ai_enabled=true, ignoring @mention")
            return

        thread_ts = event.get("thread_ts") or event.get("ts")
        user_id = event.get("user")

        if not utils.verify_thread_exists(client, channel_id, thread_ts):
            logger.warning(f"[{thread_ts}] Ignoring @mention — parent message was deleted")
            return

        message_text = slack_context.extract_message_text(event)

        user_name, user_email = utils.get_message_author_info(event, client)

        logger.info(
            f"[{thread_ts}] CAIPE was invoked by User: {user_name} ({user_id or event.get('bot_id')}), "
            f"Email: {user_email}, Channel: {channel_id}, Thread: {thread_ts}"
        )

        if not message_text:
            say(text="Please include a question or message!", thread_ts=thread_ts)
            return

        bot_info = client.auth_test()
        bot_user_id = bot_info.get("user_id")

        admin_cmd = authorizer.parse_admin_command(
            event.get("text", ""), bot_user_id
        )
        if admin_cmd:
            _handle_admin_command(
                admin_cmd, user_id, channel_id, thread_ts, client
            )
            return

        if not authorizer.is_authorized(user_id, channel_id):
            logger.info(f"[{thread_ts}] Unauthorized user {user_id} in {channel_id}")
            client.chat_postEphemeral(
                channel=channel_id,
                user=user_id,
                text=authorizer.get_denial_message(user_id),
            )
            return

        context_message = message_text
        if event.get("thread_ts"):
            context_message = slack_context.build_thread_context(
                app, channel_id, thread_ts, message_text, bot_user_id
            )

        context_id = session_manager.get_context_id(thread_ts)

        is_humble_followup = session_manager.is_skipped(thread_ts)
        if is_humble_followup:
            logger.info(f"[{thread_ts}] Detected humble followup - thread was previously skipped")
            session_manager.clear_skipped(thread_ts)

        if is_humble_followup:
            mention_prompt = config.defaults.humble_followup_prompt
        elif channel_config.custom_prompt:
            mention_prompt = channel_config.custom_prompt
        else:
            mention_prompt = config.defaults.default_mention_prompt
        final_message = mention_prompt.format(message_text=context_message)

        if config.defaults.response_style_instruction not in final_message:
            final_message += "\n\n" + config.defaults.response_style_instruction

        request_metadata = {}
        if user_email:
            final_message = f"The user email is {user_email}\n\n{final_message}"
            request_metadata["user_email"] = user_email

        team_id = event.get("team")

        result = ai.stream_a2a_response(
            a2a_client=a2a_client,
            slack_client=client,
            channel_id=channel_id,
            thread_ts=thread_ts,
            message_text=final_message,
            team_id=team_id,
            user_id=user_id,
            context_id=context_id,
            metadata=request_metadata if request_metadata else None,
            session_manager=session_manager,
        )

        if isinstance(result, dict) and result.get("retry_needed"):
            original_error = result.get("error", "Unknown error")
            logger.warning(f"[{thread_ts}] Request failed, showing retry button: {original_error[:100]}")

            client.chat_postMessage(
                channel=channel_id,
                thread_ts=thread_ts,
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "Something went wrong - some tools or subagents may have timed out. Would you like to try again?",
                        },
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Retry"},
                                "style": "primary",
                                "action_id": "caipe_retry",
                                "value": f"{channel_id}|{thread_ts}",
                            },
                        ],
                    },
                ],
                text="Something went wrong. Click Retry to try again.",
            )

        logger.info(f"[{thread_ts}] Completed CAIPE request for {user_name}")

    except Exception as e:
        logger.exception(f"Error handling CAIPE mention: {e}")
        try:
            say(
                blocks=slack_formatter.format_error_message(str(e)),
                text=f"Error: {e}",
                thread_ts=event.get("thread_ts") or event.get("ts"),
            )
        except Exception as say_error:
            logger.exception(f"Failed to send error message: {say_error}")


# =============================================================================
# Admin commands (authorize / revoke / list)
# =============================================================================
def _handle_admin_command(cmd, user_id, channel_id, thread_ts, client):
    """Process an admin command parsed from an @mention."""
    action = cmd["action"]
    target = cmd.get("target_user", "")

    if not authorizer.is_admin(user_id):
        client.chat_postEphemeral(
            channel=channel_id,
            user=user_id,
            text="Only admins can run authorization commands.",
        )
        return

    if action == "list":
        info = authorizer.list_authorized()
        lines = [
            f"*Authorization mode:* `{info['mode']}`",
            f"*Admins:* {', '.join(f'<@{u}>' for u in info['admins']) or '_none_'}",
            f"*Static allow list:* {', '.join(f'<@{u}>' for u in info['static_allowed']) or '_none_'}",
            f"*Dynamic grants:* {', '.join(f'<@{u}>' for u in info['dynamic_grants']) or '_none_'}",
            f"*Denied:* {', '.join(f'<@{u}>' for u in info['denied']) or '_none_'}",
        ]
        client.chat_postEphemeral(
            channel=channel_id,
            user=user_id,
            text="\n".join(lines),
        )
        return

    if not target:
        client.chat_postEphemeral(
            channel=channel_id, user=user_id,
            text=f"Usage: `@caipe {action} @user`",
        )
        return

    if action == "authorize":
        msg = authorizer.authorize_user(target, granted_by=user_id)
    else:
        msg = authorizer.revoke_user(target, revoked_by=user_id)

    client.chat_postMessage(
        channel=channel_id, thread_ts=thread_ts, text=msg,
    )
    logger.info(f"Admin {user_id} ran '{action}' on {target}: {msg}")


# =============================================================================
# Q&A Mode (auto respond to messages in channel, excluding bots)
# =============================================================================
def handle_qanda_message(event, say, client):
    try:
        channel_id = event.get("channel")
        thread_ts = event.get("ts")

        if not utils.verify_thread_exists(client, channel_id, thread_ts):
            logger.warning(f"[{thread_ts}] Ignoring Q&A message — parent message was deleted")
            return

        user_id = event.get("user")
        team_id = event.get("team")

        if user_id and not authorizer.is_authorized(user_id, channel_id):
            logger.debug(f"[{thread_ts}] Q&A skipped for unauthorized user {user_id}")
            return

        message_text = slack_context.extract_message_text(event)

        user_name, user_email = utils.get_message_author_info(event, client)

        logger.info(
            f"[{thread_ts}] Q&A MODE - User: {user_name} ({user_id or event.get('bot_id')}), "
            f"Email: {user_email}, Channel: {channel_id}, Question: {message_text}"
        )

        if not message_text.strip():
            return

        channel_config = config.channels[channel_id]
        default_config = channel_config.default
        if not default_config or not isinstance(default_config, dict):
            raise ValueError(f"Channel {channel_id} is missing required 'default' config")

        context_id = session_manager.get_context_id(thread_ts)

        final_message = channel_config.qanda.custom_prompt.format(message_text=message_text)
        request_metadata = {"channel_id": channel_id, "channel_config": default_config}
        if user_email:
            final_message = f"The user email is {user_email}\n\n{final_message}"
            request_metadata["user_email"] = user_email

        result = ai.stream_a2a_response(
            a2a_client=a2a_client,
            slack_client=client,
            channel_id=channel_id,
            thread_ts=thread_ts,
            message_text=final_message,
            team_id=team_id,
            user_id=user_id,
            context_id=context_id,
            metadata=request_metadata,
            session_manager=session_manager,
            overthink_mode=channel_config.qanda.overthink,
        )

        if isinstance(result, dict) and result.get("skipped"):
            reason = result.get("reason", "unknown")
            logger.info(f"[{thread_ts}] Overthink: skipped response ({reason}) for {user_name}")
            session_manager.set_skipped(thread_ts, True)
            return

        logger.info(f"[{thread_ts}] Completed Q&A request for {user_name}")

    except Exception as e:
        logger.exception(f"Error handling Q&A message: {e}")
        try:
            say(
                blocks=slack_formatter.format_error_message(str(e)),
                text=f"Error: {e}",
                thread_ts=event.get("ts"),
            )
        except Exception as say_error:
            logger.exception(f"Failed to send error message: {say_error}")


def handle_dm_message(event, say, client):
    """Handle direct messages to the bot."""
    try:
        if event.get("bot_id"):
            return

        channel_id = event.get("channel")
        thread_ts = event.get("thread_ts") or event.get("ts")

        if not utils.verify_thread_exists(client, channel_id, thread_ts):
            logger.warning(f"[{thread_ts}] Ignoring DM — parent message was deleted")
            return

        user_id = event.get("user")

        if user_id and not authorizer.is_authorized(user_id):
            say(text=authorizer.get_denial_message(user_id), thread_ts=thread_ts)
            return

        message_text = slack_context.extract_message_text(event)

        user_name, user_email = utils.get_message_author_info(event, client)

        logger.info(
            f"[{thread_ts}] DM from User: {user_name} ({user_id}), "
            f"Email: {user_email}, Message: {message_text}"
        )

        if not message_text or not message_text.strip():
            say(text="Please include a question or message!", thread_ts=thread_ts)
            return

        bot_info = client.auth_test()
        bot_user_id = bot_info.get("user_id")

        context_message = message_text
        if event.get("thread_ts"):
            context_message = slack_context.build_thread_context(
                app, event.get("channel"), thread_ts, message_text, bot_user_id
            )

        context_id = session_manager.get_context_id(thread_ts)

        final_message = config.defaults.default_mention_prompt.format(
            message_text=context_message
        )

        if config.defaults.response_style_instruction not in final_message:
            final_message += "\n\n" + config.defaults.response_style_instruction

        request_metadata = {}
        if user_email:
            final_message = f"The user email is {user_email}\n\n{final_message}"
            request_metadata["user_email"] = user_email

        team_id = event.get("team")

        result = ai.stream_a2a_response(
            a2a_client=a2a_client,
            slack_client=client,
            channel_id=event.get("channel"),
            thread_ts=thread_ts,
            message_text=final_message,
            team_id=team_id,
            user_id=user_id,
            context_id=context_id,
            metadata=request_metadata if request_metadata else None,
            session_manager=session_manager,
        )

        if isinstance(result, dict) and result.get("retry_needed"):
            original_error = result.get("error", "Unknown error")
            logger.warning(
                f"[{thread_ts}] DM request failed, showing retry button: {original_error[:100]}"
            )

            client.chat_postMessage(
                channel=event.get("channel"),
                thread_ts=thread_ts,
                blocks=[
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": "Something went wrong - some tools or subagents may have timed out. Would you like to try again?",
                        },
                    },
                    {
                        "type": "actions",
                        "elements": [
                            {
                                "type": "button",
                                "text": {"type": "plain_text", "text": "Retry"},
                                "style": "primary",
                                "action_id": "caipe_retry",
                                "value": f"{event.get('channel')}|{thread_ts}",
                            },
                        ],
                    },
                ],
                text="Something went wrong. Click Retry to try again.",
            )

        logger.info(f"[{thread_ts}] Completed DM request for {user_name}")

    except Exception as e:
        logger.exception(f"Error handling DM message: {e}")
        try:
            say(
                blocks=slack_formatter.format_error_message(str(e)),
                text=f"Error: {e}",
                thread_ts=event.get("thread_ts") or event.get("ts"),
            )
        except Exception as say_error:
            logger.exception(f"Failed to send error message: {say_error}")


@app.event("message")
def handle_message_events(body, say, client):
    event = body.get("event")
    if not event:
        return

    subtype = event.get("subtype")
    if subtype in ("message_deleted", "message_changed", "channel_join", "channel_leave"):
        return

    # Route DMs to dedicated handler
    channel_type = event.get("channel_type")
    if channel_type == "im" and not event.get("bot_id"):
        handle_dm_message(event, say, client)
        return

    channel_id = event.get("channel")
    is_bot = event.get("bot_id") is not None
    is_thread = event.get("thread_ts") is not None

    should_process_for_qanda = False
    if not is_bot and not is_thread:
        should_process_for_qanda = True
    elif is_bot and not is_thread and utils.check_has_jira_info(channel_id):
        channel_config = config.channels[channel_id]
        include_bots_config = channel_config.qanda.include_bots

        if channel_config.qanda.enabled and include_bots_config.enabled:
            if include_bots_config.bot_list is None:
                should_process_for_qanda = True
            else:
                bot_id = event.get("bot_id")
                bot_username = utils.get_username_by_bot_id(bot_id)
                if bot_username in include_bots_config.bot_list:
                    should_process_for_qanda = True

    if should_process_for_qanda:
        bot_info = client.auth_test()
        bot_user_id = bot_info.get("user_id")

        if f"<@{bot_user_id}>" in event.get("text", ""):
            return

        if utils.check_has_jira_info(channel_id):
            channel_config = config.channels[channel_id]
            if channel_config.ai_enabled and channel_config.qanda.enabled:
                handle_qanda_message(event, say, client)
                return

        return

    if not event.get("bot_id"):
        return

    thread_ts = event.get("thread_ts")
    message_ts = event.get("ts")
    if thread_ts and thread_ts != message_ts:
        return

    event = body["event"]
    channel_id = utils.get_current_channel_id(event)
    bot_id = event["bot_id"]
    bot_username = utils.get_username_by_bot_id(bot_id)
    if not utils.check_has_jira_info(channel_id):
        return

    channel_config = config.channels[channel_id]
    if channel_config.ai_alerts.enabled:
        alert_ts = event.get("ts", "unknown")
        logger.info(f"[{alert_ts}] Routing alert from {bot_username} to AI processing")
        default_config = channel_config.default
        if not default_config or not isinstance(default_config, dict):
            raise ValueError(f"Channel {channel_id} is missing required 'default' config")

        ai.handle_ai_alert_processing(
            a2a_client,
            client,
            event,
            channel_id,
            bot_username,
            default_config,
            session_manager,
            custom_prompt=channel_config.ai_alerts.custom_prompt,
        )


# =============================================================================
# HITL (Human-in-the-Loop) Form Action Handler
# =============================================================================
@app.action({"action_id": "hitl_form_.*"})
def handle_hitl_action(ack, body, client):
    ack()
    try:
        result = hitl_handler.handle_interaction(body, client)
        if result:
            logger.info(f"HITL action processed: {result}")
    except Exception as e:
        logger.exception(f"Error handling HITL action: {e}")


# =============================================================================
# Feedback Action Handler
# =============================================================================
@app.action("caipe_feedback")
def handle_caipe_feedback(ack, body, client):
    ack()
    try:
        user_id = body.get("user", {}).get("id")
        channel_id = body.get("channel", {}).get("id")
        message = body.get("message", {})
        message_ts = message.get("ts")
        thread_ts = message.get("thread_ts") or message_ts

        actions = body.get("actions", [])
        if not actions:
            return

        action = actions[0]
        value = action.get("value", "")
        feedback_type = value.split("|")[0] if "|" in value else value
        is_positive = feedback_type == "positive"

        feedback_value = "thumbs_up" if is_positive else "thumbs_down"
        submit_feedback_score(
            thread_ts=thread_ts, user_id=user_id, channel_id=channel_id,
            feedback_value=feedback_value, slack_client=client,
            session_manager=session_manager, config=config,
            feedback_client=feedback_client,
        )

        if is_positive:
            client.chat_postEphemeral(
                channel=channel_id, user=user_id, thread_ts=thread_ts,
                text="Thanks for the feedback! Glad it was helpful.",
            )
        else:
            refinement_blocks = [
                {"type": "section", "text": {"type": "mrkdwn", "text": "Sorry that wasn't helpful. What could be improved?"}},
                {
                    "type": "actions",
                    "elements": [
                        {"type": "button", "text": {"type": "plain_text", "text": "Wrong answer"}, "action_id": "caipe_feedback_wrong_answer", "value": f"{channel_id}|{thread_ts}"},
                        {"type": "button", "text": {"type": "plain_text", "text": "Other"}, "action_id": "caipe_feedback_other", "value": f"{channel_id}|{thread_ts}"},
                    ],
                },
            ]
            client.chat_postEphemeral(
                channel=channel_id, user=user_id, thread_ts=thread_ts,
                blocks=refinement_blocks, text="What could be improved?",
            )
    except Exception as e:
        logger.exception(f"Error handling feedback: {e}")


@app.action("caipe_feedback_more_detail")
def handle_feedback_more_detail(ack, body, client):
    ack()
    try:
        user_id = body.get("user", {}).get("id")
        action = body.get("actions", [{}])[0]
        parts = action.get("value", "").split("|")
        channel_id = parts[0] if len(parts) > 0 else None
        thread_ts = parts[1] if len(parts) > 1 else None
        if not channel_id or not thread_ts:
            return

        submit_feedback_score(
            thread_ts=thread_ts, user_id=user_id, channel_id=channel_id,
            feedback_value="needs_detail", slack_client=client,
            session_manager=session_manager, config=config,
            feedback_client=feedback_client,
        )

        client.chat_postEphemeral(channel=channel_id, user=user_id, thread_ts=thread_ts, text=f"Got it! Asking {APP_NAME} for more detail...")

        context_id = session_manager.get_context_id(thread_ts)
        team_id = body.get("team", {}).get("id")

        ai.stream_a2a_response(
            a2a_client=a2a_client, slack_client=client, channel_id=channel_id,
            thread_ts=thread_ts,
            message_text="The user wants more detail on your previous answer. Search for at least 5 additional sources beyond what you already cited. Keep your response to 2-3 short paragraphs. Focus on details you left out the first time. End with sources and links.",
            team_id=team_id, user_id=user_id, context_id=context_id,
            session_manager=session_manager, additional_footer=f"More detail requested by <@{user_id}>",
        )
    except Exception as e:
        logger.exception(f"Error handling more detail feedback: {e}")


@app.action("caipe_feedback_less_verbose")
def handle_feedback_less_verbose(ack, body, client):
    ack()
    try:
        user_id = body.get("user", {}).get("id")
        action = body.get("actions", [{}])[0]
        parts = action.get("value", "").split("|")
        channel_id = parts[0] if len(parts) > 0 else None
        thread_ts = parts[1] if len(parts) > 1 else None
        if not channel_id or not thread_ts:
            return

        submit_feedback_score(
            thread_ts=thread_ts, user_id=user_id, channel_id=channel_id,
            feedback_value="too_verbose", slack_client=client,
            session_manager=session_manager, config=config,
            feedback_client=feedback_client,
        )

        client.chat_postEphemeral(channel=channel_id, user=user_id, thread_ts=thread_ts, text=f"Got it! Asking {APP_NAME} for a more concise response...")

        context_id = session_manager.get_context_id(thread_ts)
        team_id = body.get("team", {}).get("id")

        ai.stream_a2a_response(
            a2a_client=a2a_client, slack_client=client, channel_id=channel_id,
            thread_ts=thread_ts,
            message_text="Please provide a more concise response. Summarize the key points briefly. Be direct and to the point.",
            team_id=team_id, user_id=user_id, context_id=context_id,
            session_manager=session_manager, additional_footer=f"Shorter response requested by <@{user_id}>",
        )
    except Exception as e:
        logger.exception(f"Error handling less verbose feedback: {e}")


@app.action("caipe_retry")
def handle_caipe_retry(ack, body, client):
    ack()
    try:
        user_id = body.get("user", {}).get("id")
        action = body.get("actions", [{}])[0]
        parts = action.get("value", "").split("|")
        channel_id = parts[0] if len(parts) > 0 else None
        thread_ts = parts[1] if len(parts) > 1 else None
        if not channel_id or not thread_ts:
            return

        submit_feedback_score(
            thread_ts=thread_ts, user_id=user_id, channel_id=channel_id,
            feedback_value="retry", slack_client=client,
            session_manager=session_manager, config=config,
            feedback_client=feedback_client,
        )

        user_name, user_email = utils.get_message_author_info(body.get("user", {}), client)
        team_id = body.get("team", {}).get("id")
        bot_info = client.auth_test()
        bot_user_id = bot_info.get("user_id")

        thread_context = slack_context.build_thread_context(app, channel_id, thread_ts, "", bot_user_id)

        if not utils.check_has_jira_info(channel_id):
            return

        channel_config = config.channels[channel_id]
        retry_message = ai.RETRY_PROMPT_PREFIX + channel_config.qanda.custom_prompt.format(message_text=thread_context)

        request_metadata = {}
        if user_email:
            retry_message = f"The user email is {user_email}\n\n{retry_message}"
            request_metadata["user_email"] = user_email

        ai.stream_a2a_response(
            a2a_client=a2a_client, slack_client=client, channel_id=channel_id,
            thread_ts=thread_ts, message_text=retry_message, team_id=team_id,
            user_id=user_id, context_id=None, metadata=request_metadata if request_metadata else None,
            session_manager=session_manager, additional_footer=f"Retried by <@{user_id}>",
        )
    except Exception as e:
        logger.exception(f"Error handling retry: {e}")


def _open_feedback_modal(ack, body, client, feedback_type):
    ack()
    try:
        trigger_id = body.get("trigger_id")
        action = body.get("actions", [{}])[0]
        value = action.get("value", "")

        client.views_open(
            trigger_id=trigger_id,
            view={
                "type": "modal",
                "callback_id": "caipe_wrong_answer_modal",
                "private_metadata": f"{value}|{feedback_type}",
                "title": {"type": "plain_text", "text": "What was wrong?"},
                "submit": {"type": "plain_text", "text": "Submit"},
                "close": {"type": "plain_text", "text": "Cancel"},
                "blocks": [
                    {"type": "section", "text": {"type": "mrkdwn", "text": f"Tell {APP_NAME} what went wrong and it'll try again right away."}},
                    {
                        "type": "input",
                        "block_id": "correction_input",
                        "element": {
                            "type": "plain_text_input",
                            "action_id": "correction_text",
                            "multiline": True,
                            "placeholder": {"type": "plain_text", "text": "e.g., 'The API endpoint mentioned doesn't exist'"},
                        },
                        "label": {"type": "plain_text", "text": "What should be corrected?"},
                    },
                ],
            },
        )
    except Exception as e:
        logger.exception(f"Error opening feedback modal: {e}")


@app.action("caipe_feedback_wrong_answer")
def handle_feedback_wrong_answer(ack, body, client):
    _open_feedback_modal(ack, body, client, feedback_type="wrong_answer")


@app.action("caipe_feedback_other")
def handle_feedback_other(ack, body, client):
    _open_feedback_modal(ack, body, client, feedback_type="other")


@app.view("caipe_wrong_answer_modal")
def handle_wrong_answer_submission(ack, body, client, view):
    ack()
    try:
        user_id = body.get("user", {}).get("id")
        team_id = body.get("team", {}).get("id")

        private_metadata = view.get("private_metadata", "")
        parts = private_metadata.split("|")
        channel_id = parts[0] if len(parts) > 0 else None
        thread_ts = parts[1] if len(parts) > 1 else None
        feedback_type = parts[2] if len(parts) > 2 else "wrong_answer"

        if not channel_id or not thread_ts:
            return

        values = view.get("state", {}).get("values", {})
        correction_text = values.get("correction_input", {}).get("correction_text", {}).get("value", "")
        if not correction_text:
            return

        submit_feedback_score(
            thread_ts=thread_ts, user_id=user_id, channel_id=channel_id,
            feedback_value=feedback_type, slack_client=client,
            session_manager=session_manager, config=config,
            feedback_client=feedback_client, comment=correction_text,
        )

        client.chat_postEphemeral(
            channel=channel_id, user=user_id, thread_ts=thread_ts,
            text=f"Got it! Asking {APP_NAME} to correct the response based on your feedback...",
        )

        context_id = session_manager.get_context_id(thread_ts)
        correction_prompt = (
            f"The user indicated your previous response was incorrect and provided the following "
            f'IMPORTANT context: "{correction_text}"\n\n'
            f"Please carefully review this feedback and provide a corrected response."
        )

        ai.stream_a2a_response(
            a2a_client=a2a_client, slack_client=client, channel_id=channel_id,
            thread_ts=thread_ts, message_text=correction_prompt, team_id=team_id,
            user_id=user_id, context_id=context_id, session_manager=session_manager,
            additional_footer=f"Correction requested by <@{user_id}>",
        )
    except Exception as e:
        logger.exception(f"Error handling wrong answer submission: {e}")


@app.event("reaction_added")
def handle_reaction_added(event, logger):
    pass


@app.event("reaction_removed")
def handle_reaction_removed(event, logger):
    pass


@app.error
def custom_error_handler(error, body, logger):
    logger.exception(f"Error: {error}, Request body: {body}")


if __name__ == "__main__":
    bot_mode = os.environ.get("SLACK_INTEGRATION_BOT_MODE", os.environ.get("SLACK_BOT_MODE", "socket")).lower()

    if bot_mode == "http":
        logger.info(f"Starting {APP_NAME} Slack Bot in HTTP mode on port 3000")
        app.start(port=int(os.environ.get("PORT", 3000)))
    else:
        logger.info(f"Starting {APP_NAME} Slack Bot in Socket Mode")
        app_token = os.environ.get("SLACK_INTEGRATION_APP_TOKEN", os.environ.get("SLACK_APP_TOKEN", ""))
        handler = SocketModeHandler(app, app_token)
        handler.start()

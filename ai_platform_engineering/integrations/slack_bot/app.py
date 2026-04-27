# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
CAIPE Slack Bot - Entry Point

A Slack bot that communicates with dynamic agents via AG-UI protocol.
Supports @mention queries, Q&A mode, AI alert processing, HITL forms, and feedback.
"""

import os
import re
import sys
import time
import requests as _requests

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from loguru import logger
from utils.config import config
from utils import utils
from utils import ai
from utils import slack_context
from utils import slack_formatter
from utils.hitl_handler import HITLCallbackHandler

from sse_client import SSEClient
from utils.session_manager import SessionManager
from utils.scoring import submit_feedback_score
from utils.config_models import get_escalation_config

app = App(token=os.environ.get("SLACK_INTEGRATION_BOT_TOKEN", os.environ.get("SLACK_BOT_TOKEN", "")))
APP_NAME = os.environ.get("SLACK_INTEGRATION_APP_NAME", os.environ.get("APP_NAME", "CAIPE"))
_WORKSPACE_URL = os.environ.get("SLACK_WORKSPACE_URL", "").rstrip("/")


def _msg_link(channel_id: str, ts: str) -> str:
  if not _WORKSPACE_URL or not ts:
    return ""
  return f" {_WORKSPACE_URL}/archives/{channel_id}/p{ts.replace('.', '')}"


AUTH_ENABLED = os.environ.get("SLACK_INTEGRATION_ENABLE_AUTH", "false").lower() == "true"

SLACK_WORKSPACE_URL = os.environ.get("SLACK_WORKSPACE_URL", "")
logger.info("SLACK_WORKSPACE_URL={}", SLACK_WORKSPACE_URL or "(not set)")

auth_client = None
if AUTH_ENABLED:
  from utils.oauth2_client import OAuth2ClientCredentials

  try:
    auth_client = OAuth2ClientCredentials.from_env()
    logger.info("OAuth2 client credentials auth enabled for dynamic agents requests")
  except RuntimeError as e:
    logger.error(f"Failed to initialize OAuth2 auth: {e}")
    raise
else:
  logger.info("Auth disabled (set SLACK_INTEGRATION_ENABLE_AUTH=true to enable)")

# Initialize SSE client - CAIPE_API_URL is required
CAIPE_API_URL = os.environ.get("CAIPE_API_URL")
if not CAIPE_API_URL:
  raise ValueError("CAIPE_API_URL environment variable is required")

sse_client = SSEClient(CAIPE_API_URL, timeout=300, auth_client=auth_client)
logger.info(f"SSE client initialized at {CAIPE_API_URL}")

# Initialize session manager (in-memory only — conversation IDs are deterministic)
session_manager = SessionManager()
logger.info(f"Session store type: {session_manager.get_store_type()}")

hitl_handler = HITLCallbackHandler(sse_client)

max_retries = int(os.environ.get("CAIPE_CONNECT_RETRIES", "10"))
retry_delay = int(os.environ.get("CAIPE_CONNECT_RETRY_DELAY", "6"))

for attempt in range(1, max_retries + 1):
  try:
    logger.info(f"Connecting to {APP_NAME} at {CAIPE_API_URL} (attempt {attempt}/{max_retries})")
    health_resp = _requests.get(f"{CAIPE_API_URL.rstrip('/')}/api/health", timeout=10)
    if health_resp.ok:
      logger.info(f"Connected to {APP_NAME} API (status {health_resp.status_code})")
    else:
      raise Exception(f"Health check returned {health_resp.status_code}: {health_resp.text}")
    break
  except Exception as e:
    if attempt < max_retries:
      logger.warning(f"{APP_NAME} API not ready, retrying in {retry_delay}s...")
      time.sleep(retry_delay)
    else:
      logger.error(f"Failed to connect to {APP_NAME} after {max_retries} attempts: {e}.")
      sys.exit(1)


def _agent_listens_to(agent_listen, requested):
  """Check if an agent's listen mode satisfies the requested mode."""
  return agent_listen == "all" or agent_listen == requested


def _match_agents(channel_config, is_bot, bot_username=None, user_id=None, listen=None):
  """Return all agents configured for this sender type and listen mode."""
  matched = []
  for agent in channel_config.agents:
    if is_bot and agent.bots:
      if not agent.bots.enabled:
        continue
      if listen and not _agent_listens_to(agent.bots.listen, listen):
        continue
      if agent.bots.bot_list is not None and bot_username not in agent.bots.bot_list:
        continue
      matched.append(agent)
    elif not is_bot and agent.users:
      if not agent.users.enabled:
        continue
      if listen and not _agent_listens_to(agent.users.listen, listen):
        continue
      if agent.users.user_list is not None and user_id not in agent.users.user_list:
        continue
      matched.append(agent)
  return matched


def _resolve_agent_id(channel_config=None) -> str:
  """Resolve a fallback agent_id for feedback/retry actions that lack agent context.

  Precedence: first agent binding in the channel, then global default.
  """
  if channel_config and channel_config.agents:
    return channel_config.agents[0].agent_id
  if config.defaults.default_agent_id:
    return config.defaults.default_agent_id
  logger.warning("No agent_id configured — using empty string")
  return ""


def _resolve_escalation(channel_config, agent_id: str | None = None):
  """Resolve escalation config, optionally scoped to a specific agent.

  When *agent_id* is provided, only that agent's escalation config is
  considered — this avoids leaking one agent's escalation settings into
  another.  When *agent_id* is ``None`` (feedback buttons that don't
  know which agent responded), falls back to the first agent that has
  escalation configured.
  """
  if not channel_config:
    return None
  for agent in channel_config.agents:
    if agent_id and agent.agent_id != agent_id:
      continue
    esc = get_escalation_config(agent)
    if esc:
      return esc
  return None


def _get_agent_id_for_dm() -> str:
  """Resolve agent_id for DMs: dm_agent_id -> default_agent_id -> empty."""
  if config.defaults.dm_agent_id:
    return config.defaults.dm_agent_id
  if config.defaults.default_agent_id:
    return config.defaults.default_agent_id
  logger.warning("No agent_id configured for DMs — using empty string")
  return ""


def _resolve_conversation_id(thread_ts: str, channel_id: str, agent_id: str = "", owner_id: str = "") -> str:
  """Resolve a Slack thread to its server-side conversation_id via idempotency_key lookup.

  Calls create_conversation with the thread_ts as idempotency_key. If the
  conversation already exists the server returns it (created=false); otherwise
  a new one is created. This ensures all handlers in a thread share the same
  conversation_id used by UI and LangGraph checkpoints.
  """
  channel_config = config.channels.get(channel_id)
  channel_name = channel_config.name if channel_config else None
  conv_result = sse_client.create_conversation(
    title="Slack Thread",
    agent_id=agent_id,
    owner_id=owner_id or None,
    idempotency_key=thread_ts,
    metadata={
      "thread_ts": thread_ts,
      "channel_id": channel_id,
      **({"channel_name": channel_name} if channel_name else {}),
      **({"workspace_url": SLACK_WORKSPACE_URL} if SLACK_WORKSPACE_URL else {}),
    },
  )
  return conv_result["conversation_id"]


def _track_interaction(
  conversation_id: str,
  thread_ts: str,
  channel_id: str,
  interaction_type: str,
  user_id: str,
  user_email: str | None = None,
  user_name: str | None = None,
  response_time_ms: int | None = None,
  last_processed_ts: str | None = None,
) -> None:
  """PATCH conversation metadata with interaction tracking fields.

  Called after each successful AI response to record who interacted,
  how long it took, and what kind of interaction it was.  Also updates
  ``last_processed_ts`` for delta context on follow-ups.
  """
  metadata: dict[str, object] = {
    "interaction_type": interaction_type,
    "user_id": user_id,
  }
  if user_email:
    metadata["user_email"] = user_email
  if user_name:
    metadata["user_name"] = user_name
  if response_time_ms is not None:
    metadata["response_time_ms"] = response_time_ms

  # Build Slack permalink
  workspace = _WORKSPACE_URL
  if workspace and thread_ts:
    metadata["slack_link"] = f"{workspace}/archives/{channel_id}/p{thread_ts.replace('.', '')}"

  if last_processed_ts:
    metadata["last_processed_ts"] = last_processed_ts

  try:
    sse_client.update_conversation_metadata(conversation_id, metadata)
  except Exception:
    logger.warning(f"[{thread_ts}] Failed to update interaction metadata")


def _call_ai(
  client,
  channel_id,
  thread_ts,
  message_text,
  user_id,
  team_id,
  agent_id,
  conversation_id,
  triggered_by_user_id=None,
  additional_footer=None,
  overthink_config=None,
  escalation_config=None,
  client_context=None,
):
  """Route to stream_response or invoke_response based on user type."""
  logger.info(f"[{thread_ts}] _call_ai: conv={conversation_id} agent={agent_id} user={user_id} overthink={overthink_config}")
  can_stream = user_id and user_id[0] in ("U", "W")

  if can_stream:
    return ai.stream_response(
      sse_client=sse_client,
      slack_client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=message_text,
      team_id=team_id,
      user_id=user_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      triggered_by_user_id=triggered_by_user_id,
      additional_footer=additional_footer,
      overthink_config=overthink_config,
      escalation_config=escalation_config,
      client_context=client_context,
    )
  else:
    return ai.invoke_response(
      sse_client=sse_client,
      slack_client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=message_text,
      agent_id=agent_id,
      conversation_id=conversation_id,
      triggered_by_user_id=triggered_by_user_id,
      additional_footer=additional_footer,
      escalation_config=escalation_config,
      client_context=client_context,
    )


# =============================================================================
# @mention handler (manually invoke CAIPE)
# =============================================================================
@app.event("app_mention")
def handle_mention(event, say, client):
  """Handle @mentions of the bot to query CAIPE."""
  try:
    t0 = time.monotonic()
    if event.get("edited") or event.get("subtype") == "message_changed":
      logger.debug("Skipping edited @mention message")
      return

    channel_id = event.get("channel")

    if not utils.is_configured_channel(channel_id):
      logger.info(f"Channel {channel_id} has no config, ignoring @mention")
      return

    channel_config = config.channels[channel_id]

    thread_ts = event.get("thread_ts") or event.get("ts")
    user_id = event.get("user")

    if not utils.verify_thread_exists(client, channel_id, thread_ts):
      logger.warning(f"[{thread_ts}] Ignoring @mention — parent message was deleted")
      return

    message_text = slack_context.extract_message_text(event)

    user_name, user_email = utils.get_message_author_info(event, client)

    logger.info(f"[{thread_ts}] CAIPE was invoked by User: {user_name} ({user_id or event.get('bot_id')}), Email: {user_email}, Channel: {channel_id}, Thread: {thread_ts}{_msg_link(channel_id, thread_ts)}")

    if not message_text:
      say(text="Please include a question or message!", thread_ts=thread_ts)
      return

    bot_info = client.auth_test()
    bot_user_id = bot_info.get("user_id")

    matches = _match_agents(channel_config, is_bot=False, user_id=user_id, listen="mention")
    agent_match = matches[0] if matches else None
    agent_id = agent_match.agent_id if agent_match else (config.defaults.default_agent_id or "")

    # Create or retrieve conversation via shared API (server owns ID generation).
    # Must happen BEFORE context building so we can use `created` to decide
    # full vs delta thread context.
    conv_result = sse_client.create_conversation(
      title=message_text[:50].strip() or "Slack Thread",
      agent_id=agent_id,
      owner_id=user_email or user_id,
      idempotency_key=thread_ts,
      metadata={
        "thread_ts": thread_ts,
        "channel_id": channel_id,
        "channel_name": channel_config.name,
        **({"workspace_url": SLACK_WORKSPACE_URL} if SLACK_WORKSPACE_URL else {}),
      },
    )
    conversation_id = conv_result["conversation_id"]
    conv_created = conv_result["created"]
    conv_metadata = conv_result.get("metadata", {})

    # Build thread context: full on first interaction, delta on follow-ups
    context_message = message_text
    if event.get("thread_ts"):
      if conv_created:
        context_message = slack_context.build_thread_context(app, channel_id, thread_ts, message_text, bot_user_id)
      else:
        since_ts = conv_metadata.get("last_processed_ts", thread_ts)
        context_message = slack_context.build_delta_context(app, channel_id, thread_ts, message_text, bot_user_id, since_ts=since_ts)

    is_humble_followup = session_manager.is_skipped(thread_ts)
    if is_humble_followup:
      logger.info(f"[{thread_ts}] Detected humble followup - thread was previously skipped")
      session_manager.clear_skipped(thread_ts)

    channel_info = utils.get_channel_context(client, channel_id, session_manager)

    client_context = {
      "source": "slack",
      "channel_type": "channel",
      "channel_name": channel_config.name,
      "channel_topic": channel_info.get("topic", ""),
      "channel_purpose": channel_info.get("purpose", ""),
      "humble_followup": is_humble_followup,
    }
    if user_email:
      client_context["user_email"] = user_email

    team_id = event.get("team")
    esc_config = get_escalation_config(agent_match) if agent_match else None

    result = _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=context_message,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      escalation_config=esc_config,
      client_context=client_context,
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

    _track_interaction(
      conversation_id=conversation_id,
      thread_ts=thread_ts,
      channel_id=channel_id,
      interaction_type="mention",
      user_id=user_id,
      user_email=user_email,
      user_name=user_name,
      response_time_ms=int((time.monotonic() - t0) * 1000),
      last_processed_ts=event.get("ts"),
    )

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


def _route_to_agent(event, say, client, channel_config, agent_match, is_bot, bot_username=None):
  """Unified handler for both user and bot messages."""
  try:
    t0 = time.monotonic()
    channel_id = event.get("channel")
    thread_ts = event.get("ts")

    if event.get("subtype") and event.get("subtype") != "bot_message":
      return

    if not utils.verify_thread_exists(client, channel_id, thread_ts):
      logger.warning(f"[{thread_ts}] Ignoring message — parent message was deleted")
      return

    if is_bot:
      _, bot_user_id = utils.get_bot_info_by_id(event.get("bot_id"))
      user_id = bot_user_id or event.get("bot_id")
    else:
      user_id = event.get("user")
    team_id = event.get("team")
    message_text = slack_context.extract_message_text(event)

    user_name, user_email = utils.get_message_author_info(event, client)
    sender_label = "bot" if is_bot else "user"

    logger.info(f"[{thread_ts}] Routing {sender_label} message to agent={agent_match.agent_id} - User: {user_name} ({user_id}), Channel: {channel_id}{_msg_link(channel_id, thread_ts)}")

    if not message_text or not message_text.strip():
      return

    agent_id = agent_match.agent_id

    conv_result = sse_client.create_conversation(
      title=message_text[:50].strip() or "Slack Thread",
      agent_id=agent_id,
      owner_id=user_email or user_id,
      idempotency_key=thread_ts,
      metadata={
        "thread_ts": thread_ts,
        "channel_id": channel_id,
        "channel_name": channel_config.name,
        **({"workspace_url": SLACK_WORKSPACE_URL} if SLACK_WORKSPACE_URL else {}),
      },
    )
    conversation_id = conv_result["conversation_id"]

    channel_info = utils.get_channel_context(client, channel_id, session_manager)

    overthink = None
    if is_bot and agent_match.bots:
      overthink = agent_match.bots.overthink
    elif not is_bot and agent_match.users:
      overthink = agent_match.users.overthink

    client_context = {
      "source": "slack",
      "channel_type": "channel",
      "channel_name": channel_config.name,
      "channel_topic": channel_info.get("topic", ""),
      "channel_purpose": channel_info.get("purpose", ""),
      "overthink": bool(overthink and overthink.enabled),
      "timestamp": thread_ts,
    }
    if user_email:
      client_context["user_email"] = user_email
    if bot_username:
      client_context["bot_username"] = bot_username
    if is_bot:
      if event.get("blocks"):
        client_context["blocks"] = event["blocks"]
      if event.get("attachments"):
        client_context["attachments"] = event["attachments"]

    esc_config = get_escalation_config(agent_match)

    result = _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=message_text,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      overthink_config=overthink,
      escalation_config=esc_config,
      client_context=client_context,
    )

    if isinstance(result, dict) and result.get("skipped"):
      reason = result.get("reason", "unknown")
      logger.info(f"[{thread_ts}] Overthink: skipped response ({reason}) for {user_name}")
      session_manager.set_skipped(thread_ts, True)
      return

    logger.info(f"[{thread_ts}] Completed {sender_label} request for {user_name}")

    _track_interaction(
      conversation_id=conversation_id,
      thread_ts=thread_ts,
      channel_id=channel_id,
      interaction_type=sender_label,
      user_id=user_id,
      user_email=user_email,
      user_name=user_name,
      response_time_ms=int((time.monotonic() - t0) * 1000),
    )

  except Exception as e:
    logger.exception(f"Error handling {sender_label} message: {e}")
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
    t0 = time.monotonic()
    if event.get("bot_id"):
      return

    channel_id = event.get("channel")
    thread_ts = event.get("thread_ts") or event.get("ts")

    if not utils.verify_thread_exists(client, channel_id, thread_ts):
      logger.warning(f"[{thread_ts}] Ignoring DM — parent message was deleted")
      return

    user_id = event.get("user")
    message_text = slack_context.extract_message_text(event)

    user_name, user_email = utils.get_message_author_info(event, client)

    logger.info(f"[{thread_ts}] DM from User: {user_name} ({user_id}), Email: {user_email}, Message: {message_text}{_msg_link(channel_id, thread_ts)}")

    if not message_text or not message_text.strip():
      say(text="Please include a question or message!", thread_ts=thread_ts)
      return

    bot_info = client.auth_test()
    bot_user_id = bot_info.get("user_id")

    agent_id = _get_agent_id_for_dm()
    if not agent_id:
      logger.error(f"[{thread_ts}] No agent_id configured for DMs — set SLACK_INTEGRATION_DM_AGENT_ID or SLACK_INTEGRATION_DEFAULT_AGENT_ID")
      say(text="Sorry, DMs aren't configured yet — no agent ID is set. Please contact an admin.", thread_ts=thread_ts)
      return

    # Create or retrieve conversation via shared API (server owns ID generation).
    # Must happen BEFORE context building so we can use `created` to decide
    # full vs delta thread context.
    conv_result = sse_client.create_conversation(
      title=message_text[:50].strip() or "Slack DM",
      agent_id=agent_id,
      owner_id=user_email or user_id,
      idempotency_key=thread_ts,
      metadata={
        "thread_ts": thread_ts,
        "channel_id": channel_id,
        "channel_type": "dm",
        **({"workspace_url": SLACK_WORKSPACE_URL} if SLACK_WORKSPACE_URL else {}),
      },
    )
    conversation_id = conv_result["conversation_id"]
    conv_created = conv_result["created"]
    conv_metadata = conv_result.get("metadata", {})

    # Build thread context: full on first interaction, delta on follow-ups
    context_message = message_text
    if event.get("thread_ts"):
      if conv_created:
        context_message = slack_context.build_thread_context(app, channel_id, thread_ts, message_text, bot_user_id)
      else:
        since_ts = conv_metadata.get("last_processed_ts", thread_ts)
        context_message = slack_context.build_delta_context(app, channel_id, thread_ts, message_text, bot_user_id, since_ts=since_ts)

    client_context = {
      "source": "slack",
      "channel_type": "dm",
    }
    if user_email:
      client_context["user_email"] = user_email

    team_id = event.get("team")

    result = _call_ai(
      client=client,
      channel_id=event.get("channel"),
      thread_ts=thread_ts,
      message_text=context_message,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      client_context=client_context,
    )

    if isinstance(result, dict) and result.get("retry_needed"):
      original_error = result.get("error", "Unknown error")
      logger.warning(f"[{thread_ts}] DM request failed, showing retry button: {original_error[:100]}")

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

    _track_interaction(
      conversation_id=conversation_id,
      thread_ts=thread_ts,
      channel_id=channel_id,
      interaction_type="dm",
      user_id=user_id,
      user_email=user_email,
      user_name=user_name,
      response_time_ms=int((time.monotonic() - t0) * 1000),
      last_processed_ts=event.get("ts"),
    )

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
  bot_id = event.get("bot_id")
  is_bot = bot_id is not None

  if not utils.is_configured_channel(channel_id):
    return

  channel_config = config.channels[channel_id]

  # Skip threaded user replies (handled by @mention); bots can post in threads
  is_thread = event.get("thread_ts") is not None
  if is_thread and not is_bot:
    return

  # Skip @mentions — handled by handle_mention
  bot_info = client.auth_test()
  bot_user_id = bot_info.get("user_id")
  if f"<@{bot_user_id}>" in event.get("text", ""):
    return

  bot_username = None
  if is_bot:
    bot_username = utils.get_username_by_bot_id(bot_id)

  sender_user_id = event.get("user") if not is_bot else None
  matches = _match_agents(channel_config, is_bot=is_bot, bot_username=bot_username, user_id=sender_user_id, listen="message")
  if not matches:
    return

  for agent_match in matches:
    _route_to_agent(event, say, client, channel_config, agent_match, is_bot=is_bot, bot_username=bot_username)


# =============================================================================
# HITL (Human-in-the-Loop) Form Action Handler
# =============================================================================
@app.action(re.compile(r"hitl_.*"))
def handle_hitl_action(ack, body, client):
  ack()
  try:
    result = hitl_handler.handle_interaction(body, client)
    if result and result.get("resume_context"):
      ctx = result["resume_context"]
      thread_ts = ctx.get("thread_ts")
      channel_id = ctx.get("channel_id")

      if thread_ts and channel_id and ctx.get("conversation_id") and ctx.get("agent_id"):
        # Get team_id and user_id from the interaction payload
        team_id = body.get("team", {}).get("id")
        user_id = body.get("user", {}).get("id")

        # Process the resume stream
        ai.stream_response(
          sse_client=sse_client,
          slack_client=client,
          channel_id=channel_id,
          thread_ts=thread_ts,
          message_text="",  # Not used for resume
          team_id=team_id,
          user_id=user_id,
          agent_id=ctx["agent_id"],
          conversation_id=ctx["conversation_id"],
          is_resume=True,
          resume_form_data=ctx.get("form_data"),
        )
      else:
        logger.warning(f"HITL resume missing required context: {ctx}")
    elif result:
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
    conversation_id = _resolve_conversation_id(thread_ts, channel_id)
    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value=feedback_value,
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
      message_ts=message_ts,
    )

    if is_positive:
      client.chat_postEphemeral(
        channel=channel_id,
        user=user_id,
        thread_ts=thread_ts,
        text="Thanks for the feedback! Glad it was helpful.",
      )
    else:
      action_value = f"{channel_id}|{thread_ts}|{message_ts}"
      action_elements = [
        {"type": "button", "text": {"type": "plain_text", "text": "More detail"}, "action_id": "caipe_feedback_more_detail", "value": action_value},
        {"type": "button", "text": {"type": "plain_text", "text": "Briefer"}, "action_id": "caipe_feedback_less_verbose", "value": action_value},
        {"type": "button", "text": {"type": "plain_text", "text": "Wrong answer"}, "action_id": "caipe_feedback_wrong_answer", "value": action_value},
        {"type": "button", "text": {"type": "plain_text", "text": "Other"}, "action_id": "caipe_feedback_other", "value": action_value},
      ]

      # Add "Get help" button if escalation is configured
      channel_config = config.channels.get(channel_id)
      esc_config = _resolve_escalation(channel_config)
      if esc_config:
        action_elements.append({"type": "button", "text": {"type": "plain_text", "text": "\U0001f64b Get help"}, "action_id": "caipe_escalation_get_help", "value": action_value})

      refinement_blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": "Sorry that wasn't helpful. What could be improved?"}},
        {"type": "actions", "elements": action_elements},
      ]
      client.chat_postEphemeral(
        channel=channel_id,
        user=user_id,
        thread_ts=thread_ts,
        blocks=refinement_blocks,
        text="What could be improved?",
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
    message_ts = parts[2] if len(parts) > 2 else None
    if not channel_id or not thread_ts:
      return

    agent_id = _resolve_agent_id(config.channels.get(channel_id))
    conversation_id = _resolve_conversation_id(thread_ts, channel_id, agent_id)

    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value="needs_detail",
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
      message_ts=message_ts,
    )

    client.chat_postEphemeral(channel=channel_id, user=user_id, thread_ts=thread_ts, text=f"Got it! Asking {APP_NAME} for more detail...")

    team_id = body.get("team", {}).get("id")

    channel_config = config.channels.get(channel_id)
    esc_config = _resolve_escalation(channel_config)

    _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text="The user wants more detail on your previous answer. Search for at least 5 additional sources beyond what you already cited. Keep your response to 2-3 short paragraphs. Focus on details you left out the first time. End with sources and links.",
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      additional_footer=f"More detail requested by <@{user_id}>",
      escalation_config=esc_config,
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
    message_ts = parts[2] if len(parts) > 2 else None
    if not channel_id or not thread_ts:
      return

    agent_id = _resolve_agent_id(config.channels.get(channel_id))
    conversation_id = _resolve_conversation_id(thread_ts, channel_id, agent_id)

    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value="too_verbose",
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
      message_ts=message_ts,
    )

    client.chat_postEphemeral(channel=channel_id, user=user_id, thread_ts=thread_ts, text=f"Got it! Asking {APP_NAME} for a more concise response...")

    team_id = body.get("team", {}).get("id")

    channel_config = config.channels.get(channel_id)
    esc_config = _resolve_escalation(channel_config)

    _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text="Please provide a more concise response. Summarize the key points briefly. Be direct and to the point.",
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      additional_footer=f"Shorter response requested by <@{user_id}>",
      escalation_config=esc_config,
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
    message_ts = parts[2] if len(parts) > 2 else None
    if not channel_id or not thread_ts:
      return

    if not utils.is_configured_channel(channel_id):
      return

    channel_config = config.channels[channel_id]
    agent_id = _resolve_agent_id(channel_config)
    # Resolve server-side conversation_id for this thread
    conversation_id = _resolve_conversation_id(thread_ts, channel_id, agent_id)

    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value="retry",
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
      message_ts=message_ts,
    )

    user_name, user_email = utils.get_message_author_info(body.get("user", {}), client)
    team_id = body.get("team", {}).get("id")
    bot_info = client.auth_test()
    bot_user_id = bot_info.get("user_id")

    thread_context = slack_context.build_thread_context(app, channel_id, thread_ts, "", bot_user_id)

    retry_message = ai.RETRY_PROMPT_PREFIX + thread_context

    channel_info = utils.get_channel_context(client, channel_id, session_manager)

    client_context = {
      "source": "slack",
      "channel_type": "channel",
      "channel_name": channel_config.name,
      "channel_topic": channel_info.get("topic", ""),
      "channel_purpose": channel_info.get("purpose", ""),
    }
    if user_email:
      client_context["user_email"] = user_email

    _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=retry_message,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      additional_footer=f"Retried by <@{user_id}>",
      client_context=client_context,
    )
  except Exception as e:
    logger.exception(f"Error handling retry: {e}")


# =============================================================================
# Escalation Action Handlers
# =============================================================================
@app.action("caipe_escalation_get_help")
def handle_escalation_get_help(ack, body, client):
  ack()
  try:
    from utils.escalation import execute_escalation

    user_id = body.get("user", {}).get("id")
    action = body.get("actions", [{}])[0]
    parts = action.get("value", "").split("|")
    channel_id = parts[0] if len(parts) > 0 else None
    thread_ts = parts[1] if len(parts) > 1 else None
    if not channel_id or not thread_ts:
      return

    # Check if escalation was already triggered for this thread
    if session_manager.is_escalated(thread_ts):
      client.chat_postEphemeral(
        channel=channel_id,
        user=user_id,
        thread_ts=thread_ts,
        text="Help has already been requested for this thread.",
      )
      return

    # Get escalation config for this channel
    channel_config = config.channels.get(channel_id)
    if not channel_config:
      return
    esc_config = _resolve_escalation(channel_config)
    if not esc_config:
      return

    # Validate victorops agent is configured before proceeding
    vo_agent_id = config.defaults.victorops_agent_id
    if esc_config.victorops.enabled and not vo_agent_id:
      client.chat_postEphemeral(
        channel=channel_id,
        user=user_id,
        thread_ts=thread_ts,
        text="VictorOps escalation is enabled but no agent is configured. Set `SLACK_INTEGRATION_VICTOROPS_AGENT_ID` to enable on-call lookups.",
      )
      return

    # Mark as escalated
    session_manager.set_escalated(thread_ts)

    # Track escalation in feedback
    conversation_id = _resolve_conversation_id(thread_ts, channel_id)
    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value="escalation_requested",
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
    )

    client.chat_postEphemeral(
      channel=channel_id,
      user=user_id,
      thread_ts=thread_ts,
      text="Got it! Connecting you with a human...",
    )

    # Determine the parent message ts (root of thread)
    message = body.get("message", {})
    parent_ts = message.get("thread_ts") or thread_ts

    execute_escalation(
      slack_client=client,
      sse_client=sse_client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      parent_ts=parent_ts,
      user_id=user_id,
      escalation_config=esc_config,
      agent_id=vo_agent_id or "",
      conversation_id=conversation_id,
    )

    # Mark conversation as escalated for admin dashboard resolution stats
    try:
      sse_client.update_conversation_metadata(conversation_id, {"escalated": True})
    except Exception:
      logger.warning(f"[{thread_ts}] Failed to mark conversation as escalated in metadata")

  except Exception as e:
    logger.exception(f"Error handling escalation: {e}")


@app.action("caipe_delete_message")
def handle_delete_message(ack, body, client):
  ack()
  try:
    user_id = body.get("user", {}).get("id")
    channel_id = body.get("channel", {}).get("id")
    message = body.get("message", {})
    message_ts = message.get("ts")
    thread_ts = message.get("thread_ts") or message_ts

    if not channel_id or not message_ts:
      return

    channel_config = config.channels.get(channel_id)
    delete_admins = []
    if channel_config:
      for agent in channel_config.agents:
        if agent.escalation and agent.escalation.delete_admins:
          delete_admins = agent.escalation.delete_admins
          break

    if delete_admins and user_id not in delete_admins:
      client.chat_postEphemeral(
        channel=channel_id,
        user=user_id,
        thread_ts=thread_ts,
        text="You don't have permission to delete this message.",
      )
      logger.warning(f"[{thread_ts}] Unauthorized delete attempt by <@{user_id}>")
      return

    conversation_id = _resolve_conversation_id(thread_ts, channel_id)
    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value="message_deleted",
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
    )

    client.chat_delete(channel=channel_id, ts=message_ts)
    logger.info(f"[{thread_ts}] Message {message_ts} deleted by <@{user_id}>")
  except Exception as e:
    logger.exception(f"Error handling message delete: {e}")


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
    message_ts = parts[2] if len(parts) > 2 else None
    feedback_type = parts[3] if len(parts) > 3 else "wrong_answer"

    if not channel_id or not thread_ts:
      return

    values = view.get("state", {}).get("values", {})
    correction_text = values.get("correction_input", {}).get("correction_text", {}).get("value", "")
    if not correction_text:
      return

    agent_id = _resolve_agent_id(config.channels.get(channel_id))
    conversation_id = _resolve_conversation_id(thread_ts, channel_id, agent_id)

    submit_feedback_score(
      thread_ts=thread_ts,
      user_id=user_id,
      channel_id=channel_id,
      feedback_value=feedback_type,
      slack_client=client,
      session_manager=session_manager,
      config=config,
      conversation_id=conversation_id,
      comment=correction_text,
      message_ts=message_ts,
    )

    client.chat_postEphemeral(
      channel=channel_id,
      user=user_id,
      thread_ts=thread_ts,
      text=f"Got it! Asking {APP_NAME} to correct the response based on your feedback...",
    )

    correction_prompt = f'The user indicated your previous response was incorrect and provided the following IMPORTANT context: "{correction_text}"\n\nPlease carefully review this feedback and provide a corrected response.'

    # Get escalation config for this channel
    channel_config = config.channels.get(channel_id)
    esc_config = _resolve_escalation(channel_config)

    _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=correction_prompt,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      additional_footer=f"Correction requested by <@{user_id}>",
      escalation_config=esc_config,
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

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

# 098: install the log redaction filter BEFORE importing slack_bolt / slack_sdk
# so their module-level loggers pick it up. Slack Bolt has been observed to log
# entire request payloads (containing the per-request `token`, OAuth bearers,
# JWTs, etc.) when a middleware short-circuits without calling next() — see
# `utils.log_redaction` for the full list of patterns scrubbed.
from utils.log_redaction import install as _install_log_redaction  # noqa: E402
_install_log_redaction()

from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler

from loguru import logger
from utils.config import config
from utils import utils
from utils import ai
from utils import slack_context
from utils import slack_formatter
from utils.hitl_handler import HITLCallbackHandler

from sse_client import SSEClient, set_obo_token
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

# 098 Enterprise RBAC enforcement
RBAC_ENABLED = os.environ.get("SLACK_RBAC_ENABLED", "false").lower() == "true"

if RBAC_ENABLED:
    import asyncio
    from utils.identity_linker import (
        resolve_slack_user,
        generate_linking_url,
        auto_bootstrap_slack_user,
        SLACK_FORCE_LINK,
        should_preauth_prompt,
        mark_preauth_prompted,
    )
    from utils.channel_agent_mapper import resolve_channel_agent
    from utils.channel_team_resolver import (
        resolve_channel_team,
        is_dm_channel,
        PERSONAL_ACTIVE_TEAM,
    )
    from utils.obo_exchange import impersonate_user, OboExchangeError

    async def _rbac_enrich_context(body, slack_user_id, context, *, require_mapping: bool = True):
        """Resolve identity and enrich Bolt context.

        Returns 'unlinked', ('deny', message), or 'ok'.
        Sets context['channel_agent_id'] when a channel→agent mapping exists.
        When *require_mapping* is False (e.g. @mentions), a missing mapping
        is not a hard deny — the request proceeds using config/default agent.
        """
        keycloak_user_id = await resolve_slack_user(slack_user_id)
        if keycloak_user_id is None:
            if not SLACK_FORCE_LINK:
                keycloak_user_id = await auto_bootstrap_slack_user(slack_user_id)
            if keycloak_user_id is None:
                return "unlinked"

        context["keycloak_user_id"] = keycloak_user_id

        channel_id = (
            body.get("event", {}).get("channel")
            or body.get("channel", {}).get("id")
        )
        if channel_id:
            context["slack_channel_id"] = channel_id

        resolution = await resolve_channel_agent(channel_id, keycloak_user_id)
        if resolution.agent_id:
            context["channel_agent_id"] = resolution.agent_id
            logger.info(
                "Channel %s mapped to agent %s for user %s",
                channel_id, resolution.agent_id, keycloak_user_id,
            )
        elif require_mapping:
            return ("deny", resolution.user_denial_message or
                    "This channel has no agent mapping. Ask your admin to configure one.")
        else:
            logger.debug(
                "No agent mapping for channel=%s user=%s — proceeding with default agent",
                channel_id, slack_user_id,
            )

        # Spec 104: every OBO token now carries a signed `active_team` claim.
        # Resolve which team the channel belongs to (or use the personal
        # sentinel for DMs), verify the user is allowed to act in that team,
        # then mint the token with the matching Keycloak client scope.
        if is_dm_channel(channel_id):
            active_team = PERSONAL_ACTIVE_TEAM
            context["active_team"] = active_team
            logger.info(
                "DM channel=%s for user=%s → active_team=%s",
                channel_id, keycloak_user_id, active_team,
            )
        else:
            team_resolution = await resolve_channel_team(channel_id, keycloak_user_id)
            if not team_resolution.team_slug:
                # Group channel without a team mapping (or user isn't in the
                # mapped team). Hard reject — we never want to silently fall
                # back to "personal" for a group channel because that would
                # bypass the channel's intended team RBAC.
                return ("deny", team_resolution.deny_message or
                        "This channel isn't assigned to a CAIPE team yet.")
            active_team = team_resolution.team_slug
            context["active_team"] = active_team
            context["team_id"] = team_resolution.team_id
            context["team_name"] = team_resolution.team_name
            logger.info(
                "Channel=%s mapped to team=%s (slug=%s) for user=%s",
                channel_id, team_resolution.team_name, active_team, keycloak_user_id,
            )

        try:
            obo = await impersonate_user(keycloak_user_id, active_team=active_team)
            context["obo_token"] = obo.access_token
            logger.info(
                "OBO impersonation succeeded for user=%s active_team=%s",
                keycloak_user_id, active_team,
            )
        except OboExchangeError as e:
            # Spec 104: failing the OBO exchange is a HARD failure now —
            # there is no SA fallback that would give the user the right
            # tools, so we reject the request rather than silently
            # downgrading to bot identity (which has no `tool_user:*`).
            logger.error(
                "OBO impersonation failed for user=%s active_team=%s: %s",
                keycloak_user_id, active_team, e,
            )
            return ("deny",
                    "Could not establish your team-scoped session. "
                    "This usually means the team's Keycloak scope hasn't "
                    "been provisioned — ask your admin to retry.")

        return "ok"

    logger.info("Enterprise RBAC enforcement enabled for Slack bot")
else:
    logger.info("Slack RBAC enforcement disabled (set SLACK_RBAC_ENABLED=true to enable)")


def _channel_agent_id_from_context(context):
    """Extract the channel→agent mapping agent_id from Bolt context."""
    if not RBAC_ENABLED or context is None:
        return None
    try:
        aid = context.get("channel_agent_id")
        return aid if isinstance(aid, str) and aid else None
    except AttributeError:
        return None


def _obo_token_from_context(context):
    """Extract OBO JWT from Bolt context (FR-019).

    Returns the user-scoped OBO token set by ``_rbac_enrich_context``,
    or ``None`` when RBAC is disabled or the OBO exchange failed.
    """
    if not RBAC_ENABLED or context is None:
        return None
    try:
        tok = context.get("obo_token")
        return tok if isinstance(tok, str) and tok else None
    except AttributeError:
        return None


def _bind_obo_for_handler(context):
    """Bind the per-request OBO token onto the SSE client's ContextVar.

    Spec 104 Story 3 — every Slack handler that calls into ``sse_client``
    (directly or via ``utils/ai.py``) must call this once at entry. The
    SSE client's ``_get_headers`` then prefers the user-scoped OBO token
    over the bot's service-account token, so downstream services
    (``caipe-ui`` BFF, ``dynamic-agents``) see the real user's
    ``sub`` + ``act.sub`` claims and can apply per-user RBAC.

    No-ops cleanly when:
      - RBAC is disabled (no impersonation step ran)
      - The OBO exchange failed (we DON'T fall back to SA — that would
        defeat the whole point; instead the SSE client falls back to SA
        on its own and we surface a clear "auth degraded" warning).

    The ContextVar is naturally task-scoped so we don't need to reset it
    in a finally block; it disappears when the Bolt handler task exits.
    """
    obo = _obo_token_from_context(context)
    if obo:
        set_obo_token(obo)
    else:
        # Explicitly clear any stale token from a previous handler running
        # on the same thread/event loop slot. Belt-and-braces — Bolt
        # spawns a fresh task per event so this should already be None.
        set_obo_token(None)


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


def _get_agent_id(channel_config=None, mapped_agent_id: str | None = None) -> str:
  """Resolve agent_id: DB mapping > channel config > global default."""
  if mapped_agent_id:
    return mapped_agent_id
  if channel_config and hasattr(channel_config, "agent_id") and channel_config.agent_id:
    return channel_config.agent_id
  if config.defaults.default_agent_id:
    return config.defaults.default_agent_id
  logger.warning("No agent_id configured — using empty string")
  return ""


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
  overthink_mode=False,
  escalation_config=None,
  client_context=None,
):
  """Route to stream_response or invoke_response based on user type."""
  logger.info(f"[{thread_ts}] _call_ai: conv={conversation_id} agent={agent_id} user={user_id} overthink={overthink_mode}")
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
      overthink_mode=overthink_mode,
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
# 098 RBAC Global Middleware
# =============================================================================
# Deduplicate Slack event retries (Socket Mode delivers retries as new events)
_seen_events: dict[str, float] = {}
_SEEN_TTL = 30.0  # seconds

# Rate-limit "account not linked" prompts — at most once per hour per user
_linking_prompt_sent: dict[str, float] = {}
_LINKING_PROMPT_COOLDOWN = float(os.environ.get("SLACK_LINKING_PROMPT_COOLDOWN", "3600"))

@app.middleware
def rbac_global_middleware(body, context, next, logger):
    # Deduplicate retried events
    event_id = body.get("event_id")
    if event_id:
        import time as _time
        now = _time.time()
        # Prune old entries
        stale = [k for k, v in _seen_events.items() if now - v > _SEEN_TTL]
        for k in stale:
            _seen_events.pop(k, None)
        if event_id in _seen_events:
            logger.debug("Ignoring duplicate event_id=%s", event_id)
            return
        _seen_events[event_id] = now
    """Enterprise RBAC enforcement checkpoint (098).

    When SLACK_RBAC_ENABLED=true:
    1. Extracts Slack user ID from the event/action payload.
    2. Resolves the Slack user to a Keycloak identity (identity link).
    3. If unlinked, sends an ephemeral message prompting account linking.
    4. If linked, performs OBO token exchange so downstream requests
       carry the user's identity (sub=user, act.sub=bot).
    5. Stores the OBO access token and user_sub on the Bolt context
       for per-handler RBAC checks.
    """
    if not RBAC_ENABLED:
        next()
        return

    # Skip system/bot messages (joins, leaves, topic changes, etc.)
    event = body.get("event", {})
    subtype = event.get("subtype", "")
    if subtype in (
        "channel_join", "channel_leave", "channel_topic", "channel_purpose",
        "channel_name", "bot_message", "message_changed", "message_deleted",
        "group_join", "group_leave",
    ):
        next()
        return

    slack_user_id = (
        event.get("user")
        or body.get("user", {}).get("id")
        or body.get("user_id")
    )

    if not slack_user_id:
        next()
        return

    context["rbac_enabled"] = True
    context["slack_user_id"] = slack_user_id

    # @mentions work in any channel; Q&A messages require a channel-to-team mapping
    is_mention = event.get("type") == "app_mention"

    try:
        loop = asyncio.new_event_loop()
        rbac_status = loop.run_until_complete(
            _rbac_enrich_context(body, slack_user_id, context, require_mapping=not is_mention)
        )
    except Exception as exc:
        logger.error("Failed to resolve Slack user %s — denying request: %s", slack_user_id, exc)
        channel = (
            body.get("event", {}).get("channel")
            or body.get("channel", {}).get("id")
        )
        if channel:
            try:
                context["client"].chat_postEphemeral(
                    channel=channel,
                    user=slack_user_id,
                    text="Identity verification is temporarily unavailable. Please try again later.",
                )
            except Exception:
                logger.warning("Could not send RBAC error message to %s", slack_user_id)
        return
    finally:
        loop.close()

    channel = (
        body.get("event", {}).get("channel")
        or body.get("channel", {}).get("id")
    )

    if rbac_status == "unlinked":
        import time as _time
        now = _time.time()
        last_sent = _linking_prompt_sent.get(slack_user_id, 0)
        if now - last_sent < _LINKING_PROMPT_COOLDOWN:
            logger.debug("Suppressing linking prompt for %s (cooldown)", slack_user_id)
            return
        if channel:
            try:
                # Spec 103 FR-007: replace the previous dead-end message
                # with an actionable HMAC-signed linking URL whenever the
                # auto-link path returns "unlinked" — regardless of whether
                # JIT was disabled, the email domain was not allow-listed,
                # JIT failed (e.g. Keycloak 5xx), or the operator has
                # SLACK_FORCE_LINK enabled. The user always gets a path
                # forward; the previous text told them to "contact your
                # admin" which is not a path the user can self-serve.
                try:
                    linking_url = asyncio.run(generate_linking_url(slack_user_id))
                except Exception:
                    linking_url = None

                if linking_url:
                    text = (
                        "Your Slack account is not linked to an enterprise identity. "
                        f"<{linking_url}|Click here to link your account> "
                        "before using this feature."
                    )
                else:
                    # Last-resort: no HMAC secret configured, so we cannot
                    # mint a link. Keep the old dead-end message but make
                    # it accurate (it really is a config issue at this point).
                    text = (
                        "Your Slack account could not be linked because the bot is "
                        "not configured to mint linking URLs. Please contact your admin."
                    )
                context["client"].chat_postEphemeral(
                    channel=channel,
                    user=slack_user_id,
                    text=text,
                )
                _linking_prompt_sent[slack_user_id] = now
            except Exception:
                logger.warning("Could not send linking prompt to %s", slack_user_id)
        return

    if isinstance(rbac_status, tuple) and rbac_status[0] == "deny":
        msg = rbac_status[1]
        if channel:
            msg += f"\n_Channel: <#{channel}>_"
            try:
                thread_ts = body.get("event", {}).get("thread_ts") or body.get("event", {}).get("ts")
                context["client"].chat_postMessage(
                    channel=channel,
                    thread_ts=thread_ts,
                    text=msg,
                )
            except Exception:
                logger.warning("Could not send RBAC denial to %s in %s", slack_user_id, channel)
        return

    next()


# =============================================================================
# @mention handler (manually invoke CAIPE)
# =============================================================================
@app.event("app_mention")
def handle_mention(event, say, client, context=None):
  """Handle @mentions of the bot to query CAIPE."""
  try:
    _bind_obo_for_handler(context)
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

    logger.info(f"[{thread_ts}] CAIPE was invoked by User: {user_name} ({user_id or event.get('bot_id')}), Email: {user_email}, Channel: {channel_id}, Thread: {thread_ts}{_msg_link(channel_id, thread_ts)}")

    if not message_text:
      say(text="Please include a question or message!", thread_ts=thread_ts)
      return

    bot_info = client.auth_test()
    bot_user_id = bot_info.get("user_id")

    agent_id = _get_agent_id(channel_config, mapped_agent_id=_channel_agent_id_from_context(context))

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
    esc_config = get_escalation_config(channel_config)

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

    # Record the timestamp of the last processed message so subsequent
    # interactions can fetch only the delta.
    try:
      sse_client.update_conversation_metadata(conversation_id, {"last_processed_ts": event.get("ts")})
    except Exception:
      logger.warning(f"[{thread_ts}] Failed to update last_processed_ts — delta context may fall back to full on next turn")

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
# Q&A Mode (auto respond to messages in channel, excluding bots)
# =============================================================================
def handle_qanda_message(event, say, client, context=None):
  try:
    _bind_obo_for_handler(context)
    # Ignore system messages (channel_purpose, channel_topic, channel_join, etc.)
    if event.get("subtype"):
      logger.debug(f"Q&A ignoring system message subtype={event['subtype']} in {event.get('channel')}")
      return

    channel_id = event.get("channel")
    thread_ts = event.get("ts")

    if not utils.verify_thread_exists(client, channel_id, thread_ts):
      logger.warning(f"[{thread_ts}] Ignoring Q&A message — parent message was deleted")
      return

    user_id = event.get("user")
    team_id = event.get("team")
    message_text = slack_context.extract_message_text(event)

    user_name, user_email = utils.get_message_author_info(event, client)

    logger.info(f"[{thread_ts}] Q&A MODE - User: {user_name} ({user_id or event.get('bot_id')}), Email: {user_email}, Channel: {channel_id}, Question: {message_text}{_msg_link(channel_id, thread_ts)}")

    if not message_text.strip():
      return

    channel_config = config.channels[channel_id]
    agent_id = _get_agent_id(channel_config, mapped_agent_id=_channel_agent_id_from_context(context))

    # Create or retrieve conversation via shared API (server owns ID generation)
    conv_result = sse_client.create_conversation(
      title=message_text[:50].strip() or "Slack Q&A",
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

    client_context = {
      "source": "slack",
      "channel_type": "channel",
      "channel_name": channel_config.name,
      "channel_topic": channel_info.get("topic", ""),
      "channel_purpose": channel_info.get("purpose", ""),
      "overthink": channel_config.qanda.overthink,
    }
    if user_email:
      client_context["user_email"] = user_email

    esc_config = get_escalation_config(channel_config)

    result = _call_ai(
      client=client,
      channel_id=channel_id,
      thread_ts=thread_ts,
      message_text=message_text,
      user_id=user_id,
      team_id=team_id,
      agent_id=agent_id,
      conversation_id=conversation_id,
      overthink_mode=channel_config.qanda.overthink,
      escalation_config=esc_config,
      client_context=client_context,
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


def handle_dm_message(event, say, client, context=None):
  """Handle direct messages to the bot."""
  try:
    _bind_obo_for_handler(context)
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

    # 098 RBAC: Check if user needs pre-auth prompt on first message
    if RBAC_ENABLED:
      try:
        should_prompt = asyncio.run(should_preauth_prompt(user_id))
        if should_prompt:
          linking_url = generate_linking_url(user_id)
          asyncio.run(mark_preauth_prompted(user_id))

          say(
            blocks=[
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": f"Hi {user_name}! 👋\n\nBefore I can help you, I need to authenticate your account.",
                },
              },
              {
                "type": "actions",
                "elements": [
                  {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "Authenticate Now"},
                    "style": "primary",
                    "url": linking_url,
                  },
                ],
              },
              {
                "type": "context",
                "elements": [
                  {
                    "type": "mrkdwn",
                    "text": "This is a one-time setup. After authentication, I'll be able to answer your questions.",
                  },
                ],
              },
            ],
            text=f"Hi {user_name}, please authenticate to proceed.",
            thread_ts=thread_ts,
          )
          logger.info(f"[{thread_ts}] Sent pre-auth prompt to unlinked user {user_id}")
          return
      except Exception as e:
        logger.warning(f"[{thread_ts}] Error checking preauth status: {e}")

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

    # Record the timestamp of the last processed message so subsequent
    # interactions can fetch only the delta.
    try:
      sse_client.update_conversation_metadata(conversation_id, {"last_processed_ts": event.get("ts")})
    except Exception:
      logger.warning(f"[{thread_ts}] Failed to update last_processed_ts — delta context may fall back to full on next turn")

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
def handle_message_events(body, say, client, context=None):
  event = body.get("event")
  if not event:
    return

  subtype = event.get("subtype")
  if subtype in ("message_deleted", "message_changed", "channel_join", "channel_leave"):
    return

  # Route DMs to dedicated handler
  channel_type = event.get("channel_type")
  if channel_type == "im" and not event.get("bot_id"):
    handle_dm_message(event, say, client, context)
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
        handle_qanda_message(event, say, client, context)
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
    logger.info(f"[{alert_ts}] Routing alert from {bot_username} (bot_id={bot_id}) to AI processing, Channel: {channel_id}{_msg_link(channel_id, alert_ts)}")
    jira_config = channel_config.other.jira
    if not jira_config:
      raise ValueError(f"Channel {channel_id} is missing required 'other.jira' config")

    agent_id = _get_agent_id(channel_config, mapped_agent_id=_channel_agent_id_from_context(context))
    esc_config = get_escalation_config(channel_config)
    ai.handle_ai_alert_processing(
      sse_client,
      client,
      event,
      channel_id,
      bot_username,
      jira_config,
      agent_id=agent_id,
      custom_prompt=channel_config.ai_alerts.custom_prompt,
      escalation_config=esc_config,
    )


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
      esc_config = get_escalation_config(channel_config) if channel_config else None
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

    agent_id = _get_agent_id(config.channels.get(channel_id))
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
    esc_config = get_escalation_config(channel_config) if channel_config else None

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

    agent_id = _get_agent_id(config.channels.get(channel_id))
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
    esc_config = get_escalation_config(channel_config) if channel_config else None

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

    if not utils.check_has_jira_info(channel_id):
      return

    channel_config = config.channels[channel_id]
    agent_id = _get_agent_id(channel_config)
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

    # Get escalation config for this channel
    channel_config = config.channels.get(channel_id)
    if not channel_config:
      return
    esc_config = get_escalation_config(channel_config)
    if not esc_config:
      return

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
    )
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

    # Check if user is authorized to delete
    channel_config = config.channels.get(channel_id)
    delete_admins = []
    if channel_config and channel_config.other:
      delete_admins = channel_config.other.delete_admins or []

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

    agent_id = _get_agent_id(config.channels.get(channel_id))
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
    esc_config = get_escalation_config(channel_config) if channel_config else None

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

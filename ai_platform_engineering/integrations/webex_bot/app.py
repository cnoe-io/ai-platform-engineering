"""
Webex Bot Entry Point

Connects to Webex via WebSocket (WDM pattern), receives messages and card actions,
and forwards them to the CAIPE supervisor via the A2A protocol. Responses are
streamed back using the hybrid approach (working → progress → final).
"""

import json
import sys
from loguru import logger

from utils.config import load_config
from utils.webex_context import extract_message_text, get_thread_key, is_direct_message
from utils.ai import stream_a2a_response_webex
from a2a_client import A2AClient
from oauth2_client import OAuth2ClientCredentials
from session_manager import SessionManager
from webex_websocket import WebexWebSocketClient


DENIAL_MESSAGE = "This space is not authorized to use CAIPE. Contact your administrator to enable access."


def main():
    """Start the Webex bot."""
    logger.remove()
    logger.add(sys.stderr, level="INFO", format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}")

    config = load_config()
    logger.info(f"Starting Webex bot (supervisor: {config.caipe_url})")

    # Init auth client
    auth_client = None
    if config.enable_auth:
        try:
            auth_client = OAuth2ClientCredentials.from_env()
            logger.info("OAuth2 client credentials authentication enabled")
        except RuntimeError as e:
            logger.error(f"Failed to initialize OAuth2 auth: {e}")
            sys.exit(1)

    # Init A2A client
    a2a_client = A2AClient(
        base_url=config.caipe_url,
        client_source="webex-bot",
        auth_client=auth_client,
    )

    # Init session manager
    session_manager = SessionManager()
    logger.info(f"Session store: {session_manager.get_store_type()}")

    # Init Langfuse client (optional)
    langfuse_client = None
    if config.langfuse_enabled:
        try:
            from langfuse_client import FeedbackClient
            langfuse_client = FeedbackClient()
            logger.info("Langfuse feedback client enabled")
        except Exception as e:
            logger.warning(f"Failed to initialize Langfuse client: {e}")

    # Init space authorization (optional, for group spaces)
    space_auth_manager = None
    if config.mongodb_uri:
        try:
            from utils.space_auth import SpaceAuthorizationManager
            space_auth_manager = SpaceAuthorizationManager(
                mongodb_uri=config.mongodb_uri,
                database=config.mongodb_database,
                cache_ttl=config.space_auth_cache_ttl,
            )
            logger.info("Space authorization manager initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize space auth manager: {e}")

    # Init Webex API
    from webexteamssdk import WebexTeamsAPI
    webex_api = WebexTeamsAPI(access_token=config.bot_token)

    def handle_message(message_obj):
        """Handle incoming Webex message."""
        try:
            room_id = message_obj.roomId
            user_email = message_obj.personEmail
            text = extract_message_text(message_obj)

            if not text:
                return

            logger.info(f"Message from {user_email} in {room_id}: {text[:100]}...")

            # Check for authorize command
            if text.strip().lower() in ("authorize", "auth"):
                from utils.space_auth import handle_authorize_command
                handle_authorize_command(webex_api, room_id, user_email, config.caipe_ui_base_url)
                return

            # Space authorization check (group spaces only)
            if not is_direct_message(message_obj) and space_auth_manager:
                if not space_auth_manager.is_authorized(room_id):
                    try:
                        webex_api.messages.create(roomId=room_id, markdown=DENIAL_MESSAGE)
                    except Exception as e:
                        logger.error(f"Failed to send denial message: {e}")
                    return

            # Get session context
            thread_key = get_thread_key(message_obj)
            context_id = session_manager.get_context_id(thread_key)
            parent_id = getattr(message_obj, "parentId", None)

            # Stream A2A response
            result = stream_a2a_response_webex(
                a2a_client=a2a_client,
                webex_api=webex_api,
                room_id=room_id,
                message_text=text,
                user_email=user_email,
                context_id=context_id,
                session_manager=session_manager,
                parent_id=parent_id,
                thread_key=thread_key,
                langfuse_client=langfuse_client,
            )

            if result and result.get("context_id"):
                session_manager.set_context_id(thread_key, result["context_id"])
            if result and result.get("trace_id"):
                session_manager.set_trace_id(thread_key, result["trace_id"])

        except Exception as e:
            logger.error(f"Error handling message: {e}", exc_info=True)
            try:
                webex_api.messages.create(
                    roomId=message_obj.roomId,
                    markdown=f"❌ Sorry, an error occurred: {str(e)[:200]}",
                )
            except Exception:
                pass

    def handle_card(action_obj):
        """Handle Webex card action (button click or form submission)."""
        try:
            inputs = action_obj.inputs or {}
            action = inputs.get("action", "")
            room_id = action_obj.roomId

            if action == "feedback":
                value = inputs.get("value", "")
                logger.info(f"Feedback received: {value}")
                emoji = "👍" if value == "positive" else "👎"
                webex_api.messages.create(
                    roomId=room_id,
                    markdown=f"Thank you for your feedback! {emoji}",
                )

                if langfuse_client:
                    thread_key = room_id
                    trace_id = session_manager.get_trace_id(thread_key)
                    if trace_id:
                        langfuse_client.submit_feedback(
                            trace_id=trace_id,
                            score_name="user_feedback",
                            value=value,
                            user_email=getattr(action_obj, "personEmail", None),
                        )

            elif action == "hitl_response":
                action_id = inputs.get("action_id", "")
                form_id = inputs.get("form_id", "")
                user_inputs = {k: v for k, v in inputs.items() if k not in ("action", "action_id", "form_id")}
                logger.info(f"HITL response: action={action_id}, form={form_id}, inputs={user_inputs}")

                response_text = json.dumps({"action": action_id, **user_inputs}) if user_inputs else action_id

                thread_key = room_id
                context_id = session_manager.get_context_id(thread_key)

                stream_a2a_response_webex(
                    a2a_client=a2a_client,
                    webex_api=webex_api,
                    room_id=room_id,
                    message_text=response_text,
                    user_email=getattr(action_obj, "personEmail", ""),
                    context_id=context_id,
                    session_manager=session_manager,
                    thread_key=thread_key,
                    langfuse_client=langfuse_client,
                )

            elif action == "user_input":
                user_inputs = {k: v for k, v in inputs.items() if k != "action"}
                response_text = ", ".join(f"{k}: {v}" for k, v in user_inputs.items())

                thread_key = room_id
                context_id = session_manager.get_context_id(thread_key)

                stream_a2a_response_webex(
                    a2a_client=a2a_client,
                    webex_api=webex_api,
                    room_id=room_id,
                    message_text=response_text,
                    user_email=getattr(action_obj, "personEmail", ""),
                    context_id=context_id,
                    session_manager=session_manager,
                    thread_key=thread_key,
                    langfuse_client=langfuse_client,
                )

        except Exception as e:
            logger.error(f"Error handling card action: {e}", exc_info=True)

    # Start WebSocket client
    logger.info("Starting WebSocket connection...")
    ws_client = WebexWebSocketClient(
        access_token=config.bot_token,
        on_message=handle_message,
        on_card=handle_card,
        on_connect=lambda: logger.info("WebSocket connected"),
        on_disconnect=lambda: logger.warning("WebSocket disconnected"),
    )
    ws_client.run()


if __name__ == "__main__":
    main()

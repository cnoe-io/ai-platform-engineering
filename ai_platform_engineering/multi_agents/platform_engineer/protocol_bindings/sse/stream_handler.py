# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""
SSE Stream Handler

Core streaming logic that bridges the LangGraph supervisor to the AG-UI
SSE event format consumed by UI and Slack interfaces.

AG-UI event types emitted
--------------------------
- RUN_STARTED        Stream begins
- TEXT_MESSAGE_START Before the first text chunk of a message
- TEXT_MESSAGE_CONTENT  Text chunk from the LLM
- TEXT_MESSAGE_END   After the last text chunk of a message
- TOOL_CALL_START    A tool/sub-agent invocation has begun
- TOOL_CALL_END      A tool/sub-agent invocation has completed
- STATE_DELTA        The supervisor wrote/updated its execution plan (write_todos)
- CUSTOM (INPUT_REQUIRED)  Human-in-the-loop: the supervisor needs a user response
- RUN_FINISHED       Stream is complete; carries the final run_id and thread_id
- RUN_ERROR          An unrecoverable error occurred
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import AsyncIterator

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

logger = logging.getLogger(__name__)

from ai_platform_engineering.multi_agents.platform_engineer.deep_agent import (
    AIPlatformEngineerMAS,
    USE_STRUCTURED_RESPONSE,
)
from ai_platform_engineering.utils.agui import (
    emit_custom,
    emit_run_error,
    emit_run_finished,
    emit_run_started,
    emit_state_delta,
    emit_text_content,
    emit_text_end,
    emit_text_start,
    emit_tool_end,
    emit_tool_start,
    format_sse_event,
)
from ai_platform_engineering.utils.persistence.turn_persistence import TurnPersistence


# ---------------------------------------------------------------------------
# Singleton MAS instance (shared across requests)
# ---------------------------------------------------------------------------

_mas_instance: AIPlatformEngineerMAS | None = None


def get_mas() -> AIPlatformEngineerMAS:
    global _mas_instance
    if _mas_instance is None:
        logger.info("Initialising AIPlatformEngineerMAS singleton for SSE binding")
        _mas_instance = AIPlatformEngineerMAS()
    return _mas_instance


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

async def generate_sse_events(
    message: str,
    conversation_id: str | None,
    user_id: str | None,
    user_email: str | None,
    trace_id: str | None,
    source: str,
    slack_channel_id: str | None,
    slack_thread_ts: str | None,
) -> AsyncIterator[str]:
    """
    Yield SSE-formatted AG-UI event strings for a single chat turn.

    Calls the supervisor's LangGraph directly via ``astream`` and maps
    LangChain message types to the AG-UI SSE event vocabulary.

    Parameters
    ----------
    message:
        The user's plaintext message.
    conversation_id:
        Persistent conversation ID (maps to LangGraph thread_id).
        A new UUID is generated when ``None``.
    user_id:
        Opaque user identifier for cross-thread memory.
    user_email:
        User e-mail forwarded to sub-agents for personalisation.
    trace_id:
        Distributed trace identifier (optional).
    source:
        ``"web"`` or ``"slack"``.
    slack_channel_id / slack_thread_ts:
        Slack metadata — stored in turn persistence only.
    """
    persistence = TurnPersistence()
    mas = get_mas()

    # Resolve or generate the conversation/thread ID
    conv_id = conversation_id or str(uuid.uuid4())
    thread_id = conv_id  # LangGraph thread_id == conversation_id
    run_id = str(uuid.uuid4())

    # Create a turn record before we start streaming
    turn_id = persistence.create_turn(
        conversation_id=conv_id,
        user_message={
            "content": message,
            "sender_email": user_email,
            "created_at": datetime.utcnow(),
        },
        metadata={
            "source": source,
            "trace_id": trace_id,
            "slack_channel_id": slack_channel_id,
            "slack_thread_ts": slack_thread_ts,
        },
    )

    # Emit RUN_STARTED at the beginning of the stream
    logger.info(f"[AG-UI] Starting stream: run={run_id}, thread={thread_id}, message={message[:50]}...")
    yield format_sse_event(emit_run_started(run_id=run_id, thread_id=thread_id))

    graph = mas.get_graph()
    logger.info("[AG-UI] Got graph, starting astream...")

    # Build the input state
    inputs: dict = {
        "messages": [{"role": "user", "content": message}],
    }
    skills_files = getattr(mas, "_skills_files", None)
    if skills_files:
        inputs["files"] = dict(skills_files)

    config: dict = {
        "configurable": {"thread_id": thread_id},
        "metadata": {},
    }
    if user_email:
        config["metadata"]["user_email"] = user_email
    if user_id:
        config["metadata"]["user_id"] = user_id
    if trace_id:
        config["metadata"]["trace_id"] = trace_id

    # Accumulated full response text for turn persistence
    accumulated_content: list[str] = []

    # Track whether a text message stream has been opened (TEXT_MESSAGE_START
    # emitted but TEXT_MESSAGE_END not yet emitted).
    current_message_id: str | None = None

    # Track open tool calls so we can correlate TOOL_CALL_END with the right id
    # keyed by tool name → tool_call_id
    open_tool_calls: dict[str, str] = {}

    def _open_message() -> str:
        """Emit TEXT_MESSAGE_START and return the new message_id."""
        nonlocal current_message_id
        msg_id = str(uuid.uuid4())
        current_message_id = msg_id
        return msg_id

    def _close_message_if_open() -> str | None:
        """Emit TEXT_MESSAGE_END if a message is open; return the frame or None."""
        nonlocal current_message_id
        if current_message_id is not None:
            msg_id = current_message_id
            current_message_id = None
            return format_sse_event(emit_text_end(message_id=msg_id))
        return None

    event_count = 0
    try:
        async for item_type, item in graph.astream(
            inputs,
            config,
            stream_mode=["messages", "custom", "updates"],
        ):
            event_count += 1
            if event_count <= 10 or event_count % 50 == 0:
                # Log more details about the message
                msg_info = ""
                if item_type == "messages" and item:
                    msg_obj = item[0] if isinstance(item, tuple) else item
                    msg_info = f", msg_class={type(msg_obj).__name__}"
                    if hasattr(msg_obj, 'content'):
                        content_preview = str(msg_obj.content)[:50] if msg_obj.content else "(empty)"
                        msg_info += f", content_preview={content_preview}"
                    if hasattr(msg_obj, 'tool_calls') and msg_obj.tool_calls:
                        msg_info += f", tool_calls={[tc.get('name') for tc in msg_obj.tool_calls]}"
                logger.info(f"[AG-UI] Stream event #{event_count}: type={item_type}{msg_info}")
            # ------------------------------------------------------------------
            # Custom events from sub-agents (human-in-the-loop, a2a events)
            # ------------------------------------------------------------------
            if item_type == "custom" and isinstance(item, dict):
                event_type = item.get("type")

                if event_type == "human_prompt":
                    prompt_text = item.get("prompt", "")
                    options = item.get("options", [])
                    fields = [{"label": o} for o in options] if options else None
                    payload: dict = {"content": prompt_text}
                    if fields:
                        payload["fields"] = fields
                    persistence.append_event(
                        turn_id,
                        "input_required",
                        {"content": prompt_text, "options": options},
                        conversation_id=conv_id,
                    )
                    yield format_sse_event(emit_custom(name="INPUT_REQUIRED", value=payload))

                elif event_type in ("a2a_event", "artifact-update"):
                    # Pass through as content — surface the text if any.
                    text = item.get("data", "") or ""
                    if isinstance(text, str) and text.strip():
                        # Open a new message if one isn't already open
                        if current_message_id is None:
                            msg_id = _open_message()
                            yield format_sse_event(emit_text_start(message_id=msg_id))
                        accumulated_content.append(text)
                        persistence.append_content(turn_id, text)
                        persistence.append_event(
                            turn_id, "content",
                            {"content": text, "is_final": False},
                            conversation_id=conv_id,
                        )
                        yield format_sse_event(
                            emit_text_content(message_id=current_message_id, delta=text)  # type: ignore[arg-type]
                        )

                continue

            # ------------------------------------------------------------------
            # Updates events (structured response from LangGraph)
            # ------------------------------------------------------------------
            if item_type == "updates" and isinstance(item, dict):
                # Handle generate_structured_response from the deep agent
                if "generate_structured_response" in item:
                    structured_resp = item["generate_structured_response"].get("structured_response")
                    if structured_resp is not None:
                        # Parse the structured response (it's a Pydantic model or dict)
                        if hasattr(structured_resp, "model_dump"):
                            parsed = structured_resp.model_dump()
                        elif hasattr(structured_resp, "dict"):
                            parsed = structured_resp.dict()
                        elif isinstance(structured_resp, dict):
                            parsed = structured_resp
                        else:
                            parsed = {"content": str(structured_resp)}

                        content = parsed.get("content", "")
                        if content:
                            logger.info(f"[AG-UI] Structured response content: {len(content)} chars")
                            if current_message_id is None:
                                msg_id = _open_message()
                                yield format_sse_event(emit_text_start(message_id=msg_id))
                            accumulated_content.append(content)
                            persistence.append_content(turn_id, content)
                            persistence.append_event(
                                turn_id, "content",
                                {"content": content, "is_final": True},
                                conversation_id=conv_id,
                            )
                            yield format_sse_event(
                                emit_text_content(message_id=current_message_id, delta=content)  # type: ignore[arg-type]
                            )

                        # Check for user input required
                        metadata = parsed.get("metadata", {})
                        if parsed.get("require_user_input") or (isinstance(metadata, dict) and metadata.get("user_input")):
                            payload = {"content": content}
                            if isinstance(metadata, dict) and metadata.get("input_fields"):
                                payload["fields"] = metadata["input_fields"]
                            yield format_sse_event(emit_custom(name="INPUT_REQUIRED", value=payload))

                continue

            # ------------------------------------------------------------------
            # Message stream events
            # ------------------------------------------------------------------
            if item_type != "messages":
                continue

            message_obj = item[0] if item else None
            if not message_obj:
                continue

            # ---- AIMessageChunk: token-by-token streaming --------------------
            if isinstance(message_obj, AIMessageChunk):
                # Check for tool_use blocks in content (Bedrock streaming format)
                # These come as: [{'type': 'tool_use', 'name': 'PlatformEngineerResponse', 'input': '...', ...}]
                content = message_obj.content
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_name = block.get("name", "")
                            tool_input = block.get("input", "")

                            # Handle PlatformEngineerResponse structured output
                            if tool_name and tool_name.lower() in ("responseformat", "platformengineerresponse"):
                                # The 'input' field contains the streaming JSON content
                                # For structured response, this is being built up piece by piece
                                if tool_input and USE_STRUCTURED_RESPONSE:
                                    if current_message_id is None:
                                        msg_id = _open_message()
                                        yield format_sse_event(emit_text_start(message_id=msg_id))
                                    accumulated_content.append(tool_input)
                                    persistence.append_content(turn_id, tool_input)
                                    yield format_sse_event(
                                        emit_text_content(message_id=current_message_id, delta=tool_input)  # type: ignore[arg-type]
                                    )
                                continue

                            # Other tool calls
                            if tool_name:
                                tool_call_id = block.get("id") or str(uuid.uuid4())
                                if tool_name not in open_tool_calls:
                                    open_tool_calls[tool_name] = tool_call_id
                                    persistence.append_event(
                                        turn_id, "tool_start",
                                        {"tool_name": tool_name},
                                        conversation_id=conv_id,
                                    )
                                    yield format_sse_event(
                                        emit_tool_start(tool_call_id=tool_call_id, tool_call_name=tool_name)
                                    )
                    continue

                # Fallback: check tool_calls attribute (non-Bedrock providers)
                has_tool_calls = bool(getattr(message_obj, "tool_calls", None))

                if has_tool_calls:
                    # Close any open text message before emitting tool events
                    close_frame = _close_message_if_open()
                    if close_frame:
                        yield close_frame

                    for tc in message_obj.tool_calls:
                        tool_name = tc.get("name", "")
                        if not tool_name:
                            continue

                        # ResponseFormat / structured response — emit the
                        # content inline and continue; no tool notification.
                        if tool_name.lower() in ("responseformat", "platformengineerresponse"):
                            tool_args = tc.get("args", {})
                            structured = (
                                tool_args.get("content")
                                or tool_args.get("message")
                                or tool_args.get("response")
                                or ""
                            )
                            if structured and USE_STRUCTURED_RESPONSE:
                                if current_message_id is None:
                                    msg_id = _open_message()
                                    yield format_sse_event(emit_text_start(message_id=msg_id))
                                accumulated_content.append(structured)
                                persistence.append_content(turn_id, structured)
                                persistence.append_event(
                                    turn_id, "content",
                                    {"content": structured, "is_final": True},
                                    conversation_id=conv_id,
                                )
                                yield format_sse_event(
                                    emit_text_content(message_id=current_message_id, delta=structured)  # type: ignore[arg-type]
                                )
                            continue

                        tool_call_id = tc.get("id") or str(uuid.uuid4())
                        open_tool_calls[tool_name] = tool_call_id
                        persistence.append_event(
                            turn_id, "tool_start",
                            {"tool_name": tool_name},
                            conversation_id=conv_id,
                        )
                        yield format_sse_event(
                            emit_tool_start(tool_call_id=tool_call_id, tool_call_name=tool_name)
                        )
                    continue

                # Regular text content
                content = _extract_text(message_obj.content)
                if content:
                    if current_message_id is None:
                        msg_id = _open_message()
                        yield format_sse_event(emit_text_start(message_id=msg_id))
                    accumulated_content.append(content)
                    persistence.append_content(turn_id, content)
                    persistence.append_event(
                        turn_id, "content",
                        {"content": content, "is_final": False},
                        conversation_id=conv_id,
                    )
                    yield format_sse_event(
                        emit_text_content(message_id=current_message_id, delta=content)  # type: ignore[arg-type]
                    )

            # ---- AIMessage: complete message (tool calls or non-streaming) ---
            elif isinstance(message_obj, AIMessage):
                has_tool_calls = bool(getattr(message_obj, "tool_calls", None))

                if has_tool_calls:
                    # Close any open text message before emitting tool events
                    close_frame = _close_message_if_open()
                    if close_frame:
                        yield close_frame

                    for tc in message_obj.tool_calls:
                        tool_name = tc.get("name", "")
                        if not tool_name:
                            continue

                        if tool_name.lower() in ("responseformat", "platformengineerresponse"):
                            tool_args = tc.get("args", {})
                            structured = (
                                tool_args.get("content")
                                or tool_args.get("message")
                                or tool_args.get("response")
                                or ""
                            )
                            if structured:
                                if current_message_id is None:
                                    msg_id = _open_message()
                                    yield format_sse_event(emit_text_start(message_id=msg_id))
                                accumulated_content.append(structured)
                                persistence.append_content(turn_id, structured)
                                persistence.append_event(
                                    turn_id, "content",
                                    {"content": structured, "is_final": True},
                                    conversation_id=conv_id,
                                )
                                yield format_sse_event(
                                    emit_text_content(message_id=current_message_id, delta=structured)  # type: ignore[arg-type]
                                )
                            continue

                        tool_call_id = tc.get("id") or str(uuid.uuid4())
                        open_tool_calls[tool_name] = tool_call_id
                        persistence.append_event(
                            turn_id, "tool_start",
                            {"tool_name": tool_name},
                            conversation_id=conv_id,
                        )
                        yield format_sse_event(
                            emit_tool_start(tool_call_id=tool_call_id, tool_call_name=tool_name)
                        )
                else:
                    # Non-streaming fallback: complete text in one message
                    content = _extract_text(message_obj.content)
                    if content and not accumulated_content:
                        # Only emit if we haven't already streamed tokens
                        if current_message_id is None:
                            msg_id = _open_message()
                            yield format_sse_event(emit_text_start(message_id=msg_id))
                        accumulated_content.append(content)
                        persistence.append_content(turn_id, content)
                        persistence.append_event(
                            turn_id, "content",
                            {"content": content, "is_final": False},
                            conversation_id=conv_id,
                        )
                        yield format_sse_event(
                            emit_text_content(message_id=current_message_id, delta=content)  # type: ignore[arg-type]
                        )

            # ---- ToolMessage: tool completed ---------------------------------
            elif isinstance(message_obj, ToolMessage):
                tool_name = getattr(message_obj, "name", "unknown") or "unknown"
                tool_content = _extract_text(
                    getattr(message_obj, "content", "")
                )

                # Execution plan (write_todos output) → STATE_DELTA
                if tool_name == "write_todos" and tool_content.strip():
                    persistence.append_event(
                        turn_id, "plan_update",
                        {"plan_text": tool_content},
                        conversation_id=conv_id,
                    )
                    yield format_sse_event(
                        emit_state_delta(
                            delta=[{"op": "replace", "path": "/plan", "value": tool_content}]
                        )
                    )

                # Human-in-the-loop input request → CUSTOM INPUT_REQUIRED
                elif tool_name == "request_user_input" and tool_content:
                    try:
                        tool_result = json.loads(tool_content)
                        fields = tool_result.get("fields", [])
                        title = tool_result.get("title", "Input Required")
                        description = tool_result.get("description", "")
                        prompt_text = f"**{title}**\n\n{description}"
                        payload = {"content": prompt_text, "fields": fields}
                        persistence.append_event(
                            turn_id, "input_required",
                            {"content": prompt_text, "fields": fields},
                            conversation_id=conv_id,
                        )
                        yield format_sse_event(emit_custom(name="INPUT_REQUIRED", value=payload))
                    except (json.JSONDecodeError, TypeError):
                        yield format_sse_event(
                            emit_custom(
                                name="INPUT_REQUIRED",
                                value={"content": tool_content},
                            )
                        )

                # Skip ResponseFormat tool result (content already emitted above)
                elif tool_name.lower() in ("responseformat", "platformengineerresponse"):
                    pass

                else:
                    # Emit TOOL_CALL_END for all other tools
                    tool_call_id = open_tool_calls.pop(tool_name, None) or str(uuid.uuid4())
                    persistence.append_event(
                        turn_id, "tool_end",
                        {"tool_name": tool_name},
                        conversation_id=conv_id,
                    )
                    yield format_sse_event(emit_tool_end(tool_call_id=tool_call_id))

    except Exception as exc:
        logger.error("SSE stream error: %s", exc, exc_info=True)
        # Close any open text message before emitting the error
        close_frame = _close_message_if_open()
        if close_frame:
            yield close_frame
        persistence.complete_turn(turn_id, "".join(accumulated_content), status="failed")
        yield format_sse_event(emit_run_error(message=str(exc)))
        yield format_sse_event(emit_run_finished(run_id=run_id, thread_id=thread_id))
        return

    # Close any open text message before finishing
    close_frame = _close_message_if_open()
    if close_frame:
        yield close_frame

    # Finalise the turn in persistence
    final_content = "".join(accumulated_content)
    persistence.complete_turn(turn_id, final_content)
    yield format_sse_event(emit_run_finished(run_id=run_id, thread_id=thread_id))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_text(content) -> str:
    """Normalise LangChain message content to a plain string.

    LangChain (and Bedrock in particular) can return content as either a
    plain string or a list of typed content blocks.  We extract text parts
    and concatenate them.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                # Bedrock text block: {"type": "text", "text": "..."}
                # Skip tool_use blocks — their content is handled separately.
                if block.get("type") in ("text", None):
                    parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
            else:
                parts.append(str(block))
        return "".join(parts)
    return str(content) if content else ""

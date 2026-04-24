# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Middleware to sanitize tool_use names before they reach the model.

When the model hallucinates XML-style tool calls (e.g. ``<invoke name="get_current_date" />``),
the Bedrock streaming parser can store the raw XML fragment as the ``tool_use.name`` field —
e.g. ``get_current_date" />\n</invoke>``.  Bedrock's ConverseStream rejects any name that
doesn't match ``[a-zA-Z0-9_-]+``, causing a ValidationException that exhausts all retries.

This middleware runs in ``before_agent`` to strip any trailing garbage from tool call names
in the message history so that every message sent to Bedrock has a clean, valid name.
"""

import logging
import re
from typing import Any

from langchain_core.messages import AIMessage
from langgraph.types import Overwrite

try:
    from langchain.agents.middleware.types import AgentMiddleware, AgentState
except ImportError:
    try:
        from langchain.agents.middleware import AgentMiddleware, AgentState
    except ImportError:
        from deepagents.middleware import AgentMiddleware, AgentState

logger = logging.getLogger(__name__)

_VALID_TOOL_NAME = re.compile(r"^[a-zA-Z0-9_-]+$")
_LEADING_VALID = re.compile(r"^([a-zA-Z0-9_-]+)")


def _sanitize_name(name: str) -> str:
    """Return the leading valid portion of a tool name, or the name unchanged if already valid."""
    if _VALID_TOOL_NAME.match(name):
        return name
    m = _LEADING_VALID.match(name)
    if m:
        clean = m.group(1)
        logger.warning(
            "[SanitizeToolNamesMiddleware] Corrected invalid tool_use name %r → %r "
            "(likely XML-artifact from model hallucination)",
            name,
            clean,
        )
        return clean
    # No valid prefix at all — return as-is and let Bedrock surface the error normally
    logger.error("[SanitizeToolNamesMiddleware] Cannot sanitize tool_use name %r — no valid prefix", name)
    return name


class SanitizeToolNamesMiddleware(AgentMiddleware):
    """Strips XML artifacts from tool_use names before the agent/model is invoked.

    Bedrock ConverseStream requires tool names to match ``[a-zA-Z0-9_-]+``.  When the
    model produces XML-style tool calls (e.g. ``<invoke name="foo" />``) the parser can
    embed the XML fragment in the ``name`` field, which Bedrock then rejects.

    This middleware scans every ``AIMessage`` in the history and truncates any tool call
    name to its leading valid characters.
    """

    def before_agent(self, state: AgentState, runtime: Any = None) -> dict[str, Any] | None:  # noqa: ARG002
        """Sanitize tool_use names in all AIMessages before the agent runs."""
        messages = state.get("messages") or []
        if not messages:
            return None

        patched: list = []
        any_patched = False

        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                clean_calls = []
                msg_patched = False
                for tc in msg.tool_calls:
                    raw_name = tc.get("name", "")
                    clean_name = _sanitize_name(raw_name)
                    if clean_name != raw_name:
                        tc = {**tc, "name": clean_name}
                        msg_patched = True
                    clean_calls.append(tc)

                if msg_patched:
                    any_patched = True
                    # Rebuild the AIMessage with corrected tool_calls.
                    # Copy all extra fields so nothing else is lost.
                    patched.append(
                        AIMessage(
                            content=msg.content,
                            tool_calls=clean_calls,
                            additional_kwargs=msg.additional_kwargs,
                            response_metadata=msg.response_metadata,
                            id=msg.id,
                        )
                    )
                    continue

            patched.append(msg)

        if not any_patched:
            return None

        return {"messages": Overwrite(patched)}

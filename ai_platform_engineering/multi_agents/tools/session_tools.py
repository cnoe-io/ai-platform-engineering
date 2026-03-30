"""Session management tools for the single-node supervisor.

These tools allow the supervisor (platform engineer) to manage
conversations and sessions on the Dynamic Agents backend service.
They communicate via HTTP with the Dynamic Agents API.

Environment:
    DYNAMIC_AGENTS_URL: Base URL of the Dynamic Agents backend
                        (default: http://localhost:8100).
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from typing import Any

import httpx
from langchain_core.tools import tool

logger = logging.getLogger(__name__)

DYNAMIC_AGENTS_URL = os.environ.get("DYNAMIC_AGENTS_URL", "http://localhost:8100")
_TIMEOUT = 30.0
_STREAM_TIMEOUT = 300.0


def _api_url(path: str) -> str:
    return f"{DYNAMIC_AGENTS_URL.rstrip('/')}/api/v1{path}"


def _get(path: str, params: dict | None = None) -> Any:
    """Synchronous GET against the Dynamic Agents API."""
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.get(_api_url(path), params=params)
        resp.raise_for_status()
        return resp.json()


def _post(path: str, body: dict | None = None) -> Any:
    """Synchronous POST against the Dynamic Agents API."""
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(_api_url(path), json=body or {})
        resp.raise_for_status()
        return resp.json()


def _collect_sse_response(path: str, body: dict) -> str:
    """POST to an SSE endpoint and collect the full assistant response.

    Parses SSE events from the Dynamic Agents backend. Content events
    carry the text as a JSON-encoded string. Tool events are logged but
    not included in the returned text.  The stream ends with an
    ``event: done`` line.
    """
    content_parts: list[str] = []
    current_event_type: str = ""

    with httpx.Client(timeout=httpx.Timeout(_STREAM_TIMEOUT, connect=10.0)) as client:
        with client.stream("POST", _api_url(path), json=body) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line.startswith("event: "):
                    current_event_type = line[7:].strip()
                    continue

                if not line.startswith("data: "):
                    continue

                raw = line[6:]
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                if current_event_type == "done":
                    break

                if current_event_type == "content":
                    if isinstance(data, str) and data:
                        content_parts.append(data)
                    elif isinstance(data, dict):
                        text = data.get("text") or data.get("content") or ""
                        if text:
                            content_parts.append(text)
                elif current_event_type in ("error", "warning"):
                    msg = ""
                    if isinstance(data, dict):
                        msg = data.get("message") or data.get("error") or str(data)
                    elif isinstance(data, str):
                        msg = data
                    if msg:
                        content_parts.append(f"\n[{current_event_type}] {msg}\n")

    return "".join(content_parts)


# ── Tools ────────────────────────────────────────────────────────────────


@tool
def sessions_list(agent_id: str | None = None, limit: int = 10) -> str:
    """List sessions (conversations) across dynamic agents with their full conversation_id.

    Use this FIRST to discover valid conversation IDs before calling
    sessions_history or sessions_send. Never guess or fabricate a
    conversation_id -- always get it from this tool.

    Args:
        agent_id: Filter by a specific agent ID (e.g. 'coding-agent'). If None, lists across all agents.
        limit: Maximum number of sessions to return per agent (default 10).
    """
    try:
        agents_resp = _get("/agents", params={"limit": 100})
        agents = agents_resp.get("items", agents_resp.get("data", []))
    except Exception as exc:
        return f"Error fetching agents: {exc}"

    if agent_id:
        agents = [a for a in agents if a.get("_id", a.get("id")) == agent_id]
        if not agents:
            return f"Agent '{agent_id}' not found."

    rows: list[str] = []
    for agent in agents:
        aid = agent.get("_id", agent.get("id", "?"))
        aname = agent.get("name", aid)
        sandbox_flag = " [sandbox]" if (agent.get("sandbox") or {}).get("enabled") else ""

        try:
            convs = _get_conversations_for_agent(aid, limit=limit)
        except Exception:
            convs = []

        if convs:
            rows.append(f"Agent: {aname} ({aid}){sandbox_flag}")
            for c in convs:
                cid = c.get("_id", c.get("id", "?"))
                title = c.get("title", "Untitled")
                updated = c.get("updated_at", c.get("created_at", ""))
                rows.append(f"  conversation_id={cid}  title=\"{title}\"  updated={updated}")
        else:
            rows.append(f"Agent: {aname} ({aid}){sandbox_flag} — no conversations")

    if not rows:
        return "No dynamic agents found."
    return "\n".join(rows)


def _get_conversations_for_agent(agent_id: str, limit: int = 10) -> list[dict]:
    """Fetch recent conversations for a given agent via MongoDB proxy."""
    try:
        resp = _get(f"/agents/{agent_id}")
        agent = resp.get("data", resp)
        if not agent:
            return []
    except Exception:
        return []

    # The conversations collection can be queried via the metadata endpoint
    # but there's no list endpoint. We query MongoDB directly via an internal
    # endpoint that doesn't require auth in dev mode.
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            r = client.get(
                _api_url("/conversations/by-agent"),
                params={"agent_id": agent_id, "limit": limit},
            )
            if r.status_code == 200:
                return r.json().get("conversations", [])
    except Exception:
        pass

    return []


@tool
def sessions_history(
    conversation_id: str,
    agent_id: str,
    max_messages: int = 50,
) -> str:
    """Fetch the message history (transcript) of a specific session.

    The conversation_id MUST be a real ID obtained from sessions_list
    or sessions_spawn. Do NOT guess or fabricate IDs.

    Args:
        conversation_id: The full conversation UUID (from sessions_list or sessions_spawn).
        agent_id: The dynamic agent ID that owns this conversation (e.g. 'coding-agent').
        max_messages: Max messages to return (default 50).
    """
    try:
        resp = _get(
            f"/conversations/{conversation_id}/messages",
            params={"agent_id": agent_id},
        )
    except httpx.HTTPStatusError as exc:
        return f"Error: {exc.response.status_code} — {exc.response.text}"
    except Exception as exc:
        return f"Error fetching history: {exc}"

    messages = resp.get("messages", [])
    if not messages:
        return f"No messages found for conversation {conversation_id}."

    lines: list[str] = []
    for msg in messages[:max_messages]:
        role = msg.get("role", "?")
        content = msg.get("content", "")
        ts = msg.get("timestamp", "")
        prefix = "User" if role == "user" else "Assistant"
        # Truncate very long messages
        if len(content) > 500:
            content = content[:500] + "... (truncated)"
        lines.append(f"[{prefix}] {ts}\n{content}")

    has_interrupt = resp.get("has_pending_interrupt", False)
    header = f"Session {conversation_id} — {len(messages)} messages"
    if has_interrupt:
        header += " (PENDING INTERRUPT — waiting for user input)"
    if len(messages) > max_messages:
        header += f" (showing first {max_messages})"

    return header + "\n" + ("-" * 40) + "\n" + "\n\n".join(lines)


@tool
def session_status(
    conversation_id: str,
    agent_id: str,
) -> str:
    """Get a status card for a specific session, showing state and health.

    Args:
        conversation_id: The conversation/session ID.
        agent_id: The dynamic agent ID.
    """
    # Fetch messages
    try:
        msg_resp = _get(
            f"/conversations/{conversation_id}/messages",
            params={"agent_id": agent_id},
        )
    except Exception as exc:
        return f"Error fetching session: {exc}"

    messages = msg_resp.get("messages", [])
    has_interrupt = msg_resp.get("has_pending_interrupt", False)

    user_count = sum(1 for m in messages if m.get("role") == "user")
    assistant_count = sum(1 for m in messages if m.get("role") == "assistant")

    last_activity = ""
    if messages:
        last_msg = messages[-1]
        last_activity = last_msg.get("timestamp", "unknown")

    last_role = messages[-1].get("role", "?") if messages else "none"

    # Determine session state
    if has_interrupt:
        state = "WAITING_FOR_INPUT"
    elif last_role == "assistant":
        state = "IDLE (last response from assistant)"
    elif last_role == "user":
        state = "PROCESSING (last message from user)"
    else:
        state = "EMPTY"

    # Fetch sandbox status if available
    sandbox_line = ""
    try:
        sb_resp = _get(f"/sandbox/status/{agent_id}")
        if sb_resp.get("sandbox_enabled"):
            phase = sb_resp.get("phase", "unknown")
            sandbox_line = f"\nSandbox: {phase}"
    except Exception:
        pass

    # Fetch todos
    todos_line = ""
    try:
        todos_resp = _get(
            f"/conversations/{conversation_id}/todos",
            params={"agent_id": agent_id},
        )
        todos = todos_resp.get("todos", [])
        if todos:
            done = sum(1 for t in todos if t.get("status") == "completed")
            in_prog = sum(1 for t in todos if t.get("status") == "in_progress")
            pending = sum(1 for t in todos if t.get("status") == "pending")
            todos_line = f"\nTodos: {done} done, {in_prog} in-progress, {pending} pending"
    except Exception:
        pass

    # Agent info
    agent_name = agent_id
    try:
        agent_resp = _get(f"/agents/{agent_id}")
        agent_data = agent_resp.get("data", agent_resp)
        agent_name = agent_data.get("name", agent_id)
    except Exception:
        pass

    return (
        f"Session Status: {conversation_id}\n"
        f"Agent: {agent_name} ({agent_id})\n"
        f"State: {state}\n"
        f"Messages: {user_count} user, {assistant_count} assistant ({len(messages)} total)\n"
        f"Last activity: {last_activity}"
        f"{sandbox_line}"
        f"{todos_line}"
    )


@tool
def sessions_send(
    conversation_id: str,
    agent_id: str,
    message: str,
    wait_for_response: bool = True,
) -> str:
    """Send a follow-up message to an existing dynamic agent session.

    IMPORTANT: This blocks until the agent finishes its full response
    (including any tool calls it makes internally). This can take
    30-300 seconds for complex tasks. Do NOT assume it failed if it
    takes a while.

    If the returned text is empty, the agent likely performed tool
    calls but produced no final text. Use sessions_history to read
    the full transcript.

    Args:
        conversation_id: The full conversation UUID (from sessions_list or sessions_spawn).
        agent_id: The dynamic agent ID (e.g. 'coding-agent').
        message: The message text to send.
        wait_for_response: If True (default), blocks until the agent
            finishes and returns its text response. If False, fires
            and returns immediately.
    """
    body = {
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "message": message,
    }

    if not wait_for_response:
        try:
            _post("/chat/start-stream", body=body)
            return f"Message sent to session {conversation_id}. Use sessions_history or sessions_yield to check the response."
        except Exception as exc:
            return f"Error sending message: {exc}"

    try:
        response_text = _collect_sse_response("/chat/start-stream", body)
        if not response_text.strip():
            return (
                f"Message sent to session {conversation_id}. The agent performed actions but "
                f"returned no text. Use sessions_history(conversation_id='{conversation_id}', "
                f"agent_id='{agent_id}') to read the full transcript."
            )
        return f"Response from {conversation_id}:\n{response_text}"
    except Exception as exc:
        return f"Error sending message: {exc}"


@tool
def sessions_spawn(
    agent_id: str,
    message: str,
    wait: bool = False,
) -> str:
    """Create a new session with a dynamic agent and send an initial message.

    Returns immediately (default wait=False) with the new conversation_id
    so the agent can continue working while the sub-agent processes the task.

    After spawning, use one of:
    - sessions_history to check the transcript after a short wait
    - sessions_yield to block until the sub-agent finishes

    Args:
        agent_id: The dynamic agent ID to delegate to (e.g. 'coding-agent').
        message: The task or question for the agent. Be specific and complete.
        wait: If True, blocks until the sub-agent finishes (can take 30-300s).
            If False (default), returns immediately with the conversation_id.
    """
    conversation_id = str(uuid.uuid4())

    # Ensure conversation metadata exists (agent_id is a query param)
    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            client.post(
                _api_url(f"/conversations/{conversation_id}/metadata"),
                params={"agent_id": agent_id},
            )
    except Exception:
        pass  # metadata creation is best-effort

    body = {
        "agent_id": agent_id,
        "conversation_id": conversation_id,
        "message": message,
    }

    if not wait:
        import threading

        def _fire() -> None:
            try:
                _collect_sse_response("/chat/start-stream", body)
            except Exception:
                pass

        threading.Thread(target=_fire, daemon=True).start()
        return (
            f"Spawned new session: {conversation_id}\n"
            f"Agent: {agent_id}\n"
            f"Use sessions_yield(conversation_id='{conversation_id}', agent_id='{agent_id}') to wait for the result."
        )

    try:
        response_text = _collect_sse_response("/chat/start-stream", body)
        if not response_text.strip():
            return (
                f"Session {conversation_id} completed (agent performed actions but returned no text).\n"
                f"Use sessions_history(conversation_id='{conversation_id}', agent_id='{agent_id}') "
                f"to read the full transcript including tool outputs."
            )
        return (
            f"Session {conversation_id} completed.\n"
            f"Response:\n{response_text}"
        )
    except Exception as exc:
        return f"Spawned session {conversation_id} but error waiting for response: {exc}"


@tool
def sessions_yield(
    conversation_id: str,
    agent_id: str,
    timeout_seconds: int = 300,
    poll_interval_seconds: int = 10,
) -> str:
    """Wait for a previously spawned session to finish (used after sessions_spawn with wait=False).

    Polls until the message count stabilises AND the last message is
    from the assistant (i.e. the agent is no longer producing output).
    This avoids returning prematurely when the agent has only sent an
    initial response and is still performing tool calls.

    Args:
        conversation_id: The full conversation UUID from sessions_spawn.
        agent_id: The dynamic agent ID.
        timeout_seconds: Maximum time to wait (default 300s).
        poll_interval_seconds: How often to poll (default 10s).
    """
    deadline = time.monotonic() + timeout_seconds
    prev_count = 0
    stable_polls = 0
    required_stable = 2  # must see same count for N consecutive polls

    while time.monotonic() < deadline:
        try:
            resp = _get(
                f"/conversations/{conversation_id}/messages",
                params={"agent_id": agent_id},
            )
            messages = resp.get("messages", [])
            has_interrupt = resp.get("has_pending_interrupt", False)
            cur_count = len(messages)

            if has_interrupt:
                return (
                    f"Session {conversation_id} is waiting for user input (HITL interrupt).\n"
                    f"Use sessions_send to provide the requested input."
                )

            if cur_count > 0 and messages[-1].get("role") == "assistant":
                if cur_count == prev_count:
                    stable_polls += 1
                else:
                    stable_polls = 0
                    prev_count = cur_count

                if stable_polls >= required_stable:
                    content = messages[-1].get("content", "")
                    return (
                        f"Session {conversation_id} completed ({cur_count} messages).\n"
                        f"Final response:\n{content}"
                    )
            else:
                stable_polls = 0
                prev_count = cur_count

        except Exception as exc:
            logger.debug("Poll error for %s: %s", conversation_id, exc)

        time.sleep(poll_interval_seconds)

    # Timed out — return whatever we have
    try:
        resp = _get(
            f"/conversations/{conversation_id}/messages",
            params={"agent_id": agent_id},
        )
        messages = resp.get("messages", [])
        if messages:
            content = messages[-1].get("content", "")
            return (
                f"Timeout after {timeout_seconds}s — session {conversation_id} may still be running "
                f"({len(messages)} messages so far).\n"
                f"Latest message:\n{content}"
            )
    except Exception:
        pass

    return (
        f"Timeout after {timeout_seconds}s waiting for session {conversation_id}. "
        f"The agent may still be processing. Use sessions_history to check later."
    )


@tool
def subagents(
    action: str = "list",
    agent_id: str | None = None,
) -> str:
    """Monitor and manage dynamic sub-agents.

    Args:
        action: One of 'list' (show all agents and recent sessions),
            'status' (detailed status for a single agent), or
            'stop' (not yet supported).
        agent_id: Required for 'status' action.
    """
    if action == "list":
        try:
            agents_resp = _get("/agents", params={"limit": 100})
            agents = agents_resp.get("items", agents_resp.get("data", []))
        except Exception as exc:
            return f"Error fetching agents: {exc}"

        if not agents:
            return "No dynamic agents configured."

        lines: list[str] = []
        for a in agents:
            aid = a.get("_id", a.get("id", "?"))
            name = a.get("name", aid)
            enabled = a.get("enabled", True)
            model = a.get("model_id", "default")
            sandbox = (a.get("sandbox") or {}).get("enabled", False)
            status_icon = "active" if enabled else "disabled"
            sandbox_tag = " [sandbox]" if sandbox else ""
            lines.append(f"  {name} ({aid}) — {status_icon}{sandbox_tag} — model: {model}")

        return f"Dynamic Agents ({len(agents)}):\n" + "\n".join(lines)

    elif action == "status":
        if not agent_id:
            return "Error: agent_id is required for 'status' action."
        try:
            agent_resp = _get(f"/agents/{agent_id}")
            agent = agent_resp.get("data", agent_resp)
        except httpx.HTTPStatusError as exc:
            return f"Agent not found: {exc.response.status_code}"
        except Exception as exc:
            return f"Error: {exc}"

        aid = agent.get("_id", agent.get("id", agent_id))
        name = agent.get("name", aid)
        model = agent.get("model_id", "default")
        provider = agent.get("model_provider", "?")
        enabled = agent.get("enabled", True)
        sandbox_cfg = agent.get("sandbox") or {}
        sandbox_enabled = sandbox_cfg.get("enabled", False)
        tools_map = agent.get("allowed_tools") or {}
        server_count = len(tools_map)
        description = agent.get("description", "")

        info = (
            f"Agent: {name} ({aid})\n"
            f"Description: {description}\n"
            f"Model: {provider}/{model}\n"
            f"Enabled: {enabled}\n"
            f"MCP Servers: {server_count}\n"
            f"Sandbox: {'enabled' if sandbox_enabled else 'disabled'}\n"
        )

        if sandbox_enabled:
            try:
                sb = _get(f"/sandbox/status/{aid}")
                phase = sb.get("phase", "unknown")
                info += f"Sandbox Phase: {phase}\n"
            except Exception:
                info += "Sandbox Phase: unknown (could not reach API)\n"

        return info

    elif action == "stop":
        return "Stop is not yet implemented. Use the UI or API to manage agent sessions."

    else:
        return f"Unknown action '{action}'. Supported: list, status, stop."

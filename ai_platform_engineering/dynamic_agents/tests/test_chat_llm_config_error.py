"""Pin the SSE error mapping for LLMConfigError.

Before the fix, an unconfigured agent (e.g. the seeded `hello-world` with
empty model.provider/model.id and no env defaults) bubbled up as a generic
`Exception` and Slack/Webex printed:

    "Something went wrong - some tools or subagents may have timed out.
     Would you like to try again?"

That message is misleading (nothing timed out, no tools ran) and gives the
operator no actionable hint.

`_generate_sse_events` now catches `RuntimeInitError` whose cause is
`LLMConfigError` and emits the actionable text on the SSE error frame so
the client renders something the operator can act on.
"""

from __future__ import annotations

import importlib
from typing import Any

import pytest


chat = importlib.import_module("dynamic_agents.routes.chat")
llm_clients = importlib.import_module("dynamic_agents.services.llm_clients")
runtime_cache = importlib.import_module("dynamic_agents.services.runtime_cache")


class _CapturingEncoder:
    """Minimal StreamEncoder stand-in. Captures the messages passed to
    on_run_error so the test can assert what reached the wire.
    """

    def __init__(self) -> None:
        self.errors: list[str] = []

    def on_run_error(self, message: str):
        self.errors.append(message)
        yield f"data: error:{message}\n\n"


class _AgentConfigStub:
    """Stand-in for DynamicAgentConfig — only `name` and `id` are touched
    on the error path."""

    id = "hello-world"
    name = "Hello World"


class _CacheStub:
    """Stand-in for the runtime cache whose `get_or_create` raises the
    given exception. Mirrors only what `_generate_sse_events` calls.
    """

    def __init__(self, exc: Exception) -> None:
        self._exc = exc

    def set_mongo_service(self, _mongo: Any) -> None:
        pass

    async def get_or_create(self, *_args: Any, **_kwargs: Any):
        raise self._exc


class _UserStub:
    email = "alice@example.com"


async def _drain(agen):
    out = []
    async for frame in agen:
        out.append(frame)
    return out


@pytest.mark.asyncio
async def test_llm_config_error_surfaces_actionable_message(monkeypatch):
    cause = llm_clients.LLMConfigError(
        "Agent has no LLM provider configured and no deployment default "
        "(LLM_PROVIDER) is set. Open Admin UI → Custom Agents and pick a "
        "provider/model for this agent, or set LLM_PROVIDER on the "
        "dynamic-agents service."
    )
    wrapped = runtime_cache.RuntimeInitError("hello-world", cause)
    cache = _CacheStub(wrapped)
    monkeypatch.setattr(chat, "get_runtime_cache", lambda: cache)

    encoder = _CapturingEncoder()

    frames = await _drain(
        chat._generate_sse_events(
            agent_config=_AgentConfigStub(),
            mcp_servers=[],
            message="hi",
            session_id="sess-1",
            user=_UserStub(),
            encoder=encoder,
        )
    )

    assert len(encoder.errors) == 1
    msg = encoder.errors[0]
    assert "LLM_PROVIDER" in msg
    assert "Admin UI" in msg
    # Make sure the *generic* fallback was NOT used.
    assert chat.GENERIC_AGENT_ERROR not in msg
    # And one SSE frame was emitted with the same text.
    assert any("LLM_PROVIDER" in f for f in frames)


@pytest.mark.asyncio
async def test_runtime_init_error_with_unknown_cause_still_uses_generic(monkeypatch):
    """If the runtime fails to init for a non-LLM reason (e.g. bad
    Jinja template), keep the generic message — we don't want to leak
    arbitrary internals to the client.
    """
    wrapped = runtime_cache.RuntimeInitError("hello-world", RuntimeError("boom"))
    cache = _CacheStub(wrapped)
    monkeypatch.setattr(chat, "get_runtime_cache", lambda: cache)

    encoder = _CapturingEncoder()

    await _drain(
        chat._generate_sse_events(
            agent_config=_AgentConfigStub(),
            mcp_servers=[],
            message="hi",
            session_id="sess-2",
            user=_UserStub(),
            encoder=encoder,
        )
    )

    assert encoder.errors == [chat.GENERIC_AGENT_ERROR]


@pytest.mark.asyncio
async def test_unrelated_exception_still_uses_generic(monkeypatch):
    cache = _CacheStub(ValueError("something else entirely"))
    monkeypatch.setattr(chat, "get_runtime_cache", lambda: cache)

    encoder = _CapturingEncoder()

    await _drain(
        chat._generate_sse_events(
            agent_config=_AgentConfigStub(),
            mcp_servers=[],
            message="hi",
            session_id="sess-3",
            user=_UserStub(),
            encoder=encoder,
        )
    )

    assert encoder.errors == [chat.GENERIC_AGENT_ERROR]

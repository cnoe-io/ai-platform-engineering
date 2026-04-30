# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for the skill-content tracing scrubber.

Pins the contract: skill payloads (SKILL.md bodies, ancillary file
contents, skills_metadata channel) are stripped from spans before
the OTLP exporter sees them, while normal chat / tool I/O is left
intact. A regression here would silently start exfiltrating skill
content to Langfuse on every step of every multi-step skill run.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest import mock

import pytest

from ai_platform_engineering.utils.tracing.skill_scrubber import (
    DEFAULT_PLACEHOLDER,
    SkillContentScrubbingProcessor,
    _redact_value,
    _scrub_json,
    _strip_skills_section,
    install_skill_content_scrubber,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------

class _FakeSpan:
    """Minimal stand-in for ``opentelemetry.sdk.trace.ReadableSpan``."""

    def __init__(self, attributes: dict[str, Any]) -> None:
        # The real SDK exposes ``attributes`` as a read-only mapping
        # but the underlying ``_attributes`` dict is mutable. We let
        # tests poke either to mirror both code paths in
        # ``on_end``'s defensive write logic.
        self._attributes: dict[str, Any] = dict(attributes)

    @property
    def attributes(self) -> dict[str, Any]:
        return self._attributes

    def set_attribute(self, key: str, value: Any) -> None:
        self._attributes[key] = value


# ---------------------------------------------------------------------------
# Section stripping
# ---------------------------------------------------------------------------

def test_strip_skills_section_removes_block_until_next_header() -> None:
    prompt = (
        "You are a helpful assistant.\n"
        "\n"
        "## Skills System\n"
        "\n"
        "**Available Skills:**\n"
        "- foo: do foo\n"
        "  -> Read `/skills/user/foo/SKILL.md` for full instructions\n"
        "\n"
        "## Other instructions\n"
        "Be concise.\n"
    )
    out = _strip_skills_section(prompt)
    assert "Available Skills" not in out
    assert "/skills/user/foo/SKILL.md" not in out
    # Surrounding sections are preserved verbatim.
    assert "You are a helpful assistant." in out
    assert "## Other instructions\nBe concise." in out
    # Header is kept (with a marker) so traces still show the section
    # existed — useful for "is this prompt the right shape?" debugging.
    assert "[redacted from trace]" in out


def test_strip_skills_section_handles_block_at_end_of_prompt() -> None:
    prompt = "Top.\n## Skills System\n- a\n- b\n"
    out = _strip_skills_section(prompt)
    assert "- a" not in out
    assert "Top." in out


def test_strip_skills_section_no_op_when_section_absent() -> None:
    prompt = "Plain prompt with no skills section.\n## Tools\nUse them."
    assert _strip_skills_section(prompt) == prompt


# ---------------------------------------------------------------------------
# JSON scrubbing
# ---------------------------------------------------------------------------

def test_scrub_json_drops_skills_metadata_channel() -> None:
    payload = {
        "messages": [{"role": "user", "content": "hi"}],
        "skills_metadata": [
            {"name": "foo", "path": "/skills/user/foo/SKILL.md", "description": "d"},
        ],
        "files": {"/skills/user/foo/SKILL.md": "secret skill body" * 50},
    }
    out = _scrub_json(payload, DEFAULT_PLACEHOLDER)
    assert out["skills_metadata"] == DEFAULT_PLACEHOLDER
    # The plain "messages" channel is preserved.
    assert out["messages"] == [{"role": "user", "content": "hi"}]
    # A long string mentioning a skill path gets replaced wholesale.
    assert out["files"]["/skills/user/foo/SKILL.md"] == DEFAULT_PLACEHOLDER


def test_scrub_json_leaves_short_strings_alone() -> None:
    # Heuristic boundary: under 200 chars. A short tool-call arg
    # mentioning /skills/... is preserved (it's almost certainly a
    # path, not a body — paths are useful to keep for trace clarity).
    out = _scrub_json({"path": "/skills/user/foo/SKILL.md"}, DEFAULT_PLACEHOLDER)
    assert out == {"path": "/skills/user/foo/SKILL.md"}


def test_scrub_json_leaves_unrelated_long_strings_alone() -> None:
    body = {"text": "x" * 5000}
    assert _scrub_json(body, DEFAULT_PLACEHOLDER) == body


# ---------------------------------------------------------------------------
# Value-level redaction
# ---------------------------------------------------------------------------

def test_redact_value_passes_through_non_strings() -> None:
    assert _redact_value(42, DEFAULT_PLACEHOLDER) == 42
    assert _redact_value(None, DEFAULT_PLACEHOLDER) is None
    assert _redact_value(True, DEFAULT_PLACEHOLDER) is True


def test_redact_value_handles_json_blobs() -> None:
    raw = json.dumps(
        {
            "skills_metadata": [{"name": "x"}],
            "user_msg": "do the thing",
        }
    )
    out = _redact_value(raw, DEFAULT_PLACEHOLDER)
    parsed = json.loads(out)  # type: ignore[arg-type]
    assert parsed["skills_metadata"] == DEFAULT_PLACEHOLDER
    assert parsed["user_msg"] == "do the thing"


def test_redact_value_strips_skills_section_from_plain_prompt() -> None:
    prompt = "Sys top.\n## Skills System\n- foo\n## Tools\nuse"
    out = _redact_value(prompt, DEFAULT_PLACEHOLDER)
    assert "## Tools\nuse" in str(out)
    assert "- foo" not in str(out)


def test_redact_value_replaces_skill_read_response_wholesale() -> None:
    # Simulates a tool-call result echoing a SKILL.md body — Traceloop
    # serializes it as the .content attribute on a tool span.
    big_body = (
        "# SKILL.md content\n"
        + "x" * 500
        + "\nsourced from /skills/user/edicts/SKILL.md"
    )
    out = _redact_value(big_body, DEFAULT_PLACEHOLDER)
    assert out == DEFAULT_PLACEHOLDER


# ---------------------------------------------------------------------------
# SpanProcessor end-to-end
# ---------------------------------------------------------------------------

def test_processor_redacts_targeted_attributes_only() -> None:
    span = _FakeSpan(
        {
            # Should be scrubbed (skills section + skill state channel).
            "gen_ai.prompt.0.content": (
                "Be helpful.\n## Skills System\n- foo\n## End"
            ),
            "traceloop.entity.input": json.dumps(
                {"skills_metadata": [{"n": "x"}], "msg": "hi"}
            ),
            # Should be untouched — not a prompt/IO attribute.
            "gen_ai.usage.input_tokens": 1234,
            "gen_ai.request.model": "claude-sonnet-4-6",
            "http.status_code": 200,
        }
    )
    SkillContentScrubbingProcessor().on_end(span)
    assert "## Skills System [redacted from trace]" in span.attributes[
        "gen_ai.prompt.0.content"
    ]
    parsed = json.loads(span.attributes["traceloop.entity.input"])
    assert parsed["skills_metadata"] == DEFAULT_PLACEHOLDER
    assert parsed["msg"] == "hi"
    # Non-targeted attributes pass through unchanged.
    assert span.attributes["gen_ai.usage.input_tokens"] == 1234
    assert span.attributes["gen_ai.request.model"] == "claude-sonnet-4-6"
    assert span.attributes["http.status_code"] == 200


def test_processor_is_a_noop_for_spans_without_attributes() -> None:
    class _NullSpan:
        attributes = None

    # Must not raise.
    SkillContentScrubbingProcessor().on_end(_NullSpan())


def test_processor_swallows_errors_to_protect_exporter() -> None:
    class _ExplodingSpan:
        @property
        def attributes(self):
            raise RuntimeError("boom")

    # If the scrubber raises into the OTel SDK, the BatchSpanProcessor
    # will drop the whole batch and log a noisy traceback. Suppression
    # is intentional; we'd rather lose a redaction than break exports.
    SkillContentScrubbingProcessor().on_end(_ExplodingSpan())


# ---------------------------------------------------------------------------
# Installer
# ---------------------------------------------------------------------------

def test_install_returns_false_when_disabled_via_env() -> None:
    with mock.patch.dict(os.environ, {"SKILL_TRACE_SCRUB_ENABLED": "false"}):
        assert install_skill_content_scrubber() is False


def test_install_returns_false_when_provider_has_no_add_processor() -> None:
    # Default global TracerProvider in unit-test envs is the NoOp
    # one; it doesn't expose ``add_span_processor``. The installer
    # must detect that and bail without raising.
    with mock.patch.dict(os.environ, {"SKILL_TRACE_SCRUB_ENABLED": "true"}):
        # Ensure no real provider has been set up by an earlier test.
        from opentelemetry import trace

        provider = trace.get_tracer_provider()
        if hasattr(provider, "add_span_processor"):
            pytest.skip("global provider already initialised by another test")
        assert install_skill_content_scrubber() is False


def test_install_is_idempotent_on_real_provider() -> None:
    sdk = pytest.importorskip("opentelemetry.sdk.trace")
    from opentelemetry import trace

    provider = sdk.TracerProvider()
    trace.set_tracer_provider(provider)
    try:
        with mock.patch.dict(os.environ, {"SKILL_TRACE_SCRUB_ENABLED": "true"}):
            assert install_skill_content_scrubber() is True
            # Second call: no second processor registered.
            initial_count = len(
                provider._active_span_processor._span_processors  # type: ignore[attr-defined]
            )
            assert install_skill_content_scrubber() is True
            after_count = len(
                provider._active_span_processor._span_processors  # type: ignore[attr-defined]
            )
            assert initial_count == after_count
    finally:
        # Don't leak our provider to other tests — reset to the
        # default NoOp before returning.
        trace._TRACER_PROVIDER = None  # type: ignore[attr-defined]

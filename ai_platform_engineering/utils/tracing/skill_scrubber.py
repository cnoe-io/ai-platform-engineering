# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Operator-content scrubber for OpenTelemetry spans.

Problem
-------
The supervisor + dynamic-agents emit OTel spans through the Traceloop
(``opentelemetry-instrumentation-{langchain,bedrock,anthropic,...}``)
instrumentors. By default, those instrumentors stamp full prompt /
completion / tool-I/O bodies onto every span. Two classes of
operator-authored content end up echoed onto **every** step's span
that we want to keep out of Langfuse:

* **Skill payloads** — ``SKILL.md`` bodies and ancillary files loaded
  by the deepagents ``SkillsMiddleware``. Surface points:

  1. The ``## Skills System`` block in the system prompt
     (``gen_ai.prompt.<n>.content``) — metadata only today, still
     redundant on every step.
  2. ``read_file`` tool-call results when the agent loads
     ``/skills/<source>/<name>/SKILL.md`` or any ancillary file —
     this is where the bulk volume lives.
  3. The ``skills_metadata`` graph-state channel that Traceloop's
     LangChain instrumentor stamps as ``traceloop.entity.input`` /
     ``...output`` on each node.

* **task_config workflow prompts** — multi-paragraph operator
  instructions defined under ``task_configs`` in MongoDB / the
  fallback ``task_config.yaml``. Surface points:

  4. The ``tasks`` / ``todos`` graph-state channels (each entry
     carries the rendered ``llm_prompt``) — stamped on every node
     span by the LangChain instrumentor for the duration of a
     workflow run.
  5. The ``get_workflow_definition`` tool result, which renders
     every step's ``llm_prompt`` inside a ``## Workflow:`` block.
  6. The ``invoke_self_service_task`` tool span input/output — the
     tool's state-update return carries the full ``tasks`` array.

Setting ``TRACELOOP_TRACE_CONTENT=false`` would fix this but it also
wipes every chat / tool body globally, which kills debuggability of
non-skill flows. This processor does a scoped redaction instead.

Design
------
Implemented as an OTel ``SpanProcessor`` so we can rewrite span
attributes during ``on_end`` (after the instrumentor populates
them, before the OTLP exporter ships them). The redaction is
defensive — unknown attribute shapes pass through untouched, so a
bug here can never break tracing, only fail to redact.

We register the processor by attaching it to the active
``TracerProvider``. ``cnoe_agent_utils.tracing.manager`` installs
its own ``BatchSpanProcessor`` first; we install ours alongside.
The OTel SDK fans every span through every registered processor in
registration order, so as long as we install before the first span
fires (i.e. immediately after tracing init at app startup) we're
good.

Configuration
-------------
``SKILL_TRACE_SCRUB_ENABLED=true`` (default) — turn the scrubber on.
``SKILL_TRACE_SCRUB_PLACEHOLDER`` — the string that replaces redacted
content (default ``"[redacted: skill payload]"``).

Set ``SKILL_TRACE_SCRUB_ENABLED=false`` for one debug session if you
need to read raw skill prompts in Langfuse.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tunables
# ---------------------------------------------------------------------------

DEFAULT_PLACEHOLDER = "[redacted: skill payload]"

# Match deepagents skill paths in tool-call inputs. The middleware
# always uses absolute paths under ``/skills/<source>/<name>/...``
# (see ``deepagents.middleware.skills`` ``_format_skills_locations``).
# We match liberally so future source-name additions Just Work.
_SKILL_PATH_RE = re.compile(r"(?:^|[^a-zA-Z0-9_])/skills/[^\s\"',)]+", re.IGNORECASE)

# Boundary markers for the two operator-authored content blocks we
# strip from prompts: deepagents' SkillsMiddleware section and the
# platform-engineer's task_config workflow listing.
_SKILLS_SECTION_HEADER = "## Skills System"
_WORKFLOW_SECTION_HEADER = "## Self-Service Workflows"
# Header rendered by ``get_workflow_definition`` tool output for
# each requested workflow (the bulk-payload case).
_WORKFLOW_DEFN_HEADER = "## Workflow:"

# Tool / entity names whose I/O we redact wholesale because they
# echo task_config llm_prompts directly. These are stable surface
# names from
# ``ai_platform_engineering/multi_agents/platform_engineer/deep_agent.py``.
_WORKFLOW_TOOL_NAMES = frozenset(
    {
        "get_workflow_definition",
        "invoke_self_service_task",
        # list_self_service_workflows returns names only — small —
        # so we deliberately leave it alone for trace clarity.
    }
)

# Attributes whose **value** should be inspected and rewritten.
# Listed by stable Traceloop / OTel-GenAI semantic-convention
# prefixes so future minor-version attribute additions are caught.
_PROMPT_ATTR_PREFIXES = (
    "gen_ai.prompt.",        # OTel GenAI semconv (any role)
    "gen_ai.completion.",    # rarely contains skill text but cheap to check
    "llm.prompts.",          # Traceloop legacy
    "llm.completions.",
)

# LangChain instrumentor attaches per-node input/output blobs here.
_LANGCHAIN_IO_ATTR_KEYS = (
    "traceloop.entity.input",
    "traceloop.entity.output",
    "langchain.task.input",
    "langchain.task.output",
)

# State channels we want to drop entirely when serialized into a
# JSON blob on an attribute. Both skill catalogs and task_config
# workflows live in the agent's graph state and therefore get
# stamped onto every node span by the LangChain instrumentor.
_SENSITIVE_STATE_CHANNELS = (
    "skills_metadata",
    "skills",       # alternate name some middlewares use
    "tasks",        # task_config: list of dicts with full llm_prompt
    "todos",        # mirrors `tasks` (display_text + status)
)


# ---------------------------------------------------------------------------
# Redaction primitives
# ---------------------------------------------------------------------------

def _strip_marker_section(text: str, header: str) -> str:
    """Remove a ``## <header>`` block from a markdown-shaped string.

    The block is bounded by ``header`` on one end and either the
    next top-level (``##`` / ``#``) header or end-of-string on the
    other. The rest of the message (operator instructions, tool
    docs, …) is preserved verbatim. Returns ``text`` unchanged when
    the header is absent.
    """
    if header not in text:
        return text
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    skipping = False
    for line in lines:
        stripped = line.lstrip()
        if stripped.startswith(header):
            skipping = True
            out.append(f"{header} [redacted from trace]\n")
            continue
        if skipping:
            # Only stop at top-level (## or #) headers so we don't
            # accidentally exit on bullet sub-headers nested in the
            # skills/workflows block.
            if stripped.startswith("## ") or stripped.startswith("# "):
                skipping = False
                out.append(line)
            # else: drop the line
        else:
            out.append(line)
    return "".join(out)


def _strip_known_sections(text: str) -> str:
    """Strip every operator-authored sensitive section we know about."""
    text = _strip_marker_section(text, _SKILLS_SECTION_HEADER)
    text = _strip_marker_section(text, _WORKFLOW_SECTION_HEADER)
    text = _strip_marker_section(text, _WORKFLOW_DEFN_HEADER)
    return text


# Back-compat shim — earlier tests import the old name.
_strip_skills_section = _strip_known_sections


def _looks_like_skill_read(value: str) -> bool:
    """True when a string mentions a ``/skills/...`` path.

    Used to detect tool-call inputs that are pulling skill files.
    Matching the path (rather than the result body) is more
    reliable than scanning the body itself because SKILL.md bodies
    can be arbitrary markdown that we can't fingerprint.
    """
    return bool(_SKILL_PATH_RE.search(value))


def _redact_value(value: Any, placeholder: str) -> Any:
    """Best-effort scrub of a single attribute value.

    We handle three shapes:

    * **JSON-encoded dict** (the most common Traceloop shape) — parse,
      walk, redact known keys, re-serialize.
    * **Plain string** — strip the ``## Skills System`` block; if the
      remainder still mentions a ``/skills/...`` read, replace whole.
    * **Anything else** (numbers, bools, sequences) — leave alone.

    Returns the original value when in doubt; never raises.
    """
    if not isinstance(value, str):
        return value

    # Try JSON first — covers traceloop.entity.input / .output and
    # most of the gen_ai.prompt.<n>.content shapes that LangChain
    # callbacks JSON-encode.
    stripped = value.lstrip()
    if stripped.startswith("{") or stripped.startswith("["):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, ValueError):
            parsed = None
        if parsed is not None:
            scrubbed = _scrub_json(parsed, placeholder)
            try:
                return json.dumps(scrubbed, ensure_ascii=False)
            except (TypeError, ValueError):
                return placeholder
        # Fall through to plain-string handling on JSON parse failure.

    # Plain string path.
    redacted = _strip_known_sections(value)
    if _looks_like_skill_read(redacted):
        # The string is a tool-call result that loaded a skill file
        # (or a system message with embedded skill paths). Wholesale
        # replace — partial scrubbing of arbitrary markdown is too
        # fragile to be worth it.
        return placeholder
    return redacted


def _scrub_json(obj: Any, placeholder: str) -> Any:
    """Recursively walk a JSON-decoded structure and redact skill bits."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            # Drop entire sensitive state channels by key.
            if k in _SENSITIVE_STATE_CHANNELS:
                out[k] = placeholder
                continue
            # The deepagents ``files`` channel is a path -> body
            # mapping. When the path itself points at a skill
            # source, the body is a SKILL.md / ancillary file
            # payload regardless of what its own text contains.
            # Match by key here, not by value, because file bodies
            # are arbitrary user content with no reliable marker.
            if isinstance(k, str) and _looks_like_skill_read(k):
                out[k] = placeholder
                continue
            out[k] = _scrub_json(v, placeholder)
        return out
    if isinstance(obj, list):
        return [_scrub_json(v, placeholder) for v in obj]
    if isinstance(obj, str):
        # A short string is unlikely to be a skill body. The
        # 200-char threshold is a heuristic — empirically, skill
        # paths and short completions are below it; SKILL.md bodies
        # and ancillary file contents are well above. Tune if you
        # see noise either way.
        if len(obj) > 200 and _looks_like_skill_read(obj):
            return placeholder
        if len(obj) > 200 and (
            _SKILLS_SECTION_HEADER in obj
            or _WORKFLOW_SECTION_HEADER in obj
            or _WORKFLOW_DEFN_HEADER in obj
        ):
            return _strip_known_sections(obj)
    return obj


# ---------------------------------------------------------------------------
# SpanProcessor
# ---------------------------------------------------------------------------

class SkillContentScrubbingProcessor:
    """OpenTelemetry ``SpanProcessor`` that scrubs skill content.

    Implements the duck-typed ``SpanProcessor`` interface (importing
    the abstract base would force a hard dep on ``opentelemetry-sdk``
    at module-load time; we want this module importable in test
    environments that don't have the SDK installed).
    """

    def __init__(self, placeholder: str = DEFAULT_PLACEHOLDER) -> None:
        self._placeholder = placeholder

    # The OTel SDK calls these four methods. on_start / shutdown /
    # force_flush are no-ops; the work happens in on_end where the
    # span attributes are mutable and the BatchSpanProcessor hasn't
    # serialized them yet.
    def on_start(self, span, parent_context=None) -> None:  # noqa: D401, ARG002
        return None

    def on_end(self, span) -> None:  # noqa: D401
        try:
            attrs = getattr(span, "attributes", None)
            if not attrs:
                return

            # Tool-name short-circuit. The LangChain instrumentor
            # tags every tool span with ``traceloop.entity.name`` (and
            # mirrors it on the OTel ``span.name``). When the tool is
            # one of our task_config workflow tools we redact its
            # I/O wholesale — those payloads always carry llm_prompt
            # bodies regardless of any markdown markers.
            entity_name = attrs.get("traceloop.entity.name") or getattr(
                span, "name", None
            )
            workflow_tool = (
                isinstance(entity_name, str)
                and entity_name in _WORKFLOW_TOOL_NAMES
            )

            updates: dict[str, Any] = {}
            for key, value in attrs.items():
                if not isinstance(key, str):
                    continue
                in_io_attr = key in _LANGCHAIN_IO_ATTR_KEYS
                in_prompt_attr = any(
                    key.startswith(p) for p in _PROMPT_ATTR_PREFIXES
                )
                if not (in_io_attr or in_prompt_attr):
                    continue
                if workflow_tool and in_io_attr:
                    # Wholesale replace — the entire entity I/O of a
                    # workflow tool is operator-authored prompt text.
                    if value != self._placeholder:
                        updates[key] = self._placeholder
                    continue
                new_value = _redact_value(value, self._placeholder)
                if new_value is not value:
                    updates[key] = new_value
            if updates:
                # ReadableSpan exposes attributes as a read-only
                # mapping; the underlying dict on ReadableSpan /
                # _Span is mutable. We try the in-place set first
                # and fall back silently — losing redaction on a
                # span is preferable to crashing the exporter.
                try:
                    for k, v in updates.items():
                        span.set_attribute(k, v)
                except Exception:
                    raw = getattr(span, "_attributes", None)
                    if isinstance(raw, dict):
                        raw.update(updates)
        except Exception as exc:  # noqa: BLE001 — defense in depth
            logger.debug("[skill-scrubber] suppressed error on span end: %s", exc)

    def shutdown(self) -> None:  # noqa: D401
        return None

    def force_flush(self, timeout_millis: int | None = None) -> bool:  # noqa: ARG002
        return True


# ---------------------------------------------------------------------------
# Installer
# ---------------------------------------------------------------------------

def install_skill_content_scrubber() -> bool:
    """Attach the scrubber to the global TracerProvider.

    Idempotent — calling twice does not register two processors.

    Returns ``True`` if installed (or already installed), ``False``
    when disabled by env or when no usable TracerProvider is
    available (e.g. tracing was never initialised). Never raises.
    """
    if os.getenv("SKILL_TRACE_SCRUB_ENABLED", "true").lower() == "false":
        logger.info("[skill-scrubber] disabled via SKILL_TRACE_SCRUB_ENABLED=false")
        return False

    try:
        from opentelemetry import trace
    except ImportError:
        logger.info("[skill-scrubber] opentelemetry not installed; skipping")
        return False

    provider = trace.get_tracer_provider()
    add_processor = getattr(provider, "add_span_processor", None)
    if add_processor is None:
        # NoOpTracerProvider (tracing not initialized) returns None
        # here; nothing to attach to. The cnoe_agent_utils manager
        # logs its own "tracing disabled" line in that case.
        logger.info("[skill-scrubber] active TracerProvider has no add_span_processor; skipping")
        return False

    # Idempotency: stash a marker on the provider so re-imports of
    # this module (e.g. uvicorn auto-reload, test-suite reruns) don't
    # stack processors. The OTel SDK has no native lookup for
    # already-registered processors of a given type.
    if getattr(provider, "_skill_scrubber_installed", False):
        return True

    placeholder = os.getenv("SKILL_TRACE_SCRUB_PLACEHOLDER", DEFAULT_PLACEHOLDER)
    processor = SkillContentScrubbingProcessor(placeholder=placeholder)
    add_processor(processor)
    try:
        provider._skill_scrubber_installed = True  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        # Some provider implementations forbid attribute writes.
        # Idempotency is best-effort.
        pass
    logger.info("[skill-scrubber] installed (placeholder=%r)", placeholder)
    return True

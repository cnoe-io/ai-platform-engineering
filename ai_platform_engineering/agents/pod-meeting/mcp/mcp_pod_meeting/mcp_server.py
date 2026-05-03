# Copyright 2026 CNOE
# SPDX-License-Identifier: Apache-2.0
"""Pod Meeting MCP — deterministic helpers for Pam Beesly.

This MCP intentionally does NOT call out to other MCPs. It's pure utility:
- VTT parsing
- Action-item / decision regex extraction
- Owner resolution against a pod roster
- Agenda + notes XHTML rendering (Confluence storage format)
- Pod registry CRUD on the `pods` Mongo collection
- Webex topic harvesting via direct REST (with shared bot token)

Auth: no per-user OAuth. Reads ``MONGODB_URI`` / ``MONGODB_DATABASE`` /
``WEBEX_TOKEN`` from env. Pam invokes these tools server-to-server.
"""

import functools
import logging
import os
import re
from datetime import datetime, timezone
from html import escape
from typing import Annotated, Any

import httpx
from mcp.shared.exceptions import McpError
from mcp.types import INTERNAL_ERROR, INVALID_PARAMS, ErrorData
from pydantic import BaseModel, Field
from pymongo import MongoClient

logger = logging.getLogger(__name__)

WEBEX_API_BASE = "https://webexapis.com/v1"

# ─────────────────────────────── env helpers ────────────────────────────────
def _mongo_db():
    """Open the Mongo handle on demand (so we don't crash at import time)."""
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise McpError(
            ErrorData(
                code=INTERNAL_ERROR,
                message="MONGODB_URI is not set on mcp_pod_meeting",
            )
        )
    db_name = os.environ.get("MONGODB_DATABASE", "caipe")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    return client[db_name]


def _webex_bot_token() -> str:
    tok = os.environ.get("WEBEX_TOKEN")
    if not tok:
        raise McpError(
            ErrorData(
                code=INTERNAL_ERROR,
                message=(
                    "WEBEX_TOKEN is not set on mcp_pod_meeting; "
                    "harvest_webex_topics needs the shared bot token."
                ),
            )
        )
    return tok


def _handle_errors(func):
    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except McpError:
            raise
        except httpx.HTTPStatusError as e:
            logger.error(f"upstream http {e.response.status_code}: {e.response.text[:300]}")
            raise McpError(
                ErrorData(
                    code=INTERNAL_ERROR,
                    message=f"Upstream HTTP {e.response.status_code}: {e.response.text[:300]}",
                )
            ) from e
        except httpx.TimeoutException as e:
            raise McpError(ErrorData(code=INTERNAL_ERROR, message=f"Upstream timeout: {e}")) from e
        except ValueError as e:
            raise McpError(ErrorData(code=INVALID_PARAMS, message=str(e))) from e
        except Exception as e:  # noqa: BLE001
            logger.exception("unhandled error in pod_meeting tool")
            raise McpError(
                ErrorData(code=INTERNAL_ERROR, message=f"{type(e).__name__}: {e}")
            ) from e
    return wrapper


# ──────────────────────────────── arg models ────────────────────────────────
class ParseWebexVtt(BaseModel):
    vtt_text: Annotated[
        str | None,
        Field(description="Raw WebVTT text. If omitted, ``url`` must be set."),
    ] = None
    url: Annotated[
        str | None,
        Field(description="Optional URL to fetch VTT from (no auth)."),
    ] = None


class ExtractFromSegments(BaseModel):
    segments: Annotated[
        list[dict[str, Any]],
        Field(description="Segments as produced by parse_webex_vtt."),
    ]


class ResolveOwners(BaseModel):
    owner_hints: Annotated[list[str], Field(description="First names or partial mentions.")]
    pod_id: Annotated[str, Field(description="Pod registry id.")]


class HarvestWebexTopics(BaseModel):
    room_id: Annotated[str, Field(description="Webex room id.")]
    since_iso: Annotated[
        str | None,
        Field(description="ISO timestamp lower bound. Defaults to last 14 days."),
    ] = None
    tag: Annotated[str, Field(description="Tag/keyword to filter by.")] = "#agenda"
    max_results: Annotated[int, Field(ge=1, le=500)] = 100


class LoadAgendaTemplate(BaseModel):
    template_url: Annotated[
        str | None,
        Field(description="Confluence storage XHTML template URL or page id. None → built-in default."),
    ] = None


class RenderAgenda(BaseModel):
    template: Annotated[
        str | None,
        Field(description="XHTML body (e.g. from load_agenda_template). None → built-in default."),
    ] = None
    standing_topics: Annotated[list[str], Field(default_factory=list)]
    prior_actions: Annotated[
        list[dict[str, Any]],
        Field(default_factory=list, description="Open action items from previous meeting."),
    ]
    harvested_topics: Annotated[
        list[dict[str, Any]],
        Field(default_factory=list, description="From harvest_webex_topics."),
    ]
    meeting_meta: Annotated[
        dict[str, Any],
        Field(default_factory=dict, description="title, date, attendees, etc."),
    ]


class RenderNotes(BaseModel):
    template: Annotated[str | None, Field()] = None
    transcript_summary: Annotated[str, Field(description="Markdown/plain summary text.")] = ""
    decisions: Annotated[list[dict[str, Any]], Field(default_factory=list)]
    action_items: Annotated[list[dict[str, Any]], Field(default_factory=list)]
    deliverables: Annotated[list[dict[str, Any]], Field(default_factory=list)]
    meeting_meta: Annotated[dict[str, Any], Field(default_factory=dict)]


class GetPod(BaseModel):
    pod_id: str


class UpsertPod(BaseModel):
    pod_id: Annotated[str, Field(description="Stable id, e.g. 'mycelium'.")]
    name: Annotated[str, Field()]
    webex_room_id: Annotated[str | None, Field()] = None
    confluence_parent_id: Annotated[str | None, Field()] = None
    agenda_template_url: Annotated[str | None, Field()] = None
    notes_template_url: Annotated[str | None, Field()] = None
    pgm_email: Annotated[str | None, Field()] = None
    roster: Annotated[
        list[dict[str, Any]] | None,
        Field(description="Each: {display_name, email, webex_person_id?}."),
    ] = None
    default_meeting_series: Annotated[str | None, Field()] = None


class FindPriorMeetingPage(BaseModel):
    pod_id: str
    before_iso: Annotated[
        str | None,
        Field(description="ISO timestamp; defaults to now."),
    ] = None


# ──────────────────────────── VTT parser ────────────────────────────────────
# Cisco VTT style:
#   N "Display Name" (numeric_id)
#   00:00:00.000 --> 00:00:15.964
#   text...
_HEADER_LINE = re.compile(
    r'^\s*(\d+)\s+"([^"]+)"(?:\s+\((\d+)\))?\s*$'
)
_TS_LINE = re.compile(
    r'^\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})'
)


def _ts_to_seconds(h: str, m: str, s: str, ms: str) -> float:
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


def _parse_vtt(text: str) -> dict[str, Any]:
    lines = text.splitlines()
    segments: list[dict[str, Any]] = []
    speakers: dict[str, dict[str, Any]] = {}
    duration_s = 0.0

    i = 0
    n = len(lines)
    if n and lines[0].strip().upper().startswith("WEBVTT"):
        i = 1

    cur_speaker: str | None = None
    cur_speaker_id: str | None = None
    cur_start: float | None = None
    cur_end: float | None = None

    while i < n:
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        # Cisco header line (number + speaker + id)
        m_hdr = _HEADER_LINE.match(line)
        if m_hdr:
            cur_speaker = m_hdr.group(2).strip()
            cur_speaker_id = m_hdr.group(3) or None
            i += 1
            continue

        # Timestamp line
        m_ts = _TS_LINE.match(line)
        if m_ts:
            cur_start = _ts_to_seconds(*m_ts.group(1, 2, 3, 4))
            cur_end = _ts_to_seconds(*m_ts.group(5, 6, 7, 8))
            # Collect text lines until blank
            i += 1
            text_buf: list[str] = []
            while i < n and lines[i].strip():
                # Skip an unexpected header inside (defensive)
                if _HEADER_LINE.match(lines[i].strip()) or _TS_LINE.match(lines[i].strip()):
                    break
                text_buf.append(lines[i].strip())
                i += 1
            seg_text = " ".join(text_buf).strip()
            if cur_start is not None and cur_end is not None and seg_text:
                segments.append(
                    {
                        "speaker": cur_speaker or "Unknown",
                        "speaker_id": cur_speaker_id,
                        "start": cur_start,
                        "end": cur_end,
                        "text": seg_text,
                    }
                )
                duration_s = max(duration_s, cur_end)
                if cur_speaker:
                    sp = speakers.setdefault(
                        cur_speaker,
                        {"display_name": cur_speaker, "id": cur_speaker_id, "segments": 0, "spoken_seconds": 0.0},
                    )
                    sp["segments"] += 1
                    sp["spoken_seconds"] += cur_end - cur_start
            continue

        # Numeric cue id (standard VTT) — skip
        if line.isdigit():
            i += 1
            continue

        # NOTE / STYLE / NOTE blocks — skip
        if line.upper().startswith(("NOTE", "STYLE")):
            while i < n and lines[i].strip():
                i += 1
            continue

        i += 1

    return {
        "segments": segments,
        "speakers": list(speakers.values()),
        "duration_s": duration_s,
    }


# ──────────────────── Action / decision heuristics ──────────────────────────
# Phrase patterns. Fairly conservative to keep false-positive count down — Pam
# can re-rank or filter via the LLM after extraction.
_ACTION_PATTERNS = [
    re.compile(r"\bI(?:'ll| will| am going to| can take| can do)\b", re.I),
    re.compile(r"\b(?:we|let'?s)\s+(?:should|need to|will|gotta|have to)\b", re.I),
    re.compile(r"\baction item\b", re.I),
    re.compile(r"\bTODO\b"),
    re.compile(r"\b([A-Z][a-z]+)\s+(?:will|is going to|to take|to own|to drive|will pick this up)\b"),
    re.compile(r"\bfollow[- ]?up\b", re.I),
]
_DECISION_PATTERNS = [
    re.compile(r"\bwe(?:'?ve)?\s+(?:agreed|decided|settled|aligned)\b", re.I),
    re.compile(r"\bdecision\s*[:\-]\b", re.I),
    re.compile(r"\blet'?s\s+go\s+with\b", re.I),
    re.compile(r"\bfinal(?:ly)?\b.*\bdecision\b", re.I),
]
_NAME_LEAD_RE = re.compile(r"\b([A-Z][a-z]+)\b")


def _extract_owner_hint(text: str, speaker: str) -> str:
    """Best-effort: if the sentence starts 'I'll', owner=speaker first name.
    Else try to grab a leading capitalised name."""
    if re.match(r"\bI(?:'?ll| will| am going to| can)\b", text, re.I):
        first = speaker.split()[0] if speaker else "Unassigned"
        return first
    m = _NAME_LEAD_RE.search(text)
    if m:
        return m.group(1)
    return "Unassigned"


# ──────────────────────────── XHTML helpers ─────────────────────────────────
def _e(s: Any) -> str:
    """HTML-escape, treating None as empty."""
    return escape("" if s is None else str(s), quote=True)


def _kv(label: str, value: Any) -> str:
    return f"<p><strong>{_e(label)}:</strong> {_e(value)}</p>"


def _ul(items: list[str]) -> str:
    if not items:
        return "<p><em>None</em></p>"
    inner = "".join(f"<li>{i}</li>" for i in items)
    return f"<ul>{inner}</ul>"


def _action_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "<p><em>No action items.</em></p>"
    body = "".join(
        f"<tr>"
        f"<td>{_e(r.get('owner') or r.get('owner_hint'))}</td>"
        f"<td>{_e(r.get('text'))}</td>"
        f"<td>{_e(r.get('due') or '—')}</td>"
        f"<td>{_e(r.get('status') or 'Open')}</td>"
        f"</tr>"
        for r in rows
    )
    return (
        "<table>"
        "<thead><tr><th>Owner</th><th>Action</th><th>Due</th><th>Status</th></tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


def _deliv_table(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "<p><em>No deliverables tracked.</em></p>"
    body = "".join(
        f"<tr>"
        f"<td>{_e(r.get('name'))}</td>"
        f"<td>{_e(r.get('owner'))}</td>"
        f"<td>{_e(r.get('target_date') or '—')}</td>"
        f"<td>{_e(r.get('status') or 'In progress')}</td>"
        f"</tr>"
        for r in rows
    )
    return (
        "<table>"
        "<thead><tr><th>Deliverable</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead>"
        f"<tbody>{body}</tbody></table>"
    )


# ─────────────────────────── default templates ──────────────────────────────
_DEFAULT_AGENDA = """\
<h2 id="agenda">Agenda</h2>
{{AGENDA_LIST}}

<h2 id="discussion">Discussion</h2>
<p><em>To be filled in during the meeting.</em></p>

<h2 id="decisions">Decisions</h2>
<p><em>None yet.</em></p>

<h2 id="action-items">Action Items</h2>
{{ACTION_TABLE}}

<h2 id="deliverables">Deliverables</h2>
{{DELIV_TABLE}}
"""

_DEFAULT_NOTES = """\
<h2 id="summary">Summary</h2>
{{SUMMARY}}

<h2 id="decisions">Decisions</h2>
{{DECISIONS_LIST}}

<h2 id="action-items">Action Items</h2>
{{ACTION_TABLE}}

<h2 id="deliverables">Deliverables</h2>
{{DELIV_TABLE}}
"""


# ─────────────────────────── tool registration ──────────────────────────────
def register_tools(server) -> None:
    """Register all pod_meeting tools onto the FastMCP server."""

    logger.info("🔧 Registering pod_meeting tools")

    # ─── parse_webex_vtt ────────────────────────────────────────────────────
    @server.tool(name="parse_webex_vtt")
    @_handle_errors
    async def parse_webex_vtt(args: ParseWebexVtt) -> dict[str, Any]:
        """Parse Cisco-flavoured WebVTT into structured segments."""
        text = args.vtt_text
        if not text and args.url:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.get(args.url)
                r.raise_for_status()
                text = r.text
        if not text:
            raise ValueError("Provide either vtt_text or url")
        return _parse_vtt(text)

    # ─── extract_action_items ───────────────────────────────────────────────
    @server.tool(name="extract_action_items")
    @_handle_errors
    async def extract_action_items(args: ExtractFromSegments) -> dict[str, Any]:
        """Pull plausible action-item candidates from VTT segments."""
        results: list[dict[str, Any]] = []
        for seg in args.segments:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            speaker = seg.get("speaker") or "Unknown"
            ts = seg.get("start")
            # Split on sentence boundary so we can attach hits to a smaller span
            for sent in re.split(r"(?<=[.!?])\s+", text):
                if len(sent) < 12:
                    continue
                hits = sum(1 for p in _ACTION_PATTERNS if p.search(sent))
                if hits:
                    results.append(
                        {
                            "owner_hint": _extract_owner_hint(sent, speaker),
                            "text": sent.strip(),
                            "ts": ts,
                            "speaker": speaker,
                            "confidence": min(1.0, 0.4 + 0.2 * hits),
                        }
                    )
        return {"items": results, "count": len(results)}

    # ─── extract_decisions ──────────────────────────────────────────────────
    @server.tool(name="extract_decisions")
    @_handle_errors
    async def extract_decisions(args: ExtractFromSegments) -> dict[str, Any]:
        """Pull plausible decisions from VTT segments."""
        results: list[dict[str, Any]] = []
        for seg in args.segments:
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            speaker = seg.get("speaker") or "Unknown"
            ts = seg.get("start")
            for sent in re.split(r"(?<=[.!?])\s+", text):
                if len(sent) < 12:
                    continue
                if any(p.search(sent) for p in _DECISION_PATTERNS):
                    results.append(
                        {
                            "text": sent.strip(),
                            "ts": ts,
                            "speaker": speaker,
                        }
                    )
        return {"items": results, "count": len(results)}

    # ─── resolve_owners ─────────────────────────────────────────────────────
    @server.tool(name="resolve_owners")
    @_handle_errors
    async def resolve_owners(args: ResolveOwners) -> dict[str, Any]:
        """Map first-name / mention hints to roster entries."""
        db = _mongo_db()
        pod = db["pods"].find_one({"_id": args.pod_id})
        if not pod:
            return {
                "resolved": [
                    {"hint": h, "display_name": None, "email": None, "webex_person_id": None}
                    for h in args.owner_hints
                ],
                "missing_pod": True,
            }
        roster: list[dict[str, Any]] = pod.get("roster") or []
        out: list[dict[str, Any]] = []
        for hint in args.owner_hints:
            h_norm = (hint or "").strip().lower()
            match: dict[str, Any] | None = None
            for member in roster:
                dn = (member.get("display_name") or "").strip()
                em = (member.get("email") or "").strip().lower()
                first = dn.split()[0].lower() if dn else ""
                if h_norm and (h_norm == first or h_norm == dn.lower() or h_norm == em or em.startswith(h_norm + "@")):
                    match = member
                    break
            out.append(
                {
                    "hint": hint,
                    "display_name": (match or {}).get("display_name"),
                    "email": (match or {}).get("email"),
                    "webex_person_id": (match or {}).get("webex_person_id"),
                }
            )
        return {"resolved": out}

    # ─── harvest_webex_topics ───────────────────────────────────────────────
    @server.tool(name="harvest_webex_topics")
    @_handle_errors
    async def harvest_webex_topics(args: HarvestWebexTopics) -> dict[str, Any]:
        """Pull Webex room messages (last N days) tagged with ``tag``.

        Uses the shared bot token (WEBEX_TOKEN). Note the bot must be a member
        of the room.
        """
        token = _webex_bot_token()
        params: dict[str, Any] = {
            "roomId": args.room_id,
            "max": args.max_results,
        }
        async with httpx.AsyncClient(
            base_url=WEBEX_API_BASE,
            timeout=30.0,
            headers={"Authorization": f"Bearer {token}"},
        ) as client:
            r = await client.get("/messages", params=params)
            r.raise_for_status()
            payload = r.json()

        items = payload.get("items", []) or []
        if args.since_iso:
            try:
                since = datetime.fromisoformat(args.since_iso.replace("Z", "+00:00"))
                items = [
                    m for m in items
                    if datetime.fromisoformat(m.get("created", "").replace("Z", "+00:00")) >= since
                ]
            except ValueError:
                logger.warning("invalid since_iso, skipping filter")

        tag_lc = (args.tag or "").lower()
        filtered: list[dict[str, Any]] = []
        for m in items:
            txt = (m.get("text") or m.get("markdown") or "")
            if not tag_lc or tag_lc in txt.lower():
                filtered.append(
                    {
                        "author": m.get("personEmail"),
                        "text": txt,
                        "message_id": m.get("id"),
                        "ts": m.get("created"),
                        "permalink": _build_webex_permalink(m),
                    }
                )
        return {"items": filtered, "count": len(filtered), "tag": args.tag}

    # ─── load_agenda_template ───────────────────────────────────────────────
    @server.tool(name="load_agenda_template")
    @_handle_errors
    async def load_agenda_template(args: LoadAgendaTemplate) -> dict[str, Any]:
        """Return the storage-format XHTML agenda skeleton.

        Pam should pass this through to render_agenda_xhtml. If
        ``template_url`` is omitted, the built-in default is returned.
        """
        if args.template_url:
            # We don't fetch arbitrary URLs here — Pam should fetch via
            # mcp-atlassian get_page if needed and pass the body to render_*.
            # This keeps the MCP focused.
            return {
                "source": "remote",
                "note": "Use mcp-atlassian.get_page to fetch the body, then pass it to render_*.",
                "url": args.template_url,
                "body": None,
            }
        return {"source": "builtin", "body": _DEFAULT_AGENDA}

    # ─── render_agenda_xhtml ────────────────────────────────────────────────
    @server.tool(name="render_agenda_xhtml")
    @_handle_errors
    async def render_agenda_xhtml(args: RenderAgenda) -> dict[str, Any]:
        body = (args.template or _DEFAULT_AGENDA)

        agenda_items: list[str] = []
        for t in args.standing_topics:
            agenda_items.append(_e(t))
        for ht in args.harvested_topics:
            txt = ht.get("text") or ""
            author = ht.get("author") or ""
            agenda_items.append(f"{_e(txt)} <em>(via {_e(author)})</em>")
        for pa in args.prior_actions:
            agenda_items.append(
                f"<strong>Prior:</strong> {_e(pa.get('text'))} "
                f"(<em>owner: {_e(pa.get('owner') or pa.get('owner_hint'))}</em>)"
            )

        body = body.replace("{{AGENDA_LIST}}", _ul(agenda_items))
        body = body.replace("{{ACTION_TABLE}}", _action_table(args.prior_actions))
        body = body.replace("{{DELIV_TABLE}}", _deliv_table([]))

        meta = args.meeting_meta or {}
        header = "".join(
            [
                _kv("Pod", meta.get("pod_name")) if meta.get("pod_name") else "",
                _kv("Date", meta.get("date")) if meta.get("date") else "",
                _kv("Facilitator", meta.get("facilitator")) if meta.get("facilitator") else "",
            ]
        )
        return {
            "xhtml": header + body,
            "title": meta.get("title")
            or _agenda_title(meta.get("pod_name"), meta.get("date")),
            "anchor_ids": ["agenda", "discussion", "decisions", "action-items", "deliverables"],
        }

    # ─── render_notes_xhtml ─────────────────────────────────────────────────
    @server.tool(name="render_notes_xhtml")
    @_handle_errors
    async def render_notes_xhtml(args: RenderNotes) -> dict[str, Any]:
        body = (args.template or _DEFAULT_NOTES)

        summary_html = "<p>" + _e(args.transcript_summary).replace("\n", "</p><p>") + "</p>" \
            if args.transcript_summary else "<p><em>No summary.</em></p>"

        decision_items = [
            f"{_e(d.get('text'))} <em>(by {_e(d.get('speaker') or 'unknown')})</em>"
            for d in args.decisions
        ]

        body = body.replace("{{SUMMARY}}", summary_html)
        body = body.replace("{{DECISIONS_LIST}}", _ul(decision_items))
        body = body.replace("{{ACTION_TABLE}}", _action_table(args.action_items))
        body = body.replace("{{DELIV_TABLE}}", _deliv_table(args.deliverables))

        meta = args.meeting_meta or {}
        header = "".join(
            [
                _kv("Pod", meta.get("pod_name")) if meta.get("pod_name") else "",
                _kv("Date", meta.get("date")) if meta.get("date") else "",
                _kv("Attendees", ", ".join(meta.get("attendees") or []))
                if meta.get("attendees") else "",
                _kv("Recording", meta.get("recording_url")) if meta.get("recording_url") else "",
            ]
        )
        return {
            "xhtml": header + body,
            "title": meta.get("title")
            or _notes_title(meta.get("pod_name"), meta.get("date")),
            "anchor_ids": ["summary", "decisions", "action-items", "deliverables"],
        }

    # ─── pod registry CRUD ──────────────────────────────────────────────────
    @server.tool(name="get_pod")
    @_handle_errors
    async def get_pod(args: GetPod) -> dict[str, Any]:
        db = _mongo_db()
        pod = db["pods"].find_one({"_id": args.pod_id})
        if not pod:
            return {"found": False, "pod_id": args.pod_id}
        pod["found"] = True
        return pod

    @server.tool(name="list_pods")
    @_handle_errors
    async def list_pods() -> dict[str, Any]:
        db = _mongo_db()
        pods = list(db["pods"].find({}))
        return {"pods": pods, "count": len(pods)}

    @server.tool(name="upsert_pod")
    @_handle_errors
    async def upsert_pod(args: UpsertPod) -> dict[str, Any]:
        db = _mongo_db()
        now = datetime.now(timezone.utc).isoformat()
        update_fields: dict[str, Any] = {
            "name": args.name,
            "updated_at": now,
        }
        for k, v in {
            "webex_room_id": args.webex_room_id,
            "confluence_parent_id": args.confluence_parent_id,
            "agenda_template_url": args.agenda_template_url,
            "notes_template_url": args.notes_template_url,
            "pgm_email": args.pgm_email,
            "default_meeting_series": args.default_meeting_series,
        }.items():
            if v is not None:
                update_fields[k] = v
        if args.roster is not None:
            update_fields["roster"] = args.roster
        result = db["pods"].update_one(
            {"_id": args.pod_id},
            {
                "$set": update_fields,
                "$setOnInsert": {"_id": args.pod_id, "created_at": now},
            },
            upsert=True,
        )
        return {
            "pod_id": args.pod_id,
            "matched": result.matched_count,
            "modified": result.modified_count,
            "upserted_id": str(result.upserted_id) if result.upserted_id else None,
        }

    # ─── find_prior_meeting_page ───────────────────────────────────────────
    @server.tool(name="find_prior_meeting_page")
    @_handle_errors
    async def find_prior_meeting_page(args: FindPriorMeetingPage) -> dict[str, Any]:
        """Locate the previous notes page for this pod from Mongo cache.

        Pam should call this AFTER each successful page creation so we have a
        local index. Otherwise it returns ``found: false`` and Pam should
        instead use mcp-atlassian.get_pages with the title pattern.
        """
        db = _mongo_db()
        before = args.before_iso or datetime.now(timezone.utc).isoformat()
        cursor = (
            db["pod_meeting_pages"]
            .find({"pod_id": args.pod_id, "meeting_date": {"$lt": before}})
            .sort("meeting_date", -1)
            .limit(1)
        )
        rows = list(cursor)
        if not rows:
            pod = db["pods"].find_one({"_id": args.pod_id})
            return {
                "found": False,
                "fallback_title_pattern": _notes_title(
                    (pod or {}).get("name", args.pod_id), "{date}"
                ),
            }
        return {"found": True, "page": rows[0]}

    logger.info("✅ Registered pod_meeting tools")


# ─────────────────────────── private helpers ────────────────────────────────
def _agenda_title(pod_name: str | None, date: str | None) -> str:
    return f"{pod_name or 'Pod'} — Agenda — {date or datetime.now().strftime('%Y-%m-%d')}"


def _notes_title(pod_name: str | None, date: str | None) -> str:
    return f"{pod_name or 'Pod'} — Notes — {date or datetime.now().strftime('%Y-%m-%d')}"


def _build_webex_permalink(m: dict[str, Any]) -> str | None:
    """Best-effort permalink. Webex doesn't expose stable web URLs for
    individual messages publicly, but room URLs work for context."""
    rid = m.get("roomId")
    mid = m.get("id")
    if rid and mid:
        return f"https://web.webex.com/space/{rid}#message:{mid}"
    return None

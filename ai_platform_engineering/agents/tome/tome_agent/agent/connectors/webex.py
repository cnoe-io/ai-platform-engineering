from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_webex import build_webex_mcp
from tome_agent.reports.schema import PageSpec, frontmatter_example, WEBEX_MEETING_FRONTMATTER

WEBEX_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("activity.md",       "dynamic", "Activity",       10),
)


class WebexMeetingItem(BaseModel):
    id: str
    title: str
    start: str  # ISO timestamp from the user-facing meeting picker


class WebexExtra(BaseModel):
    meetings: list[WebexMeetingItem] = Field(default_factory=list)


class WebexConnector(Connector[WebexExtra]):
    slug = "webex"  # backend posts connector_data.webex; MCP prefix is independent (webex_meetings)
    name = "Webex"
    source_prefix = "webex"  # wiki folder stays `webex/<slug>/`
    extra_model = WebexExtra

    def is_enabled(self, token: str) -> bool:
        return True  # Always enabled; token may be empty → tools return an error gracefully

    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        # Scope the MCP to the project's attached rooms — the agent can only
        # read these, not every room the user's token can reach.
        allowed_room_ids = [
            s.extra.get("room_id", "") for s in sources if s.extra.get("room_id")
        ]
        return build_webex_mcp(token=token, allowed_room_ids=allowed_room_ids)

    @property
    def mcp_tools(self) -> list[str]:
        return [
            "mcp__webex__webex_list_rooms",
            "mcp__webex__webex_list_messages",
            "mcp__webex__webex_get_message",
            "mcp__webex__webex_get_person",
            "mcp__webex__webex_meetings_list_meetings",
            "mcp__webex__webex_meetings_list_transcripts",
            "mcp__webex__webex_meetings_get_summary",
        ]

    def page_template(self) -> tuple[PageSpec, ...]:
        return WEBEX_TEMPLATE

    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: WebexExtra | None = None,
    ) -> str:
        from tome_agent.reports import schema as report_schema

        if not sources:
            rooms_section = "(no Webex rooms attached)"
        else:
            blocks = []
            for source in sources:
                expanded = report_schema.expand_template(
                    f"webex/{source.slug}", WEBEX_TEMPLATE
                )
                room_id = source.extra.get("room_id", "") or source.slug
                blocks.append(
                    f"### Webex room `{source.slug}` ({source.display_name}, id={room_id})\n"
                    + format_pages(expanded)
                )
            rooms_section = "\n\n".join(blocks)

        how_to = (
            "HOW TO READ EACH WEBEX ROOM:\n"
            "1. `webex_list_messages(roomId=<ID>, max=<N>)` returns messages newest-first. "
            "Use recency to find what's *active* — not to structure the page. Skim titles; "
            "read deeply only the messages that carry substance.\n"
            "2. `webex_get_message(messageId)` for message bodies that matter.\n"
            "3. Each message carries `personName` (the author's real display name, "
            "pre-resolved). Use it verbatim. NEVER invent or guess a name from an "
            "email address — `jovarney@…` is NOT 'Joel'. If only an email is "
            "present, use the email as-is or call `webex_get_person(personId)`.\n"
            "4. `webex/<slug>/overview.md` — explain what this room IS and what the team is "
            "currently working through in it, as prose. Not a message index.\n"
            "5. `webex/<slug>/activity.md` — an *interpreted* read of what the recent "
            "activity adds up to (themes, decisions, open questions), citing the few "
            "messages that matter. NOT a dated list of every message. If the room is "
            "quiet, one sentence saying so is the right content.\n"
            "Cite messages as markdown links to room URLs where possible. Write concepts, "
            "not logs (see the top of this prompt).\n\n"
            "If per-message deep ingest is requested (WEBEX MESSAGES TO INGEST below), "
            "also write one file per listed message."
        )

        meetings_section = ""
        meetings = extra_data.meetings if extra_data else []
        if meetings:
            meeting_lines = "\n".join(
                f"  - id: {m.id}, title: \"{m.title}\", date: {m.start}"
                for m in meetings
            )
            meetings_section = (
                "\n\nWEBEX MEETINGS TO INGEST:\n\n"
                "For each meeting below, call `webex_meetings_list_transcripts` (with meetingId) "
                "and `webex_meetings_get_summary` (with meetingId) to fetch content.\n"
                "Write each to `webex/meetings/<date>-<sanitized-title>.md` where <date> is "
                "YYYY-MM-DD from the start time and <sanitized-title> is the title lowercased "
                "with spaces replaced by hyphens and non-alphanumeric characters removed.\n\n"
                f"Each file should have this frontmatter:\n{frontmatter_example(WEBEX_MEETING_FRONTMATTER)}\n\n"
                "Include the AI summary, highlights, action items, and keywords from the "
                "summary endpoint. If a transcript is available, note the transcript ID and "
                "creation time. One file per meeting.\n\n"
                f"Meetings:\n{meeting_lines}"
            )

        return (
            "PER-WEBEX-ROOM SUBTREES (each room under `webex/`):\n\n"
            f"{rooms_section}\n\n{how_to}{meetings_section}"
        )

    def prompt_extension(self, extra_data: WebexExtra | None) -> str:
        meetings = extra_data.meetings if extra_data else []
        if not meetings:
            return ""
        return (
            f"\n\nThe user selected {len(meetings)} Webex meeting(s) for transcript "
            "ingestion. Process them per the WEBEX MEETINGS TO INGEST section."
        )

    def log_lines(self, sources: list[SourceItem], extra_data: WebexExtra | None = None) -> list[str]:
        lines = []
        if sources:
            lines.append(f"· webex rooms: {', '.join(s.slug for s in sources)}")
        meetings = extra_data.meetings if extra_data else []
        if meetings:
            lines.append(f"· webex meetings: {len(meetings)} selected for transcript ingestion")
        return lines

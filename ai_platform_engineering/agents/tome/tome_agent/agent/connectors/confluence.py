from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent import http_client
from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_confluence import build_confluence_mcp
from tome_agent.reports.schema import PageSpec, frontmatter_example, CONFLUENCE_PAGE_FRONTMATTER

CONFLUENCE_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md", "dynamic", "Overview", 0),
    PageSpec("activity.md", "dynamic", "Recent Activity", 1),
)


def _atlassian_cloud_id() -> str:
    """Resolve the active request's Atlassian cloud_id from forwarded
    credentials. Empty when no Atlassian connection is forwarded — the MCP
    surfaces that as a clean tool-result error."""
    return (
        http_client.get_active_credentials().get("atlassian", {}).get("cloud_id", "")
    )


class ConfluencePageItem(BaseModel):
    page_id: str
    title: str
    space_key: str


class ConfluenceExtra(BaseModel):
    pages: list[ConfluencePageItem] = Field(default_factory=list)


class ConfluenceConnector(Connector[ConfluenceExtra]):
    slug = "confluence"
    name = "Confluence"
    source_prefix = "confluence"
    extra_model = ConfluenceExtra

    def is_enabled(self, token: str) -> bool:
        # Confluence cloud requires both an access token and a cloud_id. Both
        # arrive together in the per-request credentials under the `atlassian`
        # provider (the caller resolves the cloud_id from the user's first
        # accessible site at request time).
        return bool(token and _atlassian_cloud_id())

    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        site_url = next((s.extra.get("base_url", "") for s in sources if s.extra.get("base_url")), "")
        # Scope the MCP to the project's attached spaces.
        allowed_space_keys = [
            s.extra.get("space_key", "") for s in sources if s.extra.get("space_key")
        ]
        return build_confluence_mcp(
            token=token,
            cloud_id=_atlassian_cloud_id(),
            site_url=site_url,
            allowed_space_keys=allowed_space_keys,
        )

    @property
    def mcp_tools(self) -> list[str]:
        return [
            "mcp__confluence__confluence_list_spaces",
            "mcp__confluence__confluence_get_pages",
            "mcp__confluence__confluence_get_page_content",
        ]

    def citation_urls(self, sources: list[SourceItem]) -> list[str]:
        # Space base URLs, for grounding citations back to Confluence.
        urls = []
        for s in sources:
            base = s.extra.get("base_url") or ""
            if base:
                urls.append(base)
        return urls

    def page_template(self) -> tuple[PageSpec, ...]:
        return CONFLUENCE_TEMPLATE

    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: ConfluenceExtra | None = None,
    ) -> str:
        from tome_agent.reports import schema as report_schema

        if not sources:
            return "(no Confluence spaces attached)"

        blocks = []
        for source in sources:
            expanded = report_schema.expand_template(
                f"confluence/{source.slug}", CONFLUENCE_TEMPLATE
            )
            key = source.extra.get("space_key", "") or source.slug
            blocks.append(
                f"### Confluence space `{source.slug}` ({source.display_name}, key={key})\n"
                + format_pages(expanded)
            )
        spaces_section = "\n\n".join(blocks)

        how_to = (
            "HOW TO READ EACH CONFLUENCE SPACE:\n"
            "1. `confluence_get_pages(space_key=<KEY>)` returns pages "
            "most-recently-edited first with `last_modified`. Use recency to find "
            "what's *active* — not to structure the page. Skim titles; read "
            "deeply only the pages that carry the project's substance.\n"
            "2. `confluence_get_page_content(page_id)` for the bodies that matter.\n"
            "3. `confluence/<slug>/overview.md` — explain what this space IS and "
            "what the team is currently working through in it, as prose. Not a "
            "page index.\n"
            "4. `confluence/<slug>/activity.md` — an *interpreted* read of what "
            "the recent activity adds up to (themes, decisions, open questions), "
            "citing the few pages that matter. NOT a dated list of every edit. If "
            "the space is quiet, one sentence saying so is the right content.\n"
            "Cite pages as markdown links. Write concepts, not logs (see the top "
            "of this prompt).\n\n"
            "If a per-page deep ingest is requested (CONFLUENCE PAGES TO INGEST "
            "below), also write one file per listed page."
        )

        pages_section = ""
        pages = extra_data.pages if extra_data else []
        if pages:
            page_lines = "\n".join(
                f"  - space: \"{p.space_key}\", page_id: \"{p.page_id}\", title: \"{p.title}\""
                for p in pages
            )
            pages_section = (
                "\n\nCONFLUENCE PAGES TO INGEST:\n\n"
                "For each page below, call `confluence_get_page_content` (with page_id) to fetch "
                "the page body.\n"
                "Write each to `confluence/<space-key>/<sanitized-title>.md` where <space-key> is "
                "lowercased and <sanitized-title> is the title lowercased with spaces replaced by "
                "hyphens and non-alphanumeric characters removed.\n\n"
                f"Each file should have this frontmatter:\n{frontmatter_example(CONFLUENCE_PAGE_FRONTMATTER)}\n\n"
                "Include the page content converted from Confluence storage format to markdown. "
                "One file per page.\n\n"
                f"Pages:\n{page_lines}"
            )

        return (
            "PER-CONFLUENCE-SPACE SUBTREES (each space under `confluence/`):\n\n"
            f"{spaces_section}\n\n{how_to}{pages_section}"
        )

    def prompt_extension(self, extra_data: ConfluenceExtra | None) -> str:
        pages = extra_data.pages if extra_data else []
        if not pages:
            return ""
        return (
            f"\n\nThe user selected {len(pages)} Confluence page(s) for "
            "content ingestion. Process them per the CONFLUENCE PAGES TO INGEST section."
        )

    def log_lines(self, sources: list[SourceItem], extra_data: ConfluenceExtra | None = None) -> list[str]:
        lines = []
        if sources:
            lines.append(f"· confluence spaces: {', '.join(s.slug for s in sources)}")
        pages = extra_data.pages if extra_data else []
        if pages:
            lines.append(f"· confluence pages: {len(pages)} selected for content ingestion")
        return lines

    def deep_research_guidance(self, sources: list[SourceItem]) -> str:
        if not sources:
            return ""
        space_names = ", ".join(f"`{s.slug}`" for s in sources)
        return (
            f"CONFLUENCE DEEP RESEARCH: When investigating {space_names}:\n"
            "1. Scan `confluence_get_pages` for signal (most-recently-edited first, titles carry context)\n"
            "2. Central pages or recently-churned docs → `confluence_get_page_content` for full body; walk child pages if they exist\n"
            "3. Don't write about a page you only saw in the tree. Breadth scan for what's active and matters; "
            "depth calls on the pages that carry the substance.\n"
            "4. Write concepts and decisions, not page indices. Interpret the activity: what themes, decisions, "
            "and open questions do the pages add up to?"
        )

    def citation_guidance(self, sources: list[SourceItem]) -> str:
        if not sources:
            return ""
        space_list = "\n".join(
            f"  - `{s.slug}` ({s.display_name}): {s.extra.get('base_url', '')}"
            for s in sources
        )
        return (
            "CONFLUENCE CITATION FORMAT: When citing Confluence pages, use markdown "
            "links to the page URLs. Format: `[page title](page URL)`. Include the "
            "space key and page id in the URL when available for precise navigation.\n\n"
            "Confluence spaces and base URLs:\n" + space_list
        )

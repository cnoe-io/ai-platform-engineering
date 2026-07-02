"""Connector ABC for the agent container — snapshot-driven, no sqlite.

`is_enabled(token)` / `build_mcp(token, ...)` take pre-resolved tokens;
sources arrive as `list[SourceItem]` (the request handler converts
`ProjectSnapshot` → sources). OAuth flows live in the backend. This
module imports only `pydantic` and `ttt.reports.schema` so the agent
image stays minimal.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from tome_agent.reports.schema import PageSpec

ExtraT = TypeVar("ExtraT", bound=BaseModel)


@dataclass
class SourceItem:
    """Lightweight projection of a project source (repo / room / space) for
    use in prompts and logs. Built by the agent from `ProjectSnapshot`."""
    slug: str
    display_name: str
    extra: dict[str, Any] = field(default_factory=dict)


class Connector(ABC, Generic[ExtraT]):
    """Abstract base for an agent-side connector, generic over its extra
    payload type."""

    slug: str
    name: str
    source_prefix: str  # "repos" | "webex" | "confluence" | ...
    extra_model: type[ExtraT] | None = None  # Pydantic model for extra_data; None = no payload

    @abstractmethod
    def is_enabled(self, token: str) -> bool:
        """Return True if the agent has the credentials this connector
        needs to issue tool calls. Empty token still counts as 'enabled'
        when the MCP can degrade gracefully (GitHub / Webex), and as
        'disabled' when it can't (Confluence cloud requires both token +
        cloud id)."""

    @abstractmethod
    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        """Return the in-process MCP server instance scoped to these
        sources. The agent attaches it to the SDK options."""

    @property
    @abstractmethod
    def mcp_tools(self) -> list[str]:
        """Fully-qualified tool names exposed by this connector's MCP
        server."""

    @abstractmethod
    def page_template(self) -> tuple[PageSpec, ...]:
        """Per-source page template — materialized per slug by the ingest
        agent."""

    @abstractmethod
    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: ExtraT | None = None,
    ) -> str:
        """System prompt section describing this connector's sources and
        instructions."""

    def prompt_extension(self, extra_data: ExtraT | None) -> str:
        """Optional user-prompt extension (e.g. 'N meetings selected for
        ingestion'). Override in connectors that accept pre-selected
        items at ingest time."""
        return ""

    def log_lines(
        self, sources: list[SourceItem], extra_data: ExtraT | None = None
    ) -> list[str]:
        """Ingest log lines for this connector. Default: one line
        summarising sources."""
        if not sources:
            return []
        names = ", ".join(s.slug for s in sources)
        return [f"· {self.name}: {names}"]

    async def extra_context(
        self,
        sources: list[SourceItem],
        *,
        github_token: str = "",
    ) -> ExtraT | None:
        """Optional connector-fetched context (e.g. GitHub `.tome/wiki.md`
        steering). Returned as the connector's typed extra model so the
        ingestor can pass it straight through to system_prompt_block /
        log_lines / prompt_extension. Default: None."""
        return None

    def citation_urls(self, sources: list[SourceItem]) -> list[str]:
        """Extract URLs from sources. Used internally by connectors to
        build citation guidance. Connectors may override this to provide
        URLs for their specific source type."""
        return []

    def citation_guidance(self, sources: list[SourceItem]) -> str:
        """Connector-specific guidance for how to cite sources of this
        type in the agent's output. Returns empty string if no sources
        or no citation convention for this connector. Each connector
        teaches the agent its own citation format (GitHub: commit/issue/PR
        links; Webex: message permalinks; Confluence: page URLs; etc.)."""
        return ""

    def parse_extra(self, raw: Any) -> ExtraT | None:
        """Parse the raw connector_data slot for this connector into its
        typed extra model. Returns None when there's no payload or the
        connector declares no model. Raises pydantic ValidationError on
        malformed input — the API boundary catches this and surfaces it
        as 422."""
        if raw is None or self.extra_model is None:
            return None
        if not isinstance(raw, dict):
            raise ValueError("must be an object")
        return self.extra_model.model_validate(raw)


def format_pages(specs: tuple[PageSpec, ...]) -> str:
    """Render a tuple of PageSpecs as a markdown bullet list for agent
    prompts."""
    out: list[str] = []
    for spec in specs:
        grounded = (
            f" — grounded by: {', '.join(spec.grounded_by)}"
            if spec.grounded_by
            else ""
        )
        out.append(f"  - `{spec.path}` ({spec.kind}) — {spec.title}{grounded}")
    return "\n".join(out)

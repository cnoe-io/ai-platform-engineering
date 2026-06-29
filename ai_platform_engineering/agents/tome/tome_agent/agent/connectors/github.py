from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_github import build_github_mcp
from tome_agent.agent.wiki_steering import fetch_steering
from tome_agent.reports.schema import PageSpec

REPO_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("team.md",           "dynamic", "Team",           10),
    PageSpec("glossary.md",       "dynamic", "Glossary",       20),
    PageSpec("architecture.md",   "dynamic", "Architecture",   30),
    PageSpec("status.md",         "dynamic", "Status",         40),
    PageSpec("activity.md",       "dynamic", "Activity",       50),
    PageSpec("conversations.md",  "dynamic", "Conversations",  60),
)


class GitHubExtra(BaseModel):
    """GitHub's extra payload is connector-fetched (not user-supplied) — populated by
    `extra_context()` from each repo's `.tome/wiki.md`."""
    steering: list[tuple[str, str]] = Field(default_factory=list)


class GitHubConnector(Connector[GitHubExtra]):
    slug = "github"
    name = "GitHub"
    source_prefix = "repos"
    extra_model = GitHubExtra

    def is_enabled(self, token: str) -> bool:
        # GitHub is always enabled; token may be empty but MCP degrades gracefully.
        return True

    def build_mcp(self, *, token: str, sources: list[SourceItem]) -> object:
        urls = [s.extra.get("url", "") for s in sources if s.extra.get("url")]
        return build_github_mcp(urls, token=token)

    @property
    def mcp_tools(self) -> list[str]:
        return [
            "mcp__github__github_list_commits",
            "mcp__github__github_list_releases",
            "mcp__github__github_list_issues",
            "mcp__github__github_get_issue",
            "mcp__github__github_list_pulls",
            "mcp__github__github_get_pr",
            "mcp__github__github_search_issues",
            "mcp__github__github_get_codeowners",
            "mcp__github__github_get_file",
            "mcp__github__github_list_dir",
            "mcp__github__github_get_readme",
        ]

    def page_template(self) -> tuple[PageSpec, ...]:
        return REPO_TEMPLATE

    def system_prompt_block(
        self,
        sources: list[SourceItem],
        extra_data: GitHubExtra | None = None,
    ) -> str:
        from tome_agent.reports import schema as report_schema

        if not sources:
            return "PER-REPO SUBTREES:\n\n(no repos attached — top-level pages only)"

        blocks: list[str] = []
        for source in sources:
            expanded = report_schema.expand_template(
                f"repos/{source.slug}", REPO_TEMPLATE
            )
            blocks.append(
                f"### Repo `{source.slug}` ({source.display_name})\n"
                + format_pages(expanded)
            )
        return "PER-REPO SUBTREES (each repo gets its own folder under `repos/`):\n\n" + "\n\n".join(blocks)

    def log_lines(self, sources: list[SourceItem], extra_data: GitHubExtra | None = None) -> list[str]:
        if not sources:
            return []
        lines = [f"· repos: {', '.join(f'{s.slug} ({s.display_name})' for s in sources)}"]
        steering = extra_data.steering if extra_data else []
        for repo, body in steering:
            lines.append(f"· steering: loaded {repo}/.tome/wiki.md ({len(body)} chars)")
        return lines

    async def extra_context(
        self,
        sources: list[SourceItem],
        *,
        github_token: str = "",
    ) -> GitHubExtra | None:
        urls = [s.extra.get("url", "") for s in sources if s.extra.get("url")]
        if not urls:
            return None
        steering = await fetch_steering(urls, token=github_token)
        if not steering:
            return None
        return GitHubExtra(steering=steering)

    def citation_urls(self, sources: list[SourceItem]) -> list[str]:
        return [s.extra.get("url", "") for s in sources if s.extra.get("url")]

from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_github import build_github_mcp
from tome_agent.agent.wiki_steering import RepoRelationships, fetch_relationships, fetch_steering
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
    `extra_context()` from `.ttt/wiki.md` and `.ttt/relationships.yaml` per repo."""
    relationships: list[RepoRelationships] = Field(default_factory=list)
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

        relationships = extra_data.relationships if extra_data else []
        rels_by_repo: dict[str, RepoRelationships] = {rel.repo: rel for rel in relationships}

        blocks: list[str] = []
        for source in sources:
            expanded = report_schema.expand_template(
                f"repos/{source.slug}", REPO_TEMPLATE
            )
            rel_block = ""
            rel = rels_by_repo.get(source.extra.get("url", ""))
            if rel and not rel.is_empty:
                rel_block = (
                    "\nMaintainer-declared relationships (from `.ttt/relationships.yaml`):\n"
                    + _format_relationships(rel)
                    + "\n"
                )
            blocks.append(
                f"### Repo `{source.slug}` ({source.display_name})\n"
                + format_pages(expanded)
                + rel_block
            )
        return "PER-REPO SUBTREES (each repo gets its own folder under `repos/`):\n\n" + "\n\n".join(blocks)

    def log_lines(self, sources: list[SourceItem], extra_data: GitHubExtra | None = None) -> list[str]:
        if not sources:
            return []
        lines = [f"· repos: {', '.join(f'{s.slug} ({s.display_name})' for s in sources)}"]
        relationships = extra_data.relationships if extra_data else []
        steering = extra_data.steering if extra_data else []
        for rel in relationships:
            kinds_summary = ", ".join(
                f"{kind}={len(rel.edges[kind])}"
                for kind in rel.edges
                if rel.edges[kind]
            )
            lines.append(f"· relationships from {rel.repo}/.ttt/relationships.yaml: {kinds_summary}")
        for repo, body in steering:
            lines.append(f"· steering: loaded {repo}/.ttt/wiki.md ({len(body)} chars)")
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
        relationships = await fetch_relationships(urls, token=github_token)
        steering = await fetch_steering(urls, token=github_token)
        if not relationships and not steering:
            return None
        return GitHubExtra(relationships=relationships, steering=steering)

    def citation_urls(self, sources: list[SourceItem]) -> list[str]:
        return [s.extra.get("url", "") for s in sources if s.extra.get("url")]


def _format_relationships(rel: RepoRelationships) -> str:
    lines: list[str] = []
    for kind in ("depends_on", "consumed_by", "supersedes", "related"):
        items = rel.edges.get(kind)
        if not items:
            continue
        joined = ", ".join(f"`{i}`" for i in items)
        lines.append(f"  - **{kind}**: {joined}")
    return "\n".join(lines)

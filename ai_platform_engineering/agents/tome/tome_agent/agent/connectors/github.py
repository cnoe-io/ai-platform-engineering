from __future__ import annotations

from pydantic import BaseModel, Field

from tome_agent.agent.connectors.base import Connector, SourceItem, format_pages
from tome_agent.agent.mcp_github import build_github_mcp
from tome_agent.agent.wiki_steering import fetch_steering
from tome_agent.reports.schema import PageSpec

REPO_TEMPLATE: tuple[PageSpec, ...] = (
    PageSpec("overview.md",       "dynamic", "Overview",        0),
    PageSpec("team.md",           "dynamic", "Team",           10),
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

    def deep_research_guidance(self, sources: list[SourceItem]) -> str:
        if not sources:
            return ""
        repo_names = ", ".join(f"`{s.slug}`" for s in sources)
        return (
            f"GITHUB DEEP RESEARCH: When you find a signal in {repo_names}:\n"
            "1. Large or contested PRs → `github_get_pr` to read the diff and review thread\n"
            "2. Referenced design/architecture issues → `github_get_issue` for the full decision thread\n"
            "3. Claims about code structure → `github_get_file` / `github_list_dir` to verify against actual code\n"
            "4. Decision-making context → `github_search_issues` to find related proposals\n"
            "Don't write about something you only saw in a list title. Cheap breadth-scan first; "
            "spend depth calls on what matters. Aim to understand the *why* behind changes, not just the *what*."
        )

    def citation_guidance(self, sources: list[SourceItem]) -> str:
        from tome_agent.agent.loop import _normalize_repo_slug

        urls = self.citation_urls(sources)
        canonical = [r for r in (_normalize_repo_slug(r) for r in urls) if r]
        if not canonical:
            return (
                "CITATION FORMAT: When you cite a commit, issue, or PR, use a normal "
                "markdown link like `[commit `a1b2c3d`](URL)` so the renderer makes "
                "it clickable. If you don't know the canonical URL, leave the "
                "citation as plain text in brackets — the renderer has a fallback."
            )

        primary = canonical[0]
        examples = [
            f"`[commit `a1b2c3d`](https://github.com/{primary}/commit/a1b2c3d)`",
            f"`[issue #142](https://github.com/{primary}/issues/142)`",
            f"`[PR #99](https://github.com/{primary}/pull/99)`",
            "`[@alice](https://github.com/alice)` for people (or just write `@alice` — the renderer resolves it)",
        ]

        repo_list = "\n".join(f"  - https://github.com/{r}" for r in canonical)
        return (
            "CITATION FORMAT: When you cite something, use a markdown link so the "
            "renderer makes it clickable.\n\n"
            f"Project repos:\n{repo_list}\n\n"
            "Examples (use the repo the item lives in — don't guess across repos):\n"
            + "\n".join(f"  - {e}" for e in examples)
            + "\n\nIf you don't know the canonical URL for a citation, leave it as plain "
            "bracketed text (e.g. `[commit a1b2c3d]`) — there's a renderer-side "
            "fallback that resolves common patterns."
        )

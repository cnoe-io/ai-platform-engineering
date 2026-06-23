"""In-process MCP server exposing the GitHub REST API to the ingest agent.

Wraps the same httpx-based fetch code that powers the static GithubConnector,
but as MCP tools the Claude Agent SDK can call. Runs in-process — no
subprocess, no Docker.

Tools returned by `build_github_mcp(repos, token)`:
  github_list_commits(repo, since)
  github_list_releases(repo)
  github_list_issues(repo, since, state, label?)
  github_get_issue(repo, number)
  github_search_issues(query)            — GitHub search syntax
  github_list_pulls(repo, since, state)
  github_get_pr(repo, number)
  github_get_codeowners(repo)
  github_get_file(repo, path, ref)       — raw file contents
  github_list_dir(repo, path, ref)       — directory listing
  github_get_readme(repo, ref)           — repo README (any variant)
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from claude_agent_sdk import create_sdk_mcp_server, tool

API = "https://api.github.com"
DEFAULT_PER_PAGE = 30


def _normalize_repo(repo: str, allowed: set[str]) -> str | None:
    """Map any flavor of repo identifier to the canonical `owner/name` form,
    rejecting anything not in the allowlist. Returns None if not allowed."""
    s = repo.strip().rstrip("/")
    if s.startswith("https://github.com/"):
        s = s[len("https://github.com/") :]
    elif s.startswith("github.com/"):
        s = s[len("github.com/") :]
    if s.endswith(".git"):
        s = s[: -len(".git")]
    parts = s.split("/")
    if len(parts) < 2:
        return None
    canonical = f"{parts[0]}/{parts[1]}"
    return canonical if canonical in allowed else None


def _ok(payload: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


def _err(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def build_github_mcp(repos: list[str], token: str = ""):
    """Create the MCP server with tools scoped to `repos` for safety."""

    # Canonicalize the project's repo allowlist once.
    allowed: set[str] = set()
    for r in repos:
        canonical = _normalize_repo(r, allowed=set([f"{r}"]))  # bypass; we're seeding allowlist
        s = r.strip().rstrip("/")
        if s.startswith("https://github.com/"):
            s = s[len("https://github.com/") :]
        elif s.startswith("github.com/"):
            s = s[len("github.com/") :]
        if s.endswith(".git"):
            s = s[: -len(".git")]
        parts = s.split("/")
        if len(parts) >= 2:
            allowed.add(f"{parts[0]}/{parts[1]}")
        if canonical:  # placate linter (unused-var would otherwise nag)
            pass

    def _headers() -> dict[str, str]:
        h = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ttt-ingest-agent",
        }
        if token:
            h["Authorization"] = f"Bearer {token}"
        return h

    async def _get(path: str, params: dict[str, Any] | None = None) -> Any:
        async with httpx.AsyncClient(timeout=20.0, headers=_headers()) as client:
            for attempt in range(3):
                resp = await client.get(f"{API}{path}", params=params)
                if resp.status_code != 429 or attempt == 2:
                    resp.raise_for_status()
                    return resp.json()
                wait = int(resp.headers.get("Retry-After", "5"))
                await asyncio.sleep(min(wait, 60))

    @tool(
        "github_list_commits",
        "List commits on a repo. `since` is RFC3339 (e.g. 2026-04-01T00:00:00Z).",
        {"repo": str, "since": str},
    )
    async def list_commits(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist: {sorted(allowed)}")
        try:
            data = await _get(
                f"/repos/{repo}/commits",
                {"since": args["since"], "per_page": DEFAULT_PER_PAGE},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "sha": (c.get("sha") or "")[:7],
                "date": ((c.get("commit") or {}).get("author") or {}).get("date", "")[:10],
                "author": ((c.get("commit") or {}).get("author") or {}).get("name", ""),
                "login": (c.get("author") or {}).get("login") if c.get("author") else None,
                "message": ((c.get("commit") or {}).get("message") or "").splitlines()[0][:200],
            }
            for c in data
        ]
        return _ok(out)

    @tool(
        "github_list_releases",
        "List releases on a repo, newest first.",
        {"repo": str},
    )
    async def list_releases(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(f"/repos/{repo}/releases", {"per_page": DEFAULT_PER_PAGE})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "tag": r.get("tag_name") or r.get("name"),
                "name": r.get("name"),
                "created_at": r.get("created_at"),
                "published_at": r.get("published_at"),
                "author": (r.get("author") or {}).get("login"),
                "body_excerpt": (r.get("body") or "").strip().splitlines()[:1],
                "prerelease": r.get("prerelease"),
            }
            for r in data
        ]
        return _ok(out)

    @tool(
        "github_list_issues",
        "List issues on a repo (excludes PRs). `since` RFC3339, `state` open|closed|all.",
        {"repo": str, "since": str, "state": str},
    )
    async def list_issues(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/issues",
                {
                    "since": args["since"],
                    "state": args.get("state", "all"),
                    "per_page": DEFAULT_PER_PAGE * 2,
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        # Filter out PRs (the /issues endpoint returns both)
        issues = [it for it in data if not it.get("pull_request")]
        out = [_summarize_issue(it) for it in issues]
        return _ok(out)

    @tool(
        "github_get_issue",
        "Get a single issue with body, labels, assignees, and recent comments count.",
        {"repo": str, "number": int},
    )
    async def get_issue(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            it = await _get(f"/repos/{repo}/issues/{args['number']}")
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = _summarize_issue(it)
        out["body"] = (it.get("body") or "").strip()[:2000]
        out["comments"] = it.get("comments", 0)
        return _ok(out)

    @tool(
        "github_list_pulls",
        "List pull requests on a repo. `state` open|closed|all.",
        {"repo": str, "state": str},
    )
    async def list_pulls(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            data = await _get(
                f"/repos/{repo}/pulls",
                {
                    "state": args.get("state", "all"),
                    "per_page": DEFAULT_PER_PAGE,
                    "sort": "updated",
                    "direction": "desc",
                },
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [
            {
                "number": p.get("number"),
                "title": p.get("title"),
                "state": p.get("state"),
                "merged": bool(p.get("merged_at")),
                "author": (p.get("user") or {}).get("login"),
                "updated_at": p.get("updated_at", "")[:10],
                "labels": [(lb.get("name") or "") for lb in (p.get("labels") or [])],
            }
            for p in data
        ]
        return _ok(out)

    @tool(
        "github_get_pr",
        "Get a PR with reviewers, requested reviewers, merge state.",
        {"repo": str, "number": int},
    )
    async def get_pr(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        try:
            pr = await _get(f"/repos/{repo}/pulls/{args['number']}")
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = {
            "number": pr.get("number"),
            "title": pr.get("title"),
            "state": pr.get("state"),
            "merged": pr.get("merged"),
            "merged_at": pr.get("merged_at"),
            "author": (pr.get("user") or {}).get("login"),
            "requested_reviewers": [u.get("login") for u in (pr.get("requested_reviewers") or [])],
            "labels": [(lb.get("name") or "") for lb in (pr.get("labels") or [])],
            "body_excerpt": (pr.get("body") or "").strip()[:2000],
            "additions": pr.get("additions"),
            "deletions": pr.get("deletions"),
            "changed_files": pr.get("changed_files"),
        }
        return _ok(out)

    @tool(
        "github_search_issues",
        "Run a GitHub issue search. Use full GH search syntax. Scoped to project repos automatically.",
        {"query": str},
    )
    async def search_issues(args: dict) -> dict[str, Any]:
        # Scope to project repos so the agent can't fish across all of GH.
        scope = " ".join(f"repo:{r}" for r in sorted(allowed))
        full_query = f"{args['query']} {scope}".strip()
        try:
            data = await _get(
                "/search/issues",
                {"q": full_query, "per_page": DEFAULT_PER_PAGE, "sort": "updated"},
            )
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        out = [_summarize_issue(it) for it in (data.get("items") or [])]
        return _ok({"total_count": data.get("total_count"), "items": out})

    @tool(
        "github_get_codeowners",
        "Read CODEOWNERS for a repo (tries .github/CODEOWNERS, CODEOWNERS, docs/CODEOWNERS).",
        {"repo": str},
    )
    async def get_codeowners(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        for path in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"):
            try:
                async with httpx.AsyncClient(timeout=15.0, headers={**_headers(), "Accept": "application/vnd.github.raw"}) as client:
                    resp = await client.get(f"{API}/repos/{repo}/contents/{path}")
                    if resp.status_code == 200:
                        return _ok({"path": path, "content": resp.text})
            except Exception:
                continue
        return _err("no CODEOWNERS file found")

    @tool(
        "github_get_file",
        "Read a file from a repo at `path` (no leading slash). Optional `ref` is a branch/tag/sha; defaults to the repo's default branch. Returns raw text, truncated at 200KB.",
        {"repo": str, "path": str, "ref": str},
    )
    async def get_file(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        path = (args.get("path") or "").lstrip("/")
        if not path:
            return _err("path is required")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                headers={**_headers(), "Accept": "application/vnd.github.raw"},
            ) as client:
                resp = await client.get(
                    f"{API}/repos/{repo}/contents/{path}", params=params
                )
                if resp.status_code == 404:
                    return _err(f"not found: {repo}:{path}" + (f"@{ref}" if ref else ""))
                resp.raise_for_status()
                text = resp.text
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        max_bytes = 200_000
        if len(text.encode("utf-8", errors="ignore")) > max_bytes:
            text = text.encode("utf-8", errors="ignore")[:max_bytes].decode(
                "utf-8", errors="ignore"
            ) + "\n\n…[truncated at 200KB]"
        return _ok({"path": path, "ref": ref or None, "content": text})

    @tool(
        "github_list_dir",
        "List entries in a repo directory. `path` empty = repo root. Returns name, path, type (file|dir|symlink|submodule), size.",
        {"repo": str, "path": str, "ref": str},
    )
    async def list_dir(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        path = (args.get("path") or "").strip().lstrip("/")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            data = await _get(f"/repos/{repo}/contents/{path}", params)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return _err(f"not found: {repo}:{path or '/'}" + (f"@{ref}" if ref else ""))
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")
        if not isinstance(data, list):
            return _err(f"{path or '/'} is not a directory")
        out = [
            {
                "name": e.get("name"),
                "path": e.get("path"),
                "type": e.get("type"),
                "size": e.get("size"),
            }
            for e in data
        ]
        return _ok(out)

    @tool(
        "github_get_readme",
        "Get the repo README (any variant: README.md, README.rst, etc.).",
        {"repo": str, "ref": str},
    )
    async def get_readme(args: dict) -> dict[str, Any]:
        repo = _normalize_repo(args["repo"], allowed)
        if not repo:
            return _err(f"repo {args['repo']!r} not in this project's allowlist")
        ref = (args.get("ref") or "").strip()
        params = {"ref": ref} if ref else None
        try:
            async with httpx.AsyncClient(
                timeout=20.0,
                headers={**_headers(), "Accept": "application/vnd.github.raw"},
            ) as client:
                resp = await client.get(f"{API}/repos/{repo}/readme", params=params)
                if resp.status_code == 404:
                    return _err(f"no README found for {repo}")
                resp.raise_for_status()
                return _ok({"ref": ref or None, "content": resp.text})
        except httpx.HTTPStatusError as e:
            return _err(f"HTTP {e.response.status_code}: {e.response.text[:200]}")

    return create_sdk_mcp_server(
        name="github",
        version="0.1.0",
        tools=[
            list_commits,
            list_releases,
            list_issues,
            get_issue,
            list_pulls,
            get_pr,
            search_issues,
            get_codeowners,
            get_file,
            list_dir,
            get_readme,
        ],
    )


def _summarize_issue(it: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": it.get("number"),
        "title": it.get("title"),
        "state": it.get("state"),
        "author": (it.get("user") or {}).get("login"),
        "labels": [(lb.get("name") or "") for lb in (it.get("labels") or [])],
        "assignees": [(u.get("login") or "") for u in (it.get("assignees") or [])],
        "updated_at": (it.get("updated_at") or "")[:10],
        "url": it.get("html_url"),
    }

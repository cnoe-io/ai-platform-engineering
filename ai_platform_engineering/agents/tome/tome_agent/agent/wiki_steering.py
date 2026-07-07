"""Per-repo ingest steering via `.tome/wiki.md`.

A maintainer can drop a `.tome/wiki.md` at the repo root: AGENTS.md-style
free-form markdown context for the ingest agent (what the project is, what to
emphasize, which files are canonical sources of truth). The body is injected
verbatim into the system prompt.

Missing file = no-op. Network failures are silent.
"""

from __future__ import annotations

import logging

import httpx

log = logging.getLogger("tome_agent.agent.wiki_steering")

WIKI_PATH = ".tome/wiki.md"
API = "https://api.github.com"


def _normalize_repo(repo: str) -> str | None:
    s = repo.strip().rstrip("/")
    for prefix in ("https://github.com/", "github.com/"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    if s.endswith(".git"):
        s = s[: -len(".git")]
    parts = s.split("/")
    if len(parts) < 2 or not parts[0] or not parts[1]:
        return None
    return f"{parts[0]}/{parts[1]}"


def _headers(token: str = "") -> dict[str, str]:
    h = {
        "Accept": "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ttt-ingest-agent",
    }
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


async def fetch_steering(repos: list[str], token: str = "") -> list[tuple[str, str]]:
    """Fetch `.tome/wiki.md` from each repo. Returns `[(repo, body), ...]` for
    every repo that had one. Network failures and 404s are silent."""
    out: list[tuple[str, str]] = []
    if not repos:
        return out

    async with httpx.AsyncClient(timeout=15.0, headers=_headers(token)) as client:
        for raw_repo in repos:
            repo = _normalize_repo(raw_repo)
            if not repo:
                continue
            try:
                resp = await client.get(f"{API}/repos/{repo}/contents/{WIKI_PATH}")
            except httpx.HTTPError as e:
                log.debug("wiki.md fetch failed for %s: %s", repo, e)
                continue
            if resp.status_code == 404:
                continue
            if resp.status_code != 200:
                log.debug("wiki.md %s returned HTTP %s", repo, resp.status_code)
                continue
            body = resp.text.strip()
            if body:
                out.append((repo, body))

    return out

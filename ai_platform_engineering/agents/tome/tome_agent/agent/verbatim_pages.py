"""Per-repo verbatim page mirror via `.tome/pages/*.md`.

A maintainer can drop pre-written markdown at `.tome/pages/<name>.md` in a
repo (alongside `.tome/wiki.md` steering). Ingest copies these files
byte-for-byte into that repo's own subtree (`repos/<slug>/<name>.md`) — no
LLM interpretation, no synthesis. Distinct from `wiki_steering.py`, which
feeds free-form guidance into the agent's prompt instead of writing pages
directly.

Missing directory = no-op. Network failures are silent.
"""

from __future__ import annotations

import logging
from typing import NamedTuple

import httpx

from tome_agent.agent.wiki_steering import _headers, _normalize_repo

log = logging.getLogger("tome_agent.agent.verbatim_pages")

PAGES_DIR = ".tome/pages"
API = "https://api.github.com"


class VerbatimPage(NamedTuple):
    repo: str  # normalized "owner/repo"
    name: str  # page name, no ".md" suffix
    body: str
    sha: str  # blob sha, for change detection across ingest runs


async def fetch_verbatim_pages(repos: list[str], token: str = "") -> list[VerbatimPage]:
    """Fetch every `.tome/pages/*.md` file from each repo. Returns one
    `VerbatimPage` per file found; repos with no `.tome/pages/` dir are
    silently skipped."""
    out: list[VerbatimPage] = []
    if not repos:
        return out

    list_headers = _headers(token)
    list_headers["Accept"] = "application/vnd.github+json"

    async with httpx.AsyncClient(timeout=15.0) as client:
        for raw_repo in repos:
            repo = _normalize_repo(raw_repo)
            if not repo:
                continue
            try:
                resp = await client.get(
                    f"{API}/repos/{repo}/contents/{PAGES_DIR}", headers=list_headers
                )
            except httpx.HTTPError as e:
                log.debug("pages dir listing failed for %s: %s", repo, e)
                continue
            if resp.status_code != 200:
                continue
            try:
                entries = resp.json()
            except ValueError:
                continue
            if not isinstance(entries, list):
                continue

            for entry in entries:
                name = entry.get("name", "")
                download_url = entry.get("download_url")
                if entry.get("type") != "file" or not name.endswith(".md") or not download_url:
                    continue
                try:
                    file_resp = await client.get(download_url, headers=_headers(token))
                except httpx.HTTPError as e:
                    log.debug("page fetch failed for %s/%s: %s", repo, name, e)
                    continue
                if file_resp.status_code != 200:
                    continue
                body = file_resp.text
                if body.strip():
                    out.append(
                        VerbatimPage(
                            repo=repo,
                            name=name[: -len(".md")],
                            body=body,
                            sha=entry.get("sha", ""),
                        )
                    )

    return out

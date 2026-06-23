"""Per-repo ingest steering via files in `.ttt/`.

Two artifacts the maintainer can drop at the repo root:

- `.ttt/wiki.md` — llms.txt-style free-form markdown context for the
  ingest agent (what the project is, what to emphasize, which files are
  canonical sources of truth). Body is injected verbatim into the system
  prompt.
- `.ttt/relationships.yaml` — structured cross-repo edges (depends_on,
  consumed_by, supersedes, related). Parsed and rendered into the system
  prompt under each repo's section so the agent grounds architecture
  writeups in maintainer-asserted edges.

Missing files = no-op. Network/parse failures are silent.
"""

from __future__ import annotations

import logging

import httpx
import yaml
from pydantic import BaseModel, Field

log = logging.getLogger("tome_agent.agent.wiki_steering")

WIKI_PATH = ".ttt/wiki.md"
RELATIONSHIPS_PATH = ".ttt/relationships.yaml"
API = "https://api.github.com"

# Recognized relationship kinds in `.ttt/relationships.yaml`. Values are
# lists of repo identifiers (`owner/name` strings or full URLs). All keys
# are optional; unknown keys are ignored with a debug log.
KNOWN_KINDS: tuple[str, ...] = ("depends_on", "consumed_by", "supersedes", "related")


class RepoRelationships(BaseModel):
    repo: str  # canonical owner/name
    edges: dict[str, list[str]] = Field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not any(self.edges.values())


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
    """Fetch `.ttt/wiki.md` from each repo. Returns `[(repo, body), ...]` for
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


async def fetch_relationships(
    repos: list[str], token: str = ""
) -> list[RepoRelationships]:
    """Fetch `.ttt/relationships.yaml` from each repo. Returns one
    `RepoRelationships` per repo that had a non-empty file. Unknown keys
    are dropped with a debug log; non-list values are coerced to a list."""
    out: list[RepoRelationships] = []
    if not repos:
        return out

    async with httpx.AsyncClient(timeout=15.0, headers=_headers(token)) as client:
        for raw_repo in repos:
            repo = _normalize_repo(raw_repo)
            if not repo:
                continue
            try:
                resp = await client.get(
                    f"{API}/repos/{repo}/contents/{RELATIONSHIPS_PATH}"
                )
            except httpx.HTTPError as e:
                log.debug("relationships fetch failed for %s: %s", repo, e)
                continue
            if resp.status_code == 404:
                continue
            if resp.status_code != 200:
                log.debug(
                    "relationships %s returned HTTP %s", repo, resp.status_code
                )
                continue
            try:
                doc = yaml.safe_load(resp.text) or {}
            except yaml.YAMLError as e:
                log.warning("relationships YAML parse failed for %s: %s", repo, e)
                continue
            if not isinstance(doc, dict):
                log.warning("relationships %s top-level must be a mapping", repo)
                continue

            edges: dict[str, list[str]] = {}
            for key, value in doc.items():
                if key not in KNOWN_KINDS:
                    log.debug("relationships %s: ignoring unknown kind %r", repo, key)
                    continue
                if value is None:
                    continue
                if isinstance(value, str):
                    value = [value]
                if not isinstance(value, list):
                    log.debug("relationships %s.%s: not a list, skipping", repo, key)
                    continue
                cleaned = [str(v).strip() for v in value if str(v).strip()]
                if cleaned:
                    edges[key] = cleaned

            rel = RepoRelationships(repo=repo, edges=edges)
            if not rel.is_empty:
                out.append(rel)

    return out

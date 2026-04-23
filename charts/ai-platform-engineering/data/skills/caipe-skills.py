#!/usr/bin/env python3
"""CAIPE skills catalog query helper.

Stdlib-only Python helper invoked by the bootstrap skill template
(`charts/ai-platform-engineering/data/skills/bootstrap.md`) to call the
CAIPE skills catalog without exposing the API key in shell history.

Resolution order for the API key (first match wins):
  1. ``--api-key <value>`` CLI flag
  2. ``CAIPE_CATALOG_KEY`` environment variable
  3. ``api_key`` field in ``~/.config/caipe/config.json``
  4. ``api_key`` field in ``~/.config/grid/config.json`` (legacy)

Resolution order for the base URL (first match wins):
  1. ``--base-url <value>`` CLI flag
  2. ``CAIPE_BASE_URL`` environment variable
  3. ``base_url`` field in either config.json above
  4. ``DEFAULT_BASE_URL`` constant below (overwritten by the bootstrap
     installer to the deployment's public URL)

Usage (positional query may be empty to list all skills):

    python3 ~/.config/caipe/caipe-skills.py [QUERY...]
    INCLUDE_CONTENT=true python3 ~/.config/caipe/caipe-skills.py SKILL_NAME
    python3 ~/.config/caipe/caipe-skills.py --source github --repo owner/r QUERY

The script prints the catalog JSON to stdout and exits 0 on success. On
client-side errors (no key, bad config, invalid URL) it prints a JSON
``{"error": "..."}`` object and exits 0 so the calling LLM agent can
display the error verbatim. On HTTP / network errors it exits 1.

Security:
  * The API key is NEVER printed, echoed, or written to logs.
  * The key is sent only as the ``X-Caipe-Catalog-Key`` request header.
  * Config files are read via ``open()`` with ``utf-8`` and a 64 KiB cap
    to defend against runaway / hostile files.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_BASE_URL = "{{BASE_URL}}"
"""Bootstrap installer rewrites this to the deployment's public origin
(e.g. ``https://caipe.example.com``). When unrewritten (raw repo file
read directly), it stays as the placeholder so misconfiguration is
visible rather than silently calling localhost."""

CONFIG_PATHS = (
    "~/.config/caipe/config.json",
    "~/.config/grid/config.json",
)

REQUEST_TIMEOUT_SECONDS = 15
CONFIG_FILE_MAX_BYTES = 64 * 1024
USER_AGENT = "caipe-skills-helper/1.0"


def _read_config() -> dict[str, Any]:
    """Return the first readable config dict, or an empty dict.

    Silently ignores missing / unreadable / oversized / malformed files;
    config is a convenience layer, not a required input.
    """
    for raw_path in CONFIG_PATHS:
        path = os.path.expanduser(raw_path)
        try:
            if not os.path.isfile(path):
                continue
            if os.path.getsize(path) > CONFIG_FILE_MAX_BYTES:
                continue
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
            if isinstance(data, dict):
                return data
        except (OSError, ValueError):
            continue
    return {}


def _resolve_credentials(
    cli_api_key: str | None,
    cli_base_url: str | None,
) -> tuple[str, str]:
    """Resolve (api_key, base_url) using documented precedence."""
    cfg = _read_config()
    api_key = (
        cli_api_key
        or os.environ.get("CAIPE_CATALOG_KEY")
        or cfg.get("api_key")
        or ""
    )
    base_url = (
        cli_base_url
        or os.environ.get("CAIPE_BASE_URL")
        or cfg.get("base_url")
        or DEFAULT_BASE_URL
    )
    return api_key, base_url


def _validate_base_url(base_url: str) -> str | None:
    """Return base_url if it parses as a safe http(s) URL, else None.

    Defends against credential-bearing URLs and non-http schemes that
    would otherwise be passed to ``urllib.request.urlopen``.
    """
    try:
        parsed = urllib.parse.urlparse(base_url)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.netloc:
        return None
    if "@" in parsed.netloc:
        return None
    return base_url.rstrip("/")


def _emit_error(message: str) -> None:
    """Print a JSON error envelope to stdout (so the agent can display it)."""
    print(json.dumps({"error": message}))


def _build_query_string(
    query: str,
    *,
    source: str,
    repo: str | None,
    page: int,
    page_size: int,
    include_content: bool,
) -> str:
    params: list[tuple[str, str]] = [
        ("source", source),
        ("q", query),
        ("page", str(page)),
        ("page_size", str(page_size)),
    ]
    if repo:
        params.append(("repo", repo))
    if include_content:
        params.append(("include_content", "true"))
    return urllib.parse.urlencode(params)


def _fetch(url: str, *, api_key: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "X-Caipe-Catalog-Key": api_key,
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(  # noqa: S310 - scheme validated upstream
        request,
        timeout=REQUEST_TIMEOUT_SECONDS,
    ) as response:
        return response.read().decode("utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="caipe-skills",
        description="Query the CAIPE skills catalog.",
    )
    parser.add_argument(
        "query",
        nargs="*",
        help="Search terms (joined with spaces). Empty lists all skills.",
    )
    parser.add_argument("--api-key", default=None, help="API key override.")
    parser.add_argument("--base-url", default=None, help="Catalog base URL override.")
    parser.add_argument("--source", default="github", help="Catalog source filter.")
    parser.add_argument("--repo", default=None, help="Restrict to a hub repo (owner/name).")
    parser.add_argument("--page", type=int, default=1, help="Page number (>=1).")
    parser.add_argument(
        "--page-size",
        type=int,
        default=50,
        help="Results per page (1-100).",
    )
    parser.add_argument(
        "--include-content",
        action="store_true",
        help="Include full skill markdown in the response.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Argument-shape errors win over config / credential errors so the user
    # gets a precise message even when their config file is also broken.
    if args.page < 1:
        _emit_error("--page must be >= 1.")
        return 0
    if not 1 <= args.page_size <= 100:
        _emit_error("--page-size must be between 1 and 100.")
        return 0

    api_key, base_url = _resolve_credentials(args.api_key, args.base_url)

    if not api_key:
        _emit_error(
            "No API key. Set CAIPE_CATALOG_KEY or create "
            '~/.config/caipe/config.json with {"api_key": "<key>"}.'
        )
        return 0

    safe_base_url = _validate_base_url(base_url)
    if not safe_base_url:
        _emit_error(f"Invalid base_url: {base_url!r}. Must be http(s) without credentials.")
        return 0

    include_content = args.include_content or os.environ.get("INCLUDE_CONTENT", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )

    query_string = _build_query_string(
        " ".join(args.query),
        source=args.source,
        repo=args.repo,
        page=args.page,
        page_size=args.page_size,
        include_content=include_content,
    )
    url = f"{safe_base_url}/api/skills?{query_string}"

    try:
        body = _fetch(url, api_key=api_key)
    except urllib.error.HTTPError as exc:
        # Surface the catalog's own error body when present (helpful for 401/403).
        try:
            detail = exc.read().decode("utf-8", errors="replace")
        except Exception:
            detail = ""
        sys.stderr.write(
            f"caipe-skills: HTTP {exc.code} from {safe_base_url}: {detail}\n"
        )
        return 1
    except urllib.error.URLError as exc:
        sys.stderr.write(f"caipe-skills: network error: {exc.reason}\n")
        return 1
    except TimeoutError:
        sys.stderr.write(
            f"caipe-skills: request timed out after {REQUEST_TIMEOUT_SECONDS}s\n"
        )
        return 1

    sys.stdout.write(body)
    if not body.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

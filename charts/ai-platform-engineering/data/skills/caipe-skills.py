#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""CAIPE skills catalog query + install-manifest helper.

Python helper invoked by the live-skills and update-skills slash command
templates (``charts/ai-platform-engineering/data/skills/live-skills.md``
and ``update-skills.md``) to talk to the CAIPE skills catalog without
exposing the API key in shell history.

Run with ``uv run`` so future dependencies can be added to the
``# /// script`` block above without requiring a separate install step.
Add the helper to your Claude Code sandbox allowlist to reduce tool-call
approval prompts:
    allowed_tools: ["Bash(uv run ~/.config/caipe/caipe-skills.py*)"]

API key resolution (first match wins):
  1. ``--api-key <value>`` CLI flag
  2. ``api_key`` field in ``~/.config/caipe/config.json``
  3. ``api_key`` field in ``~/.config/grid/config.json``
  4. ``CAIPE_CATALOG_KEY`` environment variable

Base URL resolution (first match wins):
  1. ``--base-url <value>`` CLI flag
  2. ``base_url`` field in either config.json above
  3. ``CAIPE_BASE_URL`` environment variable (per-process override)
  4. ``CAIPE_SKILLS_GATEWAY_DEFAULT_URL`` environment variable
     (operator-wide default; useful in dotfiles or container images)
  5. ``DEFAULT_BASE_URL`` constant below (rewritten by ``install.sh`` to
     the deployment's public URL at install time)

If none resolve to a usable URL, the script errors out (no silent
``localhost`` fallback) so misconfiguration is immediately visible.

Subcommands (default = ``query``):

  query (default)  Search the catalog and print JSON.
  --register PATH  Add / refresh an entry in the install manifest at
                   ``~/.config/caipe/installed.json`` (or
                   ``./.caipe/installed.json`` when ``--manifest local``
                   is passed). Atomic write: tempfile + rename.

Examples:

    uv run ~/.config/caipe/caipe-skills.py                       # list all
    INCLUDE_CONTENT=true uv run ~/.config/caipe/caipe-skills.py SKILL_NAME
    uv run ~/.config/caipe/caipe-skills.py --source github --repo owner/r QUERY
    uv run ~/.config/caipe/caipe-skills.py --register ~/.claude/skills/foo/SKILL.md

The script prints the catalog JSON to stdout and exits 0 on success.
On client-side errors (no key, bad config, invalid URL, missing path)
it prints a JSON ``{"error": "..."}`` object and exits 0 so the calling
LLM agent can display the error verbatim. On HTTP / network errors it
exits 1.

Security:
  * The API key is NEVER printed, echoed, or written to logs.
  * The key is sent only as the ``X-Caipe-Catalog-Key`` request header.
  * Config files are read via ``open()`` with ``utf-8`` and a 64 KiB cap
    to defend against runaway / hostile files.
  * Manifest writes go through ``os.replace`` (atomic on POSIX) to
    avoid partial-write corruption on Ctrl-C mid-update.
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
"""install.sh installer rewrites this to the deployment's public origin
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

# Manifest paths. ``user`` is the default (one manifest per workstation);
# ``local`` is per-project for shared/team installs that should not bleed
# across worktrees.
MANIFEST_PATHS = {
    "user": "~/.config/caipe/installed.json",
    "local": "./.caipe/installed.json",
}
MANIFEST_FILE_MAX_BYTES = 1 * 1024 * 1024  # 1 MiB ceiling — protects update-skills


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
    """Resolve (api_key, base_url) using documented precedence.

    See module docstring for the full chain. Config file wins over env
    vars on purpose: the config file is where users persist settings,
    and silently shadowing it from a stray exported var is a confusing
    failure mode. Env vars only kick in when no config file is present.
    """
    cfg = _read_config()

    api_key = (
        cli_api_key
        or cfg.get("api_key")
        or os.environ.get("CAIPE_CATALOG_KEY")
        or ""
    )

    base_url = (
        cli_base_url
        or cfg.get("base_url")
        or os.environ.get("CAIPE_BASE_URL")
        or os.environ.get("CAIPE_SKILLS_GATEWAY_DEFAULT_URL")
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


def _read_manifest(path: str) -> dict[str, Any]:
    """Load the install manifest, returning an empty skeleton on miss.

    Skeleton shape: ``{"version": 1, "skills": {<name>: {...}}}``. Any
    parse error (corrupt JSON, oversized file, unexpected schema)
    returns the skeleton too — it's safer to rewrite a manifest we
    can't read than to abort the update flow on it.
    """
    skeleton: dict[str, Any] = {"version": 1, "skills": {}}
    try:
        if not os.path.isfile(path):
            return skeleton
        if os.path.getsize(path) > MANIFEST_FILE_MAX_BYTES:
            return skeleton
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return skeleton
    if not isinstance(data, dict):
        return skeleton
    skills = data.get("skills")
    if not isinstance(skills, dict):
        data["skills"] = {}
    data.setdefault("version", 1)
    return data


def _atomic_write_json(path: str, payload: dict[str, Any]) -> None:
    """Write JSON to ``path`` via tempfile + ``os.replace``.

    Atomic on POSIX. A Ctrl-C between the write and the rename leaves
    the previous manifest intact rather than producing a half-file.
    """
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    # Use mkstemp in the same directory so ``os.replace`` is a same-fs
    # rename (atomic). NamedTemporaryFile would land in /tmp on some
    # systems, defeating the guarantee.
    fd = None
    tmp_path: str | None = None
    try:
        import tempfile

        fd, tmp_path = tempfile.mkstemp(
            dir=parent,
            prefix=".caipe-manifest-",
            suffix=".json",
        )
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
        fd = None  # ownership transferred to fdopen above
        os.replace(tmp_path, path)
        tmp_path = None
    finally:
        if fd is not None:
            os.close(fd)
        if tmp_path is not None and os.path.isfile(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _register_skill(
    skill_path: str,
    *,
    manifest_scope: str,
) -> int:
    """Add or refresh ``skill_path`` in the install manifest.

    Returns the script exit code (0 for success, 0 with an error
    envelope for client-side failures, 1 for unexpected I/O).
    """
    abs_path = os.path.abspath(os.path.expanduser(skill_path))
    if not os.path.isfile(abs_path):
        _emit_error(f"Skill file not found: {skill_path!r}")
        return 0

    manifest_path = os.path.expanduser(
        MANIFEST_PATHS.get(manifest_scope, MANIFEST_PATHS["user"])
    )

    # Derive the skill name from the SKILL.md frontmatter ``name:``
    # field if present, else from the parent directory name (skills
    # layout) or filename stem (commands layout).
    name = _infer_skill_name(abs_path)
    if not name:
        _emit_error(
            f"Could not infer skill name from {abs_path!r}. "
            "Add a ``name:`` field to the frontmatter."
        )
        return 0

    try:
        with open(abs_path, "r", encoding="utf-8") as handle:
            content = handle.read()
    except OSError as exc:
        sys.stderr.write(f"caipe-skills: cannot read {abs_path}: {exc}\n")
        return 1

    import datetime
    import hashlib

    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="seconds"
    )

    manifest = _read_manifest(manifest_path)
    manifest["skills"][name] = {
        "name": name,
        "path": abs_path,
        "content_sha256": content_hash,
        "installed_at": timestamp,
    }

    try:
        _atomic_write_json(manifest_path, manifest)
    except OSError as exc:
        sys.stderr.write(f"caipe-skills: cannot write manifest {manifest_path}: {exc}\n")
        return 1

    print(
        json.dumps(
            {
                "registered": name,
                "path": abs_path,
                "manifest": manifest_path,
                "content_sha256": content_hash,
            }
        )
    )
    return 0


def _infer_skill_name(skill_path: str) -> str | None:
    """Best-effort name extraction from a SKILL.md / *.md file.

    Tries (in order): YAML frontmatter ``name:`` field, parent dir
    name (skills layout), then filename stem (commands layout).
    Pure string parsing — no PyYAML dependency, since the helper
    runs in the user's shell with no extra installs.
    """
    try:
        with open(skill_path, "r", encoding="utf-8") as handle:
            head = handle.read(4096)  # frontmatter is always at the top
    except OSError:
        head = ""

    if head.startswith("---"):
        # Walk until the closing ``---`` and search for ``name:`` lines.
        lines = head.splitlines()
        for line in lines[1:]:
            if line.strip() == "---":
                break
            stripped = line.strip()
            if stripped.startswith("name:"):
                value = stripped.split(":", 1)[1].strip()
                value = value.strip('"').strip("'")
                if value:
                    return value

    parent = os.path.basename(os.path.dirname(skill_path))
    if os.path.basename(skill_path).lower() == "skill.md" and parent:
        return parent

    stem = os.path.splitext(os.path.basename(skill_path))[0]
    return stem or None


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
    parser.add_argument(
        "--register",
        default=None,
        metavar="PATH",
        help=(
            "Add or refresh PATH in the install manifest, then exit. "
            "Used by /update-skills to record installs without rewriting "
            "JSON inline. Skips the catalog query."
        ),
    )
    parser.add_argument(
        "--manifest",
        choices=("user", "local"),
        default="user",
        help=(
            "Which manifest to write to with --register. ``user`` (default) "
            "writes to ~/.config/caipe/installed.json; ``local`` writes to "
            "./.caipe/installed.json for per-project installs."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Manifest write is a pure-local operation; no catalog round-trip
    # and no credential resolution needed. Branch early so a mis-typed
    # config file doesn't block /update-skills from recording its work.
    if args.register:
        return _register_skill(args.register, manifest_scope=args.manifest)

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
        # Distinguish "never configured" from "set to garbage" so the user
        # gets a precise next step. Both still error (no localhost fallback).
        if not base_url or base_url == DEFAULT_BASE_URL:
            _emit_error(
                "No CAIPE base_url configured. Set base_url in "
                "~/.config/caipe/config.json, or export CAIPE_BASE_URL, "
                "or re-run install.sh from your gateway so the helper "
                "is rewritten with the correct URL."
            )
        else:
            _emit_error(
                f"Invalid base_url: {base_url!r}. "
                "Must be http(s) without embedded credentials."
            )
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

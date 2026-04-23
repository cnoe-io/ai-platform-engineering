"""Structural guard: ``X-User-Context`` must NEVER appear in DA's executable outbound paths.

Spec 102 Phase 8 / T112.

The ``X-User-Context`` header is the **inbound** legacy contract from
the BFF (Next.js) to DA. It carries opaque pre-computed authz flags but
no token, so any code path that uses it for outbound auth (to
agentgateway, MCP servers, Keycloak, etc.) is the bug that produced
the live HTTP 401 we are fixing.

This test scans the DA source tree for ``X-User-Context`` references in
**executable Python code only** (comments, docstrings, and string
literals are stripped before matching). Inbound parsing in
``auth/auth.py`` is the only allowed executable use; the whole point of
this test is to guarantee no future commit re-introduces the trusted-
header outbound auth pattern by accident.
"""

from __future__ import annotations

import io
import re
import tokenize
from pathlib import Path

ALLOWED_EXEC_FILES = {
    # auth.py is the inbound-only header parser. Reading the header here
    # is correct because we are establishing the user identity, not using
    # it for outbound auth.
    "src/dynamic_agents/auth/auth.py",
}

PATTERN = re.compile(r"X-User-Context", re.IGNORECASE)


def _da_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _strip_comments_and_strings(source: str) -> str:
    """Return ``source`` with all COMMENT and STRING tokens replaced by spaces.

    Using the ``tokenize`` module rather than regex so that tricky
    constructs (triple-quoted strings, f-strings, escaped quotes inside
    comments, etc.) are handled correctly.
    """
    try:
        tokens = list(tokenize.generate_tokens(io.StringIO(source).readline))
    except (tokenize.TokenError, IndentationError):
        return source
    out: list[str] = []
    for tok_type, tok_str, _start, _end, _line in tokens:
        if tok_type in (tokenize.COMMENT, tokenize.STRING):
            out.append(" " * len(tok_str))
        else:
            out.append(tok_str + " ")
    return "".join(out)


def test_no_x_user_context_in_executable_code():
    root = _da_root()
    offenders: list[tuple[str, int, str]] = []
    for path in list(root.rglob("*.py")):
        rel = path.relative_to(root).as_posix()
        if rel in ALLOWED_EXEC_FILES:
            continue
        if any(seg in rel for seg in ("__pycache__", ".venv/", "build/")):
            continue
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        stripped = _strip_comments_and_strings(source)
        if not PATTERN.search(stripped):
            continue
        # Re-scan original to give a useful line number in the failure msg.
        for i, line in enumerate(source.splitlines(), 1):
            if PATTERN.search(line):
                # Skip pure-comment / pure-string lines via heuristic:
                # check if the code-only line contains the token too.
                code_only = _strip_comments_and_strings(line + "\n")
                if PATTERN.search(code_only):
                    offenders.append((rel, i, line.strip()))

    assert not offenders, (
        "X-User-Context must only appear in the inbound auth dependency "
        "(auth/auth.py). Offending executable lines:\n"
        + "\n".join(f"  {f}:{ln}: {txt}" for f, ln, txt in offenders)
    )

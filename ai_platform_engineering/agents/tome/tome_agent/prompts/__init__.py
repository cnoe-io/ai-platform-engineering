"""Static prompt-text loader. Behavior-defining markdown files for the
ingest and chat agents live next to this module so they can be edited as
prose without touching Python."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

_HERE = Path(__file__).parent


@lru_cache(maxsize=None)
def load(name: str) -> str:
    """Load a prompt markdown file by name (no extension). Cached."""
    return (_HERE / f"{name}.md").read_text(encoding="utf-8").strip()

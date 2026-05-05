# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Skill scan gating policy — vendored copy for the dynamic-agents service.

WHY THIS FILE EXISTS
====================
This is a verbatim copy of
``ai_platform_engineering/skills_middleware/scan_gate.py``.

The ``dynamic-agents`` service ships as a standalone Docker image that
contains *only* the ``dynamic_agents`` package (see ``/app`` in the
container — there is no ``ai_platform_engineering/`` parent). Lazy
imports such as::

    from ai_platform_engineering.skills_middleware.scan_gate import (
        is_skill_blocked, mongo_scan_filter,
    )

…work fine in the dev monorepo (where both packages live on PYTHONPATH)
but raise ``ModuleNotFoundError`` inside the container. Until that day,
the broken import was caught by ``except Exception`` in
``services/skills.py::load_skills``, which silently returned ``[]`` for
every skill set — making every dynamic agent's ``SkillsMiddleware`` /
``StateBackend`` virtual filesystem appear empty to the LLM ("the
filesystem appears to be empty or inaccessible"). The supervisor
catalog and UI worked fine because they live in the same Python
process as ``skills_middleware`` itself.

So we vendor the policy module into the dynamic-agents package. The
file is small and the policy is stable; cost-of-duplication is low,
cost-of-broken-runtime is high.

KEEPING THE TWO COPIES IN SYNC
==============================
If you add a status (e.g. ``"quarantined"``) or change the default
gate, you MUST update both files:

    * ai_platform_engineering/skills_middleware/scan_gate.py  (source of truth)
    * ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/scan_gate.py  (this file)

The unit test ``tests/test_scan_gate_vendored.py`` pins both the policy
table on this side AND that the public API surface (function names +
signatures) hasn't drifted from the source-of-truth module — so a
single-sided change will fail CI.

POLICY (matches the source-of-truth file)
=========================================
* ``scan_status == "flagged"`` is **always** blocked, regardless of
  the ``SKILL_SCANNER_GATE`` env var. This is the hard security
  invariant: a skill the scanner has marked unsafe must never be
  served to any runtime path.
* ``scan_status == "unscanned"`` (and missing-status legacy rows)
  are blocked only under ``SKILL_SCANNER_GATE=strict``. The default
  is ``"warn"`` so deployments without the optional skill-scanner
  service still load skills; operators who run the scanner can flip
  to strict to refuse anything the scanner hasn't explicitly cleared.
* Anything else (``"passed"`` etc.) is allowed.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Default is "warn": flagged skills are always blocked (the actual
# security invariant), but unscanned/missing-status rows are allowed
# so deployments without the optional skill-scanner sidecar still
# function. Operators who run the scanner can opt into "strict" to
# refuse anything not explicitly cleared.
#
# History: this briefly defaulted to "strict", which silently broke
# every dynamic-agent skill in deployments without SKILL_SCANNER_URL
# configured ("N skill(s) failed to load"). The value-of-strict trade
# was a fresh deploy excluding unscanned content; the cost-of-strict
# was the feature being broken by default. Cost won.
_DEFAULT_GATE = "warn"


def get_scan_gate() -> str:
    """Return the active scanner gate (`strict` / `warn` / `off`)."""
    raw = os.getenv("SKILL_SCANNER_GATE", _DEFAULT_GATE).strip().lower()
    if raw not in {"strict", "warn", "off"}:
        logger.warning(
            "Unrecognized SKILL_SCANNER_GATE=%r; falling back to %r",
            raw,
            _DEFAULT_GATE,
        )
        return _DEFAULT_GATE
    return raw


def is_status_blocked(scan_status: str | None) -> bool:
    """Decide whether a skill with the given ``scan_status`` is blocked.

    ``flagged`` is unconditional. ``unscanned`` (or missing status) is
    blocked only under the strict gate. Everything else is allowed.
    """
    if scan_status == "flagged":
        return True
    if scan_status in (None, "", "unscanned"):
        return get_scan_gate() == "strict"
    return False


def is_skill_blocked(skill: dict[str, Any]) -> bool:
    """Convenience over ``is_status_blocked`` for skill dicts."""
    return is_status_blocked(skill.get("scan_status"))


def mongo_scan_filter() -> dict[str, Any]:
    """Mongo predicate that matches skills *not* blocked by scan policy.

    Returns a fragment intended to be merged into a larger ``find`` /
    ``$and`` query, e.g.::

        query = {"$and": [user_filter, mongo_scan_filter()]}

    The fragment always excludes ``flagged``. Under the strict gate it
    additionally excludes ``unscanned`` and missing-status docs (which
    is the same thing semantically). Under non-strict gates only
    ``flagged`` is excluded so legacy callers don't suddenly lose
    rows.
    """
    if get_scan_gate() == "strict":
        # Allow only docs that have explicitly passed scanning. Mongo
        # treats missing fields as not-equal, so we pin via $in for
        # clarity.
        return {"scan_status": {"$in": ["passed"]}}
    # Non-strict: just block the explicit bad state.
    return {"scan_status": {"$ne": "flagged"}}


__all__ = [
    "get_scan_gate",
    "is_status_blocked",
    "is_skill_blocked",
    "mongo_scan_filter",
]

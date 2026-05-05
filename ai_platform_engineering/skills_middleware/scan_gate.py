# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""Skill scan gating policy.

Centralizes the rule for which skills are allowed to be served to the
supervisor catalog and to dynamic agents. Used by every loader path
(``load_default_skills``, ``load_agent_skills``, supervisor hub
fetcher, ``dynamic_agents.services.skills.load_skills``) so the policy
can't drift between callers.

Policy
------
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

Why warn is the default
-----------------------
The skill-scanner is an optional sidecar (``SKILL_SCANNER_URL`` lives
in the UI tier). When it's absent, every skill is created with
``scan_status: "unscanned"`` (or no field at all for legacy/imported
rows). Strict-by-default in that environment makes every catalog
entry invisible to the runtime even though the picker can still see
them — i.e. "skill failed to load" with no obvious cause. Warn-by-
default makes the feature work out of the box and still gives
security-conscious operators a single env flip to lock down.

Why this lives in its own module
--------------------------------
Each loader needs the same decision but used to encode it ad-hoc with
inline ``$ne`` queries. Centralizing it means:

1. Adding a new ``"quarantined"`` status later only requires editing
   one function.
2. Tests can pin the policy table without booting Mongo.
3. Both Mongo query predicates (``mongo_scan_filter``) and Python-side
   dict checks (``is_skill_blocked``) share the same source of truth.
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

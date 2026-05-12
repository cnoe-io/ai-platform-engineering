"""Hybrid ACL: per-document ACL tag filtering on top of datasource-level RBAC.

Spec 102 Phase 7 follow-on (RAG hybrid ACL).

Design
------

The existing RAG RBAC stack (``server.rbac``) already gates queries at
the **datasource** (``datasource_id``) granularity via team-KB ownership
and per-KB realm roles. That works well when whole knowledge bases map
1:1 to teams.

Hybrid ACL adds a second, **finer** filter applied at query time:
``metadata.acl_tags`` IN <user's tag set>.

Concretely, every document indexed into Milvus may carry a list of
``acl_tags`` (strings) on its ``metadata`` dict. Common patterns:

- ``["__public__"]`` — readable by everyone (this is the default
  during the migration so existing corpora keep working).
- ``["team:platform-eng"]`` — only members of that team.
- ``["sensitive", "team:platform-eng"]`` — both tags must match the
  user (tag membership is OR within the doc, AND across docs filter).

Resolution at query time:

1. The caller's tag-set is computed from:
     - their realm roles (prefixed ``role:``),
     - their groups / teams (prefixed ``team:``),
     - the literal ``__public__``.
2. The Milvus filter ``metadata.acl_tags in [<user tags>]`` is
   AND-merged into the existing filter expression.

Feature flag
------------

This module is **off by default** (``RBAC_DOC_ACL_TAGS_ENABLED=false``)
so deployments that haven't migrated their indexes don't suddenly
return empty results.

When OFF:
  - ``derive_user_acl_tags`` returns []
  - ``apply_doc_acl_filter`` is a no-op
  - the query path is identical to today's behaviour.

When ON:
  - ``apply_doc_acl_filter`` injects the metadata.acl_tags filter on
    every authenticated query.
  - Documents with no acl_tags are **invisible** until the migration
    in ``scripts/rag-doc-acl-migration.py`` has run (which assigns
    every existing document the ``__public__`` tag).

Why a flag rather than a hard cutover: Milvus does not support
"missing-key" filters cleanly (you'd have to scan), so we cannot
"fall through to allow" for un-tagged docs. The migration step is
mandatory before flipping the flag.

Outstanding work tracked in BLOCKERS.md:
  - UI for assigning acl_tags to documents at ingest time.
  - Per-tenant tag dictionary / validation in the BFF.
  - Hybrid-ACL doc tagging from the connector ingestors (currently
    callers must populate ``document_metadata.metadata['acl_tags']``
    themselves).
"""

from __future__ import annotations

import logging
import os
import re
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover — import-time circular avoidance
    from common.models.rbac import UserContext
    from common.models.server import QueryRequest

logger = logging.getLogger(__name__)


# Feature flag. Default OFF.
DOC_ACL_TAGS_ENABLED = os.environ.get(
    "RBAC_DOC_ACL_TAGS_ENABLED", "false"
).strip().lower() in ("true", "1", "yes")

# The "everyone-can-read" tag. Migration step backfills this onto
# every existing document.
PUBLIC_TAG = "__public__"

# Filter key the query layer expects (existing Milvus schema supports
# arbitrary metadata.<key> filters — see query_service.py).
ACL_FILTER_KEY = "metadata.acl_tags"


def derive_user_acl_tags(user_context: "UserContext") -> list[str]:
    """Derive the set of ACL tags the user is authorized to see.

    Returns an empty list when the feature flag is off so callers can
    short-circuit without an extra branch.

    Resolution rules:
      - Always include ``__public__`` (every authenticated user).
      - One ``role:<name>`` tag per realm role on the JWT.
      - One ``team:<name>`` tag per group / team membership.
      - De-duplicated, preserving stable order for log readability.

    Anonymous users (``email == 'anonymous'``) get an empty list —
    they should not see any tagged content.
    """
    if not DOC_ACL_TAGS_ENABLED:
        return []
    if user_context.email == "anonymous":
        return []

    tags: list[str] = [PUBLIC_TAG]
    seen: set[str] = {PUBLIC_TAG}

    for r in user_context.realm_roles or []:
        s = str(r).strip()
        if not s:
            continue
        # Skip per-KB roles — those are handled at datasource level.
        if re.match(r"^(kb_reader|kb_ingestor|kb_admin):", s):
            continue
        tag = f"role:{s}"
        if tag not in seen:
            seen.add(tag)
            tags.append(tag)

    for g in user_context.groups or []:
        s = str(g).strip()
        if not s:
            continue
        tag = f"team:{s}"
        if tag not in seen:
            seen.add(tag)
            tags.append(tag)

    return tags


def apply_doc_acl_filter(
    query_request: "QueryRequest",
    user_context: "UserContext",
) -> None:
    """Inject the ``metadata.acl_tags`` filter into ``query_request.filters``.

    No-op when the feature flag is off, when the caller is anonymous,
    or when the caller is a trusted-network / client-credentials
    principal (those bypass user-level ACL by design).

    Merge semantics:

      - If no existing ``metadata.acl_tags`` filter, set it to the
        user's tag set (Milvus will treat a list as ``IN``).
      - If a string was already passed in (caller-supplied
        constraint), keep it ONLY if it's also in the user's tag
        set; otherwise the result will be empty.
      - If a list was passed, intersect it with the user's tag set;
        if the intersection is empty, set the filter to a sentinel
        value (``["__noresults__"]``) so the vector search returns
        nothing rather than silently widening to the user's full set.

    The third rule prevents a subtle escalation where a malicious or
    buggy caller could pass ``acl_tags=["__public__"]`` to bypass
    their own role/team gates.
    """
    if not DOC_ACL_TAGS_ENABLED:
        return
    # Trusted-network / client-credentials / anonymous principals don't
    # participate in tag ACL.
    if user_context.email == "anonymous":
        return
    if user_context.email == "trusted-network" or user_context.email.startswith(
        "trusted:"
    ):
        return
    if user_context.email.startswith("client:"):
        return

    user_tags = derive_user_acl_tags(user_context)
    if not user_tags:
        return

    filters: dict[str, Any] = (
        dict(query_request.filters) if query_request.filters else {}
    )
    existing = filters.get(ACL_FILTER_KEY)

    if existing is None:
        filters[ACL_FILTER_KEY] = list(user_tags)
    elif isinstance(existing, str):
        filters[ACL_FILTER_KEY] = [existing] if existing in user_tags else [
            "__noresults__"
        ]
    elif isinstance(existing, list):
        intersection = [t for t in existing if t in user_tags]
        filters[ACL_FILTER_KEY] = intersection or ["__noresults__"]
    else:
        # Unexpected type — fail closed: deny everything.
        logger.warning(
            "doc_acl: unexpected type %s for %s filter; failing closed",
            type(existing).__name__,
            ACL_FILTER_KEY,
        )
        filters[ACL_FILTER_KEY] = ["__noresults__"]

    query_request.filters = filters


__all__ = [
    "DOC_ACL_TAGS_ENABLED",
    "PUBLIC_TAG",
    "ACL_FILTER_KEY",
    "derive_user_acl_tags",
    "apply_doc_acl_filter",
]

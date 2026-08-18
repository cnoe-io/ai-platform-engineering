"""Redacted graph projection for OpenFGA relationships and policies."""

from __future__ import annotations

import hashlib
from typing import Any

from ai_platform_engineering.authz.policy.models import ExpressionPolicy
from ai_platform_engineering.authz.providers.base import ConditionalTuple


def _edge_id(value: ConditionalTuple) -> str:
    raw = f"{value.user}|{value.relation}|{value.object}|{value.condition_name or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def project_graph(
    tuples: list[ConditionalTuple],
    policies: list[ExpressionPolicy],
    *,
    limit: int,
) -> dict[str, Any]:
    policy_by_key = {
        (item.subject.openfga_ref, item.relation, item.resource_ref): item
        for item in policies
    }
    selected = tuples[:limit]
    node_ids = sorted({value.user for value in selected} | {value.object for value in selected})

    def shadow_warnings(policy: ExpressionPolicy) -> list[str]:
        warnings: list[str] = []
        if any(
            value.user == policy.subject.openfga_ref
            and value.object == policy.resource_ref
            and value.relation in {"caller", "manager"}
            and not value.condition_name
            for value in tuples
        ):
            warnings.append("unconditional_exact_allow")
        server = policy.resource_id.split("/", 1)[0]
        if any(
            value.user == policy.subject.openfga_ref
            and value.object == f"{policy.resource_type}:{server}/*"
            for value in tuples
        ):
            warnings.append("wildcard_allow")
        if policy.subject.type.value in {"team", "channel"}:
            warnings.append("known_transitive_subject")
        return warnings

    return {
        "nodes": [
            {"id": node_id, "type": node_id.split(":", 1)[0]}
            for node_id in node_ids
        ],
        "edges": [
            {
                "id": _edge_id(value),
                "source": value.user,
                "target": value.object,
                "relation": value.relation,
                "conditional": bool(value.condition_name),
                "condition_name": value.condition_name,
                "policy": (
                    {
                        "policy_id": policy.policy_id,
                        "status": policy.status.value,
                        "template": policy.expression.template,
                        "field": policy.expression.field,
                        "schema_hash": policy.input_schema_sha256,
                        "version": policy.version,
                        "exclusive": policy.exclusive,
                        "schema_drift": policy.status.value == "STALE",
                        "shadow_warnings": shadow_warnings(policy),
                    }
                    if (policy := policy_by_key.get((value.user, value.relation, value.object)))
                    else None
                ),
            }
            for value in selected
        ],
        "truncated": len(tuples) > limit,
        "continuation_token": str(limit) if len(tuples) > limit else None,
    }

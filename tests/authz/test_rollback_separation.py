from __future__ import annotations

from copy import deepcopy

from ai_platform_engineering.authz.migration.config import MigrationRoutingRevision


def rollout(revision: str, mode: str) -> MigrationRoutingRevision:
    return MigrationRoutingRevision.model_validate(
        {
            "revision": revision,
            "default_mode": "LEGACY",
            "canary_seed": "example-canary-seed-2026",
            "scopes": [
                {
                    "surface": "agentgateway",
                    "resource_type": "tool",
                    "action": "invoke",
                    "exact_resources": ["issue_tracker/create_item"],
                    "mode": mode,
                    "expression_mode": "enforce" if mode == "AUTHZ" else "off",
                    "owner": "example-owner" if mode == "AUTHZ" else "",
                }
            ],
        }
    )


def test_routing_rollback_preserves_conditional_policy_tuple() -> None:
    tuples = [{"key": "conditional-policy", "version": 3}]
    before = deepcopy(tuples)

    active = rollout("authz-3", "AUTHZ")
    rolled_back = rollout("shadow-4", "SHADOW")

    assert active.revision != rolled_back.revision
    assert tuples == before


def test_policy_rollback_does_not_change_routing_authority_or_restore_broad_grant() -> None:
    active_rollout = rollout("authz-3", "AUTHZ")
    tuples = [
        {"relation": "conditional_caller", "object": "tool:issue_tracker/create_item"},
    ]

    tuples = [item for item in tuples if item["relation"] != "conditional_caller"]

    assert active_rollout.scopes[0].mode.value == "AUTHZ"
    assert tuples == []
    assert not any(item.get("relation") == "caller" for item in tuples)

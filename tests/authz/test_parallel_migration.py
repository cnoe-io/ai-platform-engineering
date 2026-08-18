from __future__ import annotations

from copy import deepcopy

from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    Resource,
    Subject,
    SubjectType,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.migration.config import MigrationMode, MigrationRoutingRevision


SEED = "example-canary-seed-2026"


def request(surface: Surface, resource_id: str) -> CanonicalDecisionRequest:
    return CanonicalDecisionRequest(
        surface=surface,
        transport=Transport.HTTP if surface is Surface.BFF else Transport.EXT_AUTHZ,
        subject=Subject(type=SubjectType.USER, id="example-user"),
        action="invoke" if surface is Surface.AGENTGATEWAY else "read",
        resource=Resource(
            type="tool" if surface is Surface.AGENTGATEWAY else "agent",
            id=resource_id,
        ),
    )


def revision(name: str, bff_mode: str, gateway_mode: str) -> MigrationRoutingRevision:
    return MigrationRoutingRevision.model_validate(
        {
            "revision": name,
            "default_mode": "LEGACY",
            "canary_seed": SEED,
            "scopes": [
                {
                    "surface": "bff",
                    "resource_type": "agent",
                    "action": "read",
                    "exact_resources": ["primary"],
                    "mode": bff_mode,
                    "canary_percent": 100 if bff_mode == "CANARY" else 0,
                },
                {
                    "surface": "agentgateway",
                    "resource_type": "tool",
                    "action": "invoke",
                    "exact_resources": ["issue_tracker/create_item"],
                    "mode": gateway_mode,
                    "canary_percent": 100 if gateway_mode == "CANARY" else 0,
                },
            ],
        }
    )


def test_bff_and_gateway_replay_promotes_and_rolls_back_independently() -> None:
    bff = request(Surface.BFF, "primary")
    gateway = request(Surface.AGENTGATEWAY, "issue_tracker/create_item")
    unrelated = request(Surface.AGENTGATEWAY, "issue_tracker/read_item")
    policy_tuples = [
        {
            "user": "user:example-user",
            "relation": "conditional_caller",
            "object": "tool:issue_tracker/create_item",
            "condition": "string_argument_in_v1",
        }
    ]
    tuple_snapshot = deepcopy(policy_tuples)

    phases = [
        ("legacy", "LEGACY", "LEGACY", MigrationMode.LEGACY, MigrationMode.LEGACY),
        ("bff-shadow", "SHADOW", "LEGACY", MigrationMode.SHADOW, MigrationMode.LEGACY),
        ("bff-canary", "CANARY", "LEGACY", MigrationMode.AUTHZ, MigrationMode.LEGACY),
        ("gateway-shadow", "AUTHZ", "SHADOW", MigrationMode.AUTHZ, MigrationMode.SHADOW),
        ("gateway-canary", "AUTHZ", "CANARY", MigrationMode.AUTHZ, MigrationMode.AUTHZ),
        ("gateway-rollback", "AUTHZ", "SHADOW", MigrationMode.AUTHZ, MigrationMode.SHADOW),
        ("bff-rollback", "SHADOW", "SHADOW", MigrationMode.SHADOW, MigrationMode.SHADOW),
    ]

    for name, bff_mode, gateway_mode, expected_bff, expected_gateway in phases:
        rollout = revision(name, bff_mode, gateway_mode)
        assert rollout.mode_for(bff) is expected_bff
        assert rollout.mode_for(gateway) is expected_gateway
        assert rollout.mode_for(unrelated) is MigrationMode.LEGACY
        assert policy_tuples == tuple_snapshot


def test_routing_revision_models_contain_no_policy_mutation_fields() -> None:
    rollout = revision("rollback", "SHADOW", "LEGACY")
    serialized = rollout.model_dump(mode="json")

    assert "writes" not in serialized
    assert "deletes" not in serialized
    assert "tuples" not in serialized
    assert "condition" not in serialized

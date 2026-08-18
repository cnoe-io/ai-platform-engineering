from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import grpc


def load_module() -> Any:
    path = Path(__file__).resolve().parents[1] / "authz_client.py"
    spec = importlib.util.spec_from_file_location("bridge_authz_client_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def response(code: int) -> SimpleNamespace:
    return SimpleNamespace(status=SimpleNamespace(code=code))


def selection(module: Any) -> Any:
    return module.Selection(
        surface="agentgateway",
        subject="service_account:example-client",
        resource_type="tool",
        resource_id="issue_tracker/create_item",
        action="invoke",
        correlation_id="request-example",
    )


def router(
    module: Any,
    *,
    rollout: Any,
    legacy_code: int = 0,
    authz_code: int = 7,
    authz_error: bool = False,
) -> tuple[Any, list[str], list[dict[str, Any]]]:
    calls: list[str] = []
    comparisons: list[dict] = []

    def legacy(_request: object, _context: object) -> SimpleNamespace:
        calls.append("legacy")
        return response(legacy_code)

    def legacy_shadow(_request: object, _context: object) -> SimpleNamespace:
        calls.append("legacy-shadow")
        return response(legacy_code)

    def authz(_request: object, purpose: str, _timeout: float) -> SimpleNamespace:
        calls.append(f"authz-{purpose}")
        if authz_error:
            raise grpc.RpcError()
        return response(authz_code)

    value = module.MigrationRouter(
        legacy=legacy,
        legacy_shadow=legacy_shadow,
        authz=authz,
        select=lambda _request: selection(module),
        unavailable=lambda: response(14),
        compare=lambda **event: comparisons.append(event),
        rollout=rollout,
    )
    return value, calls, comparisons


def wait_for_comparison(comparisons: list[dict]) -> None:
    deadline = time.monotonic() + 1
    while not comparisons and time.monotonic() < deadline:
        time.sleep(0.01)


def test_rollout_defaults_to_legacy() -> None:
    module = load_module()
    rollout = module.parse_rollout("")
    value, calls, _ = router(module, rollout=rollout)

    result = value.Check(object(), None)

    assert result.status.code == 0
    assert calls == ["legacy"]


def test_shadow_keeps_legacy_authority_and_emits_one_comparison() -> None:
    module = load_module()
    rollout = module.Rollout("revision-1", "SHADOW", "example-canary-seed-2026", 100, ())
    value, calls, comparisons = router(module, rollout=rollout)

    result = value.Check(object(), None)
    wait_for_comparison(comparisons)

    assert result.status.code == 0
    assert calls == ["legacy", "authz-shadow"]
    assert len(comparisons) == 1
    assert comparisons[0]["authoritative_path"] == "LEGACY"


def test_authz_deny_never_falls_back_to_legacy_allow() -> None:
    module = load_module()
    rollout = module.Rollout("revision-1", "AUTHZ", "example-canary-seed-2026", 100, ())
    value, calls, comparisons = router(module, rollout=rollout)

    result = value.Check(object(), None)
    wait_for_comparison(comparisons)

    assert result.status.code == 7
    assert calls[0] == "authz-authoritative"
    assert "legacy-shadow" in calls


def test_authz_only_does_not_invoke_legacy() -> None:
    module = load_module()
    rollout = module.Rollout("revision-1", "AUTHZ_ONLY", "example-canary-seed-2026", 100, ())
    value, calls, _ = router(module, rollout=rollout)

    result = value.Check(object(), None)

    assert result.status.code == 7
    assert calls == ["authz-authoritative"]


def test_authz_transport_error_fails_closed_without_fallback() -> None:
    module = load_module()
    rollout = module.Rollout("revision-1", "AUTHZ_ONLY", "example-canary-seed-2026", 100, ())
    value, calls, _ = router(module, rollout=rollout, authz_error=True)

    result = value.Check(object(), None)

    assert result.status.code == 14
    assert calls == ["authz-authoritative"]


def test_canary_matches_cross_language_vector() -> None:
    module = load_module()
    rollout = module.Rollout(
        "revision-1",
        "LEGACY",
        "example-canary-seed-2026",
        100,
        (
            module.Scope(
                surface="agentgateway",
                resource_type="tool",
                action="invoke",
                mode="CANARY",
                canary_percent=60,
            ),
        ),
    )

    assert rollout.mode(selection(module)) == "AUTHZ"


def test_full_gateway_replay_and_routing_rollback_do_not_mutate_tuples() -> None:
    module = load_module()
    policy_tuples = [
        {
            "user": "user:example-user",
            "relation": "conditional_caller",
            "object": "tool:issue_tracker/create_item",
        }
    ]
    snapshot = [dict(item) for item in policy_tuples]
    phases = (
        ("legacy", "LEGACY", 0),
        ("shadow", "SHADOW", 0),
        ("canary", "CANARY", 7),
        ("authz", "AUTHZ", 7),
        ("authz-only", "AUTHZ_ONLY", 7),
        ("routing-rollback", "SHADOW", 0),
    )

    for name, mode, expected_code in phases:
        if mode == "CANARY":
            scopes = (
                module.Scope(
                    surface="agentgateway",
                    resource_type="tool",
                    action="invoke",
                    mode="CANARY",
                    exact_resources=("issue_tracker/create_item",),
                    canary_percent=100,
                ),
            )
            rollout = module.Rollout(name, "LEGACY", "example-canary-seed-2026", 100, scopes)
        else:
            rollout = module.Rollout(name, mode, "example-canary-seed-2026", 100, ())
        value, _, comparisons = router(module, rollout=rollout)

        result = value.Check(object(), None)
        wait_for_comparison(comparisons)

        assert result.status.code == expected_code
        assert policy_tuples == snapshot

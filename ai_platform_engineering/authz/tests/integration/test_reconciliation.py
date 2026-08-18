from __future__ import annotations

import pytest

from ai_platform_engineering.authz.policy.reconciliation import reconcile_policy, tuple_for_policy
from ai_platform_engineering.authz.providers.base import ConditionalTuple
from ai_platform_engineering.authz.tests.integration.test_policy_repository import policy


@pytest.mark.asyncio
async def test_reconciliation_replaces_condition_and_verifies(fake_provider) -> None:
    old = ConditionalTuple(
        user="user:example-user",
        relation="conditional_caller",
        object="tool:issue_tracker/create_item",
        condition_name="string_argument_in_v1",
        condition_context={
            "field": "/project_key",
            "allowed_values": ["OLD"],
            "expected_schema_hash": "sha256:" + "a" * 64,
        },
    )
    fake_provider.tuples = [old]
    reconciled = await reconcile_policy(fake_provider, policy())
    assert fake_provider.tuples == [tuple_for_policy(reconciled)]
    assert reconciled.status.value == "ACTIVE"


@pytest.mark.asyncio
async def test_reconciliation_preserves_previous_tuple_on_write_failure(fake_provider) -> None:
    old = ConditionalTuple(
        user="user:example-user",
        relation="conditional_caller",
        object="tool:issue_tracker/create_item",
        condition_name="string_argument_in_v1",
        condition_context={"field": "/project_key", "allowed_values": ["OLD"]},
    )
    fake_provider.tuples = [old]
    original_write = fake_provider.write_tuples
    calls = 0

    async def fail_once(tuples):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("write failed")
        await original_write(tuples)

    fake_provider.write_tuples = fail_once
    with pytest.raises(Exception, match="replacement failed"):
        await reconcile_policy(fake_provider, policy())
    assert fake_provider.tuples == [old]

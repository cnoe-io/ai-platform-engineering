from __future__ import annotations

import pytest

from ai_platform_engineering.authz.core.contract import Subject
from ai_platform_engineering.authz.policy.models import ExpressionPolicy
from ai_platform_engineering.authz.policy.repository import InMemoryPolicyRepository, PolicyConflict
from ai_platform_engineering.authz.policy.templates import StringArgumentInV1


def policy(version: int = 1) -> ExpressionPolicy:
    expression = StringArgumentInV1(field="/project_key", values=("PRIMARY",))
    return ExpressionPolicy(
        policy_id="policy-primary",
        resource_type="tool",
        resource_id="issue_tracker/create_item",
        subject=Subject(type="user", id="example-user"),
        expression=expression,
        expression_sha256=expression.sha256(),
        input_schema_sha256="sha256:" + "a" * 64,
        authorization_model_id="model-example",
        version=version,
        created_by_hash="sha256:" + "b" * 64,
    )


@pytest.mark.asyncio
async def test_policy_repository_enforces_optimistic_version() -> None:
    repository = InMemoryPolicyRepository()
    await repository.put(policy(), expected_version=0)
    with pytest.raises(PolicyConflict):
        await repository.put(policy(version=2), expected_version=0)
    updated = await repository.put(policy(version=2), expected_version=1)
    assert updated.version == 2


@pytest.mark.asyncio
async def test_policy_delete_requires_current_version() -> None:
    repository = InMemoryPolicyRepository()
    await repository.put(policy(), expected_version=0)
    with pytest.raises(PolicyConflict):
        await repository.delete("policy-primary", expected_version=2)
    deleted = await repository.delete("policy-primary", expected_version=1)
    assert deleted is not None

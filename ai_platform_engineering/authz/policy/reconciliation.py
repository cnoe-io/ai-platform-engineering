"""Verified conditional-tuple replacement with compensation."""

from __future__ import annotations

from datetime import datetime, timezone

from ai_platform_engineering.authz.policy.models import ExpressionPolicy, PolicyStatus
from ai_platform_engineering.authz.providers.base import AuthorizationProvider, ConditionalTuple


class ReconciliationError(RuntimeError):
    """Conditional tuple state could not be verified or compensated."""


def tuple_for_policy(policy: ExpressionPolicy) -> ConditionalTuple:
    return ConditionalTuple(
        user=policy.subject.openfga_ref,
        relation=policy.relation,
        object=policy.resource_ref,
        condition_name=policy.expression.template,
        condition_context=policy.expression.tuple_context(
            schema_hash=policy.input_schema_sha256
        ),
    )


async def _exact_tuples(
    provider: AuthorizationProvider,
    target: ConditionalTuple,
) -> list[ConditionalTuple]:
    values, _ = await provider.read_tuples(
        user=target.user,
        relation=target.relation,
        object_ref=target.object,
        page_size=100,
    )
    return [
        value
        for value in values
        if (value.user, value.relation, value.object)
        == (target.user, target.relation, target.object)
    ]


async def reconcile_policy(
    provider: AuthorizationProvider,
    policy: ExpressionPolicy,
) -> ExpressionPolicy:
    target = tuple_for_policy(policy)
    previous = await _exact_tuples(provider, target)
    try:
        if previous:
            await provider.delete_tuples(previous)
        await provider.write_tuples([target])
        verified = await _exact_tuples(provider, target)
        if target not in verified:
            raise ReconciliationError("conditional tuple verification failed")
    except Exception as exc:
        try:
            current = await _exact_tuples(provider, target)
            if current:
                await provider.delete_tuples(current)
            if previous:
                await provider.write_tuples(previous)
        except Exception as compensation_exc:
            raise ReconciliationError("tuple replacement and compensation failed") from compensation_exc
        raise ReconciliationError("conditional tuple replacement failed") from exc
    return policy.model_copy(
        update={
            "status": PolicyStatus.ACTIVE,
            "last_reconciled_at": datetime.now(timezone.utc),
            "failure_reason": None,
        }
    )


async def delete_policy_tuple(
    provider: AuthorizationProvider,
    policy: ExpressionPolicy,
) -> None:
    target = tuple_for_policy(policy)
    existing = await _exact_tuples(provider, target)
    if existing:
        await provider.delete_tuples(existing)
    if await _exact_tuples(provider, target):
        raise ReconciliationError("conditional tuple deletion verification failed")


def mark_schema_drift(policy: ExpressionPolicy, current_schema_hash: str) -> ExpressionPolicy:
    if policy.input_schema_sha256 == current_schema_hash:
        return policy
    return policy.model_copy(
        update={
            "status": PolicyStatus.STALE,
            "failure_reason": "input schema hash changed",
            "version": policy.version + 1,
            "updated_at": datetime.now(timezone.utc),
        }
    )

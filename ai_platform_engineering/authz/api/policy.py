"""Typed expression policy administration API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import Field

from ai_platform_engineering.authz.api.security import admin_dependency
from ai_platform_engineering.authz.audit.events import hash_ref, policy_event, relationship_event
from ai_platform_engineering.authz.audit.outbox import AuditOutbox, AuditOutboxFull
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    Resource,
    StrictModel,
    Subject,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.policy.models import (
    ExpressionPolicy,
    PolicyStatus,
    SanitizedSchema,
)
from ai_platform_engineering.authz.policy.reconciliation import (
    ReconciliationError,
    delete_policy_tuple,
    mark_schema_drift,
    reconcile_policy,
)
from ai_platform_engineering.authz.policy.repository import PolicyConflict, PolicyRepository
from ai_platform_engineering.authz.policy.shadowing import analyze_effectiveness
from ai_platform_engineering.authz.policy.templates import TEMPLATES, StringArgumentInV1
from ai_platform_engineering.authz.providers.openfga import OpenFgaProvider


class PolicyWriteBody(StrictModel):
    resource_type: str
    resource_id: str
    subject: Subject
    expression: StringArgumentInV1
    input_schema_sha256: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    exclusive: bool = False


class PolicyValidateBody(PolicyWriteBody):
    policy_id: str | None = None


def expression_mode(settings: Settings, body: PolicyWriteBody) -> str:
    request = CanonicalDecisionRequest(
        surface=Surface.AGENTGATEWAY,
        transport=Transport.HTTP,
        subject=body.subject,
        action="invoke",
        resource=Resource(type=body.resource_type, id=body.resource_id),
    )
    scope = settings.rollout().scope_for(request)
    return scope.expression_mode if scope else "off"


def parse_if_match(value: str | None) -> int | None:
    if value is None:
        return None
    normalized = value.strip().strip('"')
    try:
        parsed = int(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="If-Match must be an integer version") from exc
    if parsed < 0:
        raise HTTPException(status_code=400, detail="If-Match must be non-negative")
    return parsed


def create_policy_router(
    provider: OpenFgaProvider,
    repository: PolicyRepository,
    outbox: AuditOutbox,
    settings: Settings,
) -> APIRouter:
    router = APIRouter(prefix="/v1/admin")
    require_admin = admin_dependency(settings)

    async def validate_body(body: PolicyWriteBody) -> tuple[SanitizedSchema, tuple[str, ...]]:
        if body.resource_type != "tool":
            raise HTTPException(status_code=400, detail="expression policies support tool resources only")
        schema = await repository.get_schema(body.resource_type, body.resource_id)
        if schema is None:
            raise HTTPException(status_code=409, detail="resource schema is not registered")
        if schema.schema_hash != body.input_schema_sha256:
            raise HTTPException(status_code=409, detail="resource schema has drifted")
        eligible = {item.pointer: item.type for item in schema.eligible_fields}
        if eligible.get(body.expression.field) != "string":
            raise HTTPException(status_code=400, detail="expression field is not an eligible string")
        return schema, tuple(sorted(eligible))

    @router.get("/schemas/{resource_type}/{resource_id:path}")
    async def get_schema(
        resource_type: str,
        resource_id: str,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        schema = await repository.get_schema(resource_type, resource_id)
        if schema is None:
            raise HTTPException(status_code=404, detail="schema not found")
        return schema.model_dump(mode="json", by_alias=True)

    @router.put("/schemas/{resource_type}/{resource_id:path}")
    async def put_schema(
        resource_type: str,
        resource_id: str,
        body: SanitizedSchema,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        if (body.resource_type, body.resource_id) != (resource_type, resource_id):
            raise HTTPException(status_code=400, detail="schema resource does not match path")
        stored = await repository.put_schema(body)
        for policy in await repository.list(resource_type=resource_type, resource_id=resource_id):
            stale = mark_schema_drift(policy, body.schema_hash)
            if stale != policy:
                await repository.put(stale, expected_version=policy.version)
        return stored.model_dump(mode="json", by_alias=True)

    @router.get("/policies")
    async def list_policies(
        _actor: str = Depends(require_admin),
        resource_type: str | None = Query(default=None),
        resource_id: str | None = Query(default=None),
    ) -> dict[str, Any]:
        values = await repository.list(resource_type=resource_type, resource_id=resource_id)
        return {"policies": [item.model_dump(mode="json") for item in values]}

    @router.post("/policies:validate")
    async def validate_policy(
        body: PolicyValidateBody,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        schema, fields = await validate_body(body)
        return {
            "valid": True,
            "expression_sha256": body.expression.sha256(),
            "schema_hash": schema.schema_hash,
            "eligible_fields": fields,
            "template": TEMPLATES[body.expression.template].__dict__,
        }

    @router.post("/policies:explain")
    async def explain_policy(
        body: PolicyValidateBody,
        _actor: str = Depends(require_admin),
    ) -> dict[str, Any]:
        await validate_body(body)
        return {
            "summary": (
                "Allow the subject only when the selected string argument "
                "is in the configured values."
            ),
            "template": body.expression.template,
            "field": body.expression.field,
            "value_count": len(body.expression.values),
            "raw_expression": None,
        }

    @router.put("/policies/{policy_id}")
    async def put_policy(
        policy_id: str,
        body: PolicyWriteBody,
        request: Request,
        actor: str = Depends(require_admin),
        if_match: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        await validate_body(body)
        current = await repository.get(policy_id)
        parsed_match = parse_if_match(if_match)
        expected = parsed_match if parsed_match is not None else (0 if current is None else -1)
        if current is not None and expected != current.version:
            raise HTTPException(status_code=412, detail="If-Match policy version is required")
        if current is None and expected not in {0}:
            raise HTTPException(status_code=428, detail="If-Match: 0 is required for create")
        descriptor = await provider.descriptor()
        now = datetime.now(timezone.utc)
        version = 1 if current is None else current.version + 1
        policy = ExpressionPolicy(
            policy_id=policy_id,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            subject=body.subject,
            expression=body.expression,
            expression_sha256=body.expression.sha256(),
            input_schema_sha256=body.input_schema_sha256,
            authorization_model_id=descriptor.authorization_model_id,
            exclusive=body.exclusive,
            version=version,
            created_by_hash=(
                current.created_by_hash
                if current
                else hash_ref(actor, salt=settings.audit_subject_salt)
            ),
            created_at=current.created_at if current else now,
            updated_at=now,
        )
        selected_expression_mode = expression_mode(settings, body)
        effectiveness = await analyze_effectiveness(provider, policy)
        if body.exclusive and not effectiveness.exclusive:
            raise HTTPException(
                status_code=409,
                detail={"message": "exclusive policy is shadowed", "warnings": effectiveness.warnings},
            )
        try:
            if selected_expression_mode == "enforce":
                reconciled = await reconcile_policy(provider, policy)
            else:
                if current is not None and current.status is PolicyStatus.ACTIVE:
                    await delete_policy_tuple(provider, current)
                reconciled = policy.model_copy(update={"status": PolicyStatus.DRAFT})
            stored = await repository.put(reconciled, expected_version=expected)
            correlation_id = request.headers.get("x-correlation-id", str(uuid4()))
            events = [
                policy_event(
                    correlation_id=correlation_id,
                    actor_ref=actor,
                    subject_salt=settings.audit_subject_salt,
                    policy_id=policy_id,
                    resource_ref=policy.resource_ref,
                    operation="create" if current is None else "update",
                    before_revision=current.version if current else None,
                    after_revision=stored.version,
                    template_id=stored.expression.template,
                    expression_sha256=stored.expression_sha256,
                    schema_sha256=stored.input_schema_sha256,
                    status="success",
                )
            ]
            if selected_expression_mode == "enforce":
                events.append(
                    relationship_event(
                        correlation_id=correlation_id,
                        actor_ref=actor,
                        subject_ref=stored.subject.openfga_ref,
                        subject_salt=settings.audit_subject_salt,
                        resource_ref=stored.resource_ref,
                        relation=stored.relation,
                        operation="write",
                        condition_name=stored.expression.template,
                        policy_id=stored.policy_id,
                    )
                )
            await outbox.append_many(events)
        except PolicyConflict as exc:
            if current is not None and current.status is PolicyStatus.ACTIVE:
                await reconcile_policy(provider, current)
            elif selected_expression_mode == "enforce":
                await delete_policy_tuple(provider, policy)
            raise HTTPException(status_code=409, detail="policy version conflict") from exc
        except AuditOutboxFull as exc:
            if current is not None:
                if current.status is PolicyStatus.ACTIVE:
                    await reconcile_policy(provider, current)
                elif selected_expression_mode == "enforce":
                    await delete_policy_tuple(provider, policy)
                await repository.put(current, expected_version=stored.version)
            else:
                if selected_expression_mode == "enforce":
                    await delete_policy_tuple(provider, policy)
                await repository.delete(policy_id, expected_version=stored.version)
            raise HTTPException(status_code=503, detail="durable audit journal unavailable") from exc
        except ReconciliationError as exc:
            raise HTTPException(status_code=503, detail="OpenFGA reconciliation failed") from exc
        return {
            "policy": stored.model_dump(mode="json"),
            "effectiveness": effectiveness.__dict__,
            "expression_mode": selected_expression_mode,
        }

    @router.delete("/policies/{policy_id}")
    async def delete_policy(
        policy_id: str,
        request: Request,
        actor: str = Depends(require_admin),
        if_match: Annotated[str | None, Header()] = None,
    ) -> dict[str, bool]:
        current = await repository.get(policy_id)
        if current is None:
            raise HTTPException(status_code=404, detail="policy not found")
        parsed_match = parse_if_match(if_match)
        if parsed_match is None or parsed_match != current.version:
            raise HTTPException(status_code=412, detail="If-Match policy version is required")
        try:
            if current.status is PolicyStatus.ACTIVE:
                await delete_policy_tuple(provider, current)
            removed = await repository.delete(policy_id, expected_version=current.version)
            if removed is None:
                raise PolicyConflict("policy disappeared")
            correlation_id = request.headers.get("x-correlation-id", str(uuid4()))
            events = [
                policy_event(
                    correlation_id=correlation_id,
                    actor_ref=actor,
                    subject_salt=settings.audit_subject_salt,
                    policy_id=policy_id,
                    resource_ref=current.resource_ref,
                    operation="delete",
                    before_revision=current.version,
                    template_id=current.expression.template,
                    expression_sha256=current.expression_sha256,
                    schema_sha256=current.input_schema_sha256,
                    status="success",
                )
            ]
            if current.status is PolicyStatus.ACTIVE:
                events.append(
                    relationship_event(
                        correlation_id=correlation_id,
                        actor_ref=actor,
                        subject_ref=current.subject.openfga_ref,
                        subject_salt=settings.audit_subject_salt,
                        resource_ref=current.resource_ref,
                        relation=current.relation,
                        operation="delete",
                        condition_name=current.expression.template,
                        policy_id=current.policy_id,
                    )
                )
            await outbox.append_many(events)
        except (PolicyConflict, AuditOutboxFull) as exc:
            if current.status is PolicyStatus.ACTIVE:
                await reconcile_policy(provider, current)
            if await repository.get(policy_id) is None:
                await repository.put(current, expected_version=0)
            raise HTTPException(status_code=503, detail="policy deletion was compensated") from exc
        return {"deleted": True}

    return router

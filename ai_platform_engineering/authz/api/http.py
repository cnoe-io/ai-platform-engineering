"""Single and batch HTTP adapters for the canonical decision core."""

from __future__ import annotations

import asyncio
import hmac
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import Field

from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.contract import (
    BatchDecisionRequest,
    BatchDecisionResult,
    BatchDecisionResultItem,
    CanonicalDecisionRequest,
    DecisionContext,
    Resource,
    StrictModel,
    Subject,
    SubjectType,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.core.decision import DecisionEngine


class DecisionHttpBody(StrictModel):
    action: str = Field(min_length=1, max_length=64)
    resource: Resource
    context: DecisionContext = Field(default_factory=DecisionContext)
    subject: Subject | None = None
    surface: Surface = Surface.BFF


class BatchItemBody(StrictModel):
    item_id: str = Field(min_length=1, max_length=128)
    action: str = Field(min_length=1, max_length=64)
    resource: Resource
    context: DecisionContext = Field(default_factory=DecisionContext)


class BatchHttpBody(StrictModel):
    subject: Subject | None = None
    surface: Surface = Surface.BFF
    items: list[BatchItemBody] = Field(min_length=1, max_length=200)


@dataclass(frozen=True)
class AuthenticatedCaller:
    subject: Subject
    internal: bool


class CallerAuthenticator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jwks = jwt.PyJWKClient(settings.jwt_jwks_url) if settings.jwt_jwks_url else None

    async def authenticate(
        self,
        *,
        authorization: str | None,
        subject_type: str | None,
        subject_id: str | None,
    ) -> AuthenticatedCaller:
        token = ""
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if self.settings.service_token and token and hmac.compare_digest(token, self.settings.service_token):
            if not subject_type or not subject_id:
                raise HTTPException(status_code=401, detail="internal caller must bind a subject")
            return AuthenticatedCaller(
                subject=Subject(type=SubjectType(subject_type), id=subject_id),
                internal=True,
            )
        if self.settings.allow_insecure_headers and subject_type and subject_id:
            return AuthenticatedCaller(
                subject=Subject(type=SubjectType(subject_type), id=subject_id),
                internal=True,
            )
        if not token or self._jwks is None:
            raise HTTPException(status_code=401, detail="authentication required")
        try:
            signing_key = await asyncio.to_thread(self._jwks.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                issuer=self.settings.jwt_issuer or None,
                audience=list(self.settings.jwt_audiences) or None,
                options={"verify_aud": bool(self.settings.jwt_audiences)},
            )
        except jwt.PyJWTError as exc:
            raise HTTPException(status_code=401, detail="invalid bearer token") from exc
        sub = claims.get("sub")
        if not isinstance(sub, str) or not sub:
            raise HTTPException(status_code=401, detail="bearer token has no subject")
        principal_type = (
            SubjectType.SERVICE_ACCOUNT
            if str(claims.get("preferred_username", "")).startswith("service-account-")
            else SubjectType.USER
        )
        return AuthenticatedCaller(subject=Subject(type=principal_type, id=sub), internal=False)


def create_decision_router(engine: DecisionEngine, settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/v1")
    authenticator = CallerAuthenticator(settings)

    async def caller(
        authorization: Annotated[str | None, Header()] = None,
        x_caipe_subject_type: Annotated[str | None, Header()] = None,
        x_caipe_subject_id: Annotated[str | None, Header()] = None,
    ) -> AuthenticatedCaller:
        return await authenticator.authenticate(
            authorization=authorization,
            subject_type=x_caipe_subject_type,
            subject_id=x_caipe_subject_id,
        )

    @router.post("/decisions")
    async def decision(
        body: DecisionHttpBody,
        request: Request,
        authenticated: AuthenticatedCaller = Depends(caller),
        x_caipe_evaluation_purpose: Annotated[str | None, Header()] = None,
    ) -> dict[str, Any]:
        subject = body.subject or authenticated.subject
        if not authenticated.internal and subject != authenticated.subject:
            raise HTTPException(status_code=403, detail="subject override is forbidden")
        correlation = request.headers.get("x-correlation-id")
        canonical = CanonicalDecisionRequest(
            correlation_id=correlation or request.state.correlation_id,
            surface=body.surface,
            transport=Transport.HTTP,
            subject=subject,
            action=body.action,
            resource=body.resource,
            context=body.context,
        )
        shadow = authenticated.internal and x_caipe_evaluation_purpose == "shadow"
        return (
            await engine.decide(
                canonical,
                authoritative_path="SHADOW" if shadow else "AUTHZ",
                emit_event=not shadow,
            )
        ).model_dump(mode="json")

    @router.post("/decisions:batch", response_model=BatchDecisionResult)
    async def decisions_batch(
        body: BatchHttpBody,
        request: Request,
        authenticated: AuthenticatedCaller = Depends(caller),
        x_caipe_evaluation_purpose: Annotated[str | None, Header()] = None,
    ) -> BatchDecisionResult:
        if len(body.items) > settings.batch_limit:
            raise HTTPException(status_code=400, detail="batch exceeds configured limit")
        subject = body.subject or authenticated.subject
        if not authenticated.internal and subject != authenticated.subject:
            raise HTTPException(status_code=403, detail="subject override is forbidden")
        correlation = request.headers.get("x-correlation-id") or request.state.correlation_id
        envelope = BatchDecisionRequest(
            subject=subject,
            surface=body.surface,
            correlation_id=correlation,
            items=[item.model_dump() for item in body.items],
        )
        requests = [
            CanonicalDecisionRequest(
                correlation_id=envelope.correlation_id,
                surface=envelope.surface,
                transport=Transport.BATCH_HTTP,
                subject=envelope.subject,
                action=item.action,
                resource=item.resource,
                context=item.context,
            )
            for item in envelope.items
        ]
        shadow = authenticated.internal and x_caipe_evaluation_purpose == "shadow"
        if shadow:
            results = await asyncio.gather(
                *(engine.decide(item, authoritative_path="SHADOW", emit_event=False) for item in requests)
            )
        else:
            results = await engine.decide_batch(requests)
        return BatchDecisionResult(
            items=[
                BatchDecisionResultItem(item_id=item.item_id, result=result)
                for item, result in zip(envelope.items, results, strict=True)
            ]
        )

    return router

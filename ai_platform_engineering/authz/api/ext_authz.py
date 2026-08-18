"""Envoy v3 ext_authz adapter backed by the canonical decision engine."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any

import grpc

from ai_platform_engineering.authz.api.envoy_proto import CheckRequest, CheckResponse, response
from ai_platform_engineering.authz.config import Settings
from ai_platform_engineering.authz.core.context import ContextError, parse_bounded_json
from ai_platform_engineering.authz.core.contract import (
    CanonicalDecisionRequest,
    CanonicalDecisionResult,
    DecisionContext,
    RequestContext,
    Resource,
    ResourceContext,
    Subject,
    SubjectType,
    Surface,
    Transport,
)
from ai_platform_engineering.authz.core.decision import DecisionEngine
from ai_platform_engineering.authz.core.reasons import ReasonCode

OK = 0
PERMISSION_DENIED = 7
UNAUTHENTICATED = 16
UNAVAILABLE = 14


@dataclass(frozen=True)
class AgentContext:
    agent_id: str
    kind: str


@dataclass(frozen=True)
class ToolCall:
    target: str
    name: str
    arguments: dict[str, Any]


def _string_value(value: Any) -> str | None:
    text = getattr(value, "string_value", "")
    return text if isinstance(text, str) and text else None


def _metadata_claim(request: CheckRequest, name: str) -> str | None:
    metadata = request.attributes.metadata_context.filter_metadata
    for key in ("caipe.auth", "dev.agentgateway.jwt"):
        if key not in metadata:
            continue
        fields = metadata[key].fields
        if name in fields and (value := _string_value(fields[name])):
            return value
        if "claims" in fields:
            claim_fields = fields["claims"].struct_value.fields
            if name in claim_fields and (value := _string_value(claim_fields[name])):
                return value
    return None


def _subject(request: CheckRequest) -> Subject | None:
    sub = _metadata_claim(request, "sub")
    if not sub:
        return None
    preferred = _metadata_claim(request, "preferred_username") or ""
    subject_type = (
        SubjectType.SERVICE_ACCOUNT
        if preferred.startswith("service-account-")
        else SubjectType.USER
    )
    return Subject(type=subject_type, id=sub)


def _decode_b64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _agent_context(headers: dict[str, str], settings: Settings) -> AgentContext | None:
    if not settings.agent_context_hmac_secret:
        return None
    encoded = headers.get("x-caipe-agent-context", "")
    signature = headers.get("x-caipe-agent-context-signature", "")
    if not encoded or not signature:
        return None
    expected = hmac.new(
        settings.agent_context_hmac_secret.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return None
    try:
        payload = json.loads(_decode_b64(encoded))
    except (ValueError, json.JSONDecodeError):
        return None
    agent_id = payload.get("agent_id")
    kind = payload.get("kind", "dynamic")
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    now = int(time.time())
    if (
        not isinstance(agent_id, str)
        or not agent_id
        or kind not in {"dynamic", "local"}
        or not isinstance(issued_at, int)
        or not isinstance(expires_at, int)
        or issued_at > now + 30
        or expires_at < now
        or expires_at - issued_at > (28800 if kind == "local" else 300)
    ):
        return None
    return AgentContext(agent_id=agent_id, kind=kind)


def _tool_call(request: CheckRequest, *, max_body_bytes: int = 65536) -> ToolCall | None:
    http = request.attributes.request.http
    path = http.path.split("?", 1)[0].rstrip("/")
    if not path.startswith("/mcp/"):
        return None
    target = path.removeprefix("/mcp/").split("/", 1)[0]
    raw = bytes(http.raw_body) if http.raw_body else http.body.encode()
    if not raw:
        return None
    payload = parse_bounded_json(raw, max_bytes=max_body_bytes)
    if payload.get("method") != "tools/call":
        return None
    params = payload.get("params")
    if not isinstance(params, dict):
        raise ContextError("tools/call params must be an object")
    name = params.get("name")
    arguments = params.get("arguments", {})
    if not isinstance(name, str) or not name or not isinstance(arguments, dict):
        raise ContextError("tools/call name and arguments are invalid")
    return ToolCall(target=target, name=name, arguments=arguments)


def _mcp_target(request: CheckRequest) -> str | None:
    path = request.attributes.request.http.path.split("?", 1)[0].rstrip("/")
    if not path.startswith("/mcp/"):
        return None
    value = path.removeprefix("/mcp/").split("/", 1)[0]
    return value or None


def _canonical(
    *,
    subject: Subject,
    resource_type: str,
    resource_id: str,
    action: str,
    request: CheckRequest,
    arguments: dict[str, Any] | None = None,
    schema_hash: str | None = None,
) -> CanonicalDecisionRequest:
    http = request.attributes.request.http
    return CanonicalDecisionRequest(
        surface=Surface.AGENTGATEWAY,
        transport=Transport.EXT_AUTHZ,
        subject=subject,
        action=action,
        resource=Resource(type=resource_type, id=resource_id),
        context=DecisionContext(
            request=RequestContext(
                arguments=arguments,
                method=http.method or None,
                path=http.path or None,
            ),
            resource=ResourceContext(schema_hash=schema_hash),
        ),
    )


class ExtAuthzService:
    def __init__(self, engine: DecisionEngine, settings: Settings) -> None:
        self.engine = engine
        self.settings = settings
        self.schema_hashes = settings.schema_hashes()

    async def Check(self, request: CheckRequest, _context: grpc.ServicerContext) -> CheckResponse:
        invocation_metadata = (
            {item.key.lower(): item.value for item in _context.invocation_metadata()}
            if _context is not None
            else {}
        )
        authorization = invocation_metadata.get("authorization", "")
        token = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
        authenticated_service = bool(self.settings.service_token) and hmac.compare_digest(
            token,
            self.settings.service_token,
        )
        if not self.settings.allow_insecure_headers and not authenticated_service:
            return response(
                allowed=False,
                code=UNAUTHENTICATED,
                message="authenticated ext_authz caller required",
            )
        shadow = (
            invocation_metadata.get("x-caipe-evaluation-purpose") == "shadow"
            and authenticated_service
        )

        async def journal(
            final_request: CanonicalDecisionRequest,
            final_result: CanonicalDecisionResult,
        ) -> CanonicalDecisionResult:
            if shadow:
                return final_result
            return await self.engine.journal(final_request, final_result)

        subject = _subject(request)
        if subject is None:
            return response(allowed=False, code=UNAUTHENTICATED, message="verified identity required")
        headers = {
            str(key).lower(): str(value)
            for key, value in request.attributes.request.http.headers.items()
        }
        try:
            tool = _tool_call(request, max_body_bytes=self.settings.tool_policy_max_body_bytes)
        except ContextError:
            return response(allowed=False, code=PERMISSION_DENIED, message="invalid MCP request")

        gateway = _canonical(
            subject=subject,
            resource_type="mcp_gateway",
            resource_id="list",
            action="invoke",
            request=request,
        )
        gateway_result = await self.engine.decide(gateway, emit_event=False)
        if not gateway_result.allowed:
            gateway_result = await journal(gateway, gateway_result)
            return response(allowed=False, code=PERMISSION_DENIED, message=gateway_result.reason_code)
        final_coarse_request = gateway
        final_coarse_result = gateway_result
        target = _mcp_target(request)
        if target in self.settings.restricted_mcp_servers:
            server_request = _canonical(
                subject=subject,
                resource_type="mcp_server",
                resource_id=target,
                action="invoke",
                request=request,
            )
            server_result = await self.engine.decide(server_request, emit_event=False)
            if not server_result.allowed:
                server_result = await journal(server_request, server_result)
                return response(
                    allowed=False,
                    code=PERMISSION_DENIED,
                    message=server_result.reason_code,
                )
            final_coarse_request = server_request
            final_coarse_result = server_result
        if tool is None:
            final_coarse_result = await journal(final_coarse_request, final_coarse_result)
            if not final_coarse_result.allowed:
                return response(
                    allowed=False,
                    code=PERMISSION_DENIED,
                    message=final_coarse_result.reason_code,
                )
            return response(allowed=True, code=OK)

        signed_agent = _agent_context(headers, self.settings)
        if self.settings.agent_context_hmac_secret and signed_agent is None:
            denied = await self.engine.deny(
                gateway,
                ReasonCode.DENY_MISSING_CONTEXT,
                emit_event=not shadow,
            )
            return response(allowed=False, code=PERMISSION_DENIED, message=denied.reason_code)
        schema_hash = self.schema_hashes.get(f"{tool.target}/{tool.name}")
        if signed_agent is not None and signed_agent.kind == "dynamic":
            can_use = _canonical(
                subject=subject,
                resource_type="agent",
                resource_id=signed_agent.agent_id,
                action="use",
                request=request,
            )
            agent_use = await self.engine.decide(can_use, emit_event=False)
            if not agent_use.allowed:
                agent_use = await journal(can_use, agent_use)
                return response(allowed=False, code=PERMISSION_DENIED, message=agent_use.reason_code)
            agent_subject = Subject(type=SubjectType.AGENT, id=signed_agent.agent_id)
            agent_exact = _canonical(
                subject=agent_subject,
                resource_type="tool",
                resource_id=f"{tool.target}/{tool.name}",
                action="invoke",
                request=request,
                arguments=tool.arguments,
                schema_hash=schema_hash,
            )
            agent_result = await self.engine.decide(agent_exact, emit_event=False)
            if not agent_result.allowed:
                agent_wildcard = agent_exact.model_copy(
                    update={"resource": Resource(type="tool", id=f"{tool.target}/*")}
                )
                agent_result = await self.engine.decide(agent_wildcard, emit_event=False)
            if not agent_result.allowed:
                agent_result = await journal(agent_wildcard, agent_result)
                return response(allowed=False, code=PERMISSION_DENIED, message=agent_result.reason_code)

        caller_exact = _canonical(
            subject=subject,
            resource_type="tool",
            resource_id=f"{tool.target}/{tool.name}",
            action="invoke",
            request=request,
            arguments=tool.arguments,
            schema_hash=schema_hash,
        )
        caller_result = await self.engine.decide(caller_exact, emit_event=False)
        final_request = caller_exact
        if not caller_result.allowed:
            wildcard = caller_exact.model_copy(
                update={"resource": Resource(type="tool", id=f"{tool.target}/*")}
            )
            caller_result = await self.engine.decide(wildcard, emit_event=False)
            final_request = wildcard
        caller_result = await journal(final_request, caller_result)
        return response(
            allowed=caller_result.allowed,
            code=OK if caller_result.allowed else PERMISSION_DENIED,
            message="" if caller_result.allowed else caller_result.reason_code,
        )


def add_to_server(server: grpc.aio.Server, service: ExtAuthzService) -> None:
    handler = grpc.unary_unary_rpc_method_handler(
        service.Check,
        request_deserializer=CheckRequest.FromString,
        response_serializer=lambda value: value.SerializeToString(),
    )
    generic = grpc.method_handlers_generic_handler(
        "envoy.service.auth.v3.Authorization",
        {"Check": handler},
    )
    server.add_generic_rpc_handlers((generic,))

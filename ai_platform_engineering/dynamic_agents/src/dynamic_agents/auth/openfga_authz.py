"""OpenFGA authorization checks for Dynamic Agent execution."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from fastapi import HTTPException
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from dynamic_agents.auth.token_context import current_traceparent, current_user_token
from dynamic_agents.auth.workflow_execution_authz import can_use_agent_via_workflow
from dynamic_agents.models import UserContext
from dynamic_agents.services.mongo import MongoDBService

logger = logging.getLogger(__name__)

DEFAULT_STORE_NAME = "caipe-openfga"
AUDIT_COLLECTION = "audit_events"
OPENFGA_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
OPENFGA_EMAIL_PRINCIPAL_PATTERN = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$")
SUBJECT_SALT = os.getenv("AUDIT_SUBJECT_SALT", "caipe-098-audit")
TRACEPARENT_PATTERN = re.compile(r"^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$")
_audit_mongo_client: MongoClient | None = None
_audit_indexes_ensured = False
_audit_client_lock = threading.Lock()
_audit_indexes_lock = threading.Lock()


def _error_detail(error: str, code: str, reason: str, action: str) -> dict[str, Any]:
    return {
        "success": False,
        "error": error,
        "code": code,
        "reason": reason,
        "action": action,
    }


def _raise_authz(status_code: int, error: str, code: str, reason: str, action: str) -> None:
    raise HTTPException(
        status_code=status_code,
        detail=_error_detail(error, code, reason, action),
    )


def _is_valid_openfga_id(value: str | None) -> bool:
    return bool(value and OPENFGA_ID_PATTERN.fullmatch(value))


def _hash_subject(subject: str) -> str:
    digest = hashlib.sha256(f"{SUBJECT_SALT}:{subject}".encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _get_audit_mongo_client() -> MongoClient | None:
    """Return a MongoDB client for audit writes when Mongo is configured."""
    global _audit_mongo_client
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        return None
    if _audit_mongo_client is not None:
        return _audit_mongo_client
    with _audit_client_lock:
        if _audit_mongo_client is not None:
            return _audit_mongo_client
        try:
            _audit_mongo_client = MongoClient(
                uri,
                serverSelectionTimeoutMS=3000,
                retryWrites=False,
                tz_aware=True,
            )
            _audit_mongo_client.admin.command("ping")
        except PyMongoError as exc:
            logger.warning("MongoDB unavailable for Dynamic Agents authz audit: %s", exc)
            _audit_mongo_client = None
    return _audit_mongo_client


def _ensure_audit_indexes(client: MongoClient) -> None:
    """Create lightweight audit indexes once per process."""
    global _audit_indexes_ensured
    if _audit_indexes_ensured:
        return
    with _audit_indexes_lock:
        if _audit_indexes_ensured:
            return
        database = os.getenv("MONGODB_DATABASE", "caipe")
        try:
            coll = client[database][AUDIT_COLLECTION]
            coll.create_index([("ts", -1)])
            coll.create_index([("type", 1), ("ts", -1)])
            coll.create_index([("subject_hash", 1), ("ts", -1)])
            coll.create_index([("source", 1), ("ts", -1)])
            coll.create_index([("correlation_id", 1)])
            _audit_indexes_ensured = True
        except PyMongoError as exc:
            logger.warning("Failed to ensure Dynamic Agents authz audit indexes: %s", exc)


def _persist_openfga_rebac_audit(event: dict[str, Any]) -> None:
    """Best-effort insert into the unified audit_events collection."""
    client = _get_audit_mongo_client()
    if client is None:
        return
    document = dict(event)
    ts = document.get("ts")
    if isinstance(ts, str):
        try:
            document["ts"] = datetime.fromisoformat(ts)
        except ValueError:
            document["ts"] = datetime.now(UTC)
    try:
        _ensure_audit_indexes(client)
        database = os.getenv("MONGODB_DATABASE", "caipe")
        client[database][AUDIT_COLLECTION].insert_one(document)
    except PyMongoError as exc:
        logger.warning("Failed to persist Dynamic Agents authz audit event: %s", exc)


def _parse_traceparent(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    match = TRACEPARENT_PATTERN.fullmatch(value.strip().lower())
    if not match:
        return None
    return match.group(1), match.group(2)


def _new_span_id() -> str:
    return os.urandom(8).hex()


def _child_traceparent(parent_traceparent: str | None) -> tuple[str | None, str | None, str | None]:
    parsed = _parse_traceparent(parent_traceparent)
    if not parsed:
        return None, None, None
    trace_id, parent_span_id = parsed
    span_id = _new_span_id()
    return trace_id, span_id, f"00-{trace_id}-{span_id}-01"


def _openfga_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    traceparent = current_traceparent.get()
    if traceparent:
        headers["traceparent"] = traceparent
    return headers


def _otel_attr(key: str, value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"key": key, "value": {"boolValue": value}}
    if isinstance(value, int | float):
        return {"key": key, "value": {"doubleValue": float(value)}}
    return {"key": key, "value": {"stringValue": str(value)}}


async def _export_authz_span(
    *,
    name: str,
    trace_id: str | None,
    span_id: str | None,
    parent_span_id: str | None,
    start_ns: int,
    end_ns: int,
    attributes: dict[str, Any],
) -> None:
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "").strip()
    enabled = os.getenv("AUTHZ_TRACING_ENABLED", "").strip().lower() in {"1", "true", "yes"}
    if not enabled or not endpoint or not trace_id or not span_id:
        return

    span: dict[str, Any] = {
        "traceId": trace_id,
        "spanId": span_id,
        "name": name,
        "kind": 2,
        "startTimeUnixNano": str(start_ns),
        "endTimeUnixNano": str(end_ns),
        "attributes": [
            _otel_attr("audit.type", "openfga_rebac"),
            _otel_attr("authz.pdp", "openfga"),
            *[_otel_attr(key, value) for key, value in attributes.items() if value is not None],
        ],
    }
    if parent_span_id:
        span["parentSpanId"] = parent_span_id

    body = {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        _otel_attr("service.name", os.getenv("OTEL_SERVICE_NAME", "dynamic-agents")),
                        _otel_attr("deployment.environment", os.getenv("ENVIRONMENT", "development")),
                    ]
                },
                "scopeSpans": [{"scope": {"name": "dynamic_agents.authz"}, "spans": [span]}],
            }
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(endpoint, json=body)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to export Dynamic Agents authz span: %s", exc)


def _log_openfga_rebac_audit(
    *,
    subject: str,
    agent_id: str,
    outcome: str,
    reason_code: str,
) -> None:
    """Emit a privacy-aware OpenFGA ReBAC audit event from the DA runtime."""
    parsed_trace = _parse_traceparent(current_traceparent.get())
    trace_id = parsed_trace[0] if parsed_trace else None
    span_id = parsed_trace[1] if parsed_trace else None
    event = {
        "audit_event_id": str(uuid.uuid4()),
        "ts": datetime.now(UTC).isoformat(),
        "type": "openfga_rebac",
        "tenant_id": os.getenv("TENANT_ID", "default"),
        "subject_hash": _hash_subject(subject),
        "action": "dynamic_agent#use",
        "outcome": outcome,
        "reason_code": reason_code,
        "correlation_id": str(uuid.uuid4()),
        "component": "dynamic_agent",
        "resource_ref": f"agent:{agent_id}",
        "pdp": "openfga",
        "source": "dynamic_agents",
        "trace_id": trace_id,
        "span_id": span_id,
    }
    _persist_openfga_rebac_audit(event)
    logger.info(json.dumps(event, separators=(",", ":")))


def _decode_subject_from_validated_token(token: str) -> str | None:
    body = _decode_payload_from_validated_token(token)
    sub = body.get("sub") if body else None
    return sub if isinstance(sub, str) else None


def _decode_payload_from_validated_token(token: str) -> dict[str, Any] | None:
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(f"{payload}{padding}")
        body = json.loads(decoded.decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    return body if isinstance(body, dict) else None


def _normalize_email_principal(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if OPENFGA_EMAIL_PRINCIPAL_PATTERN.fullmatch(normalized) else None


def _openfga_http_url() -> str:
    base_url = os.getenv("OPENFGA_HTTP", "").strip().rstrip("/")
    if not base_url:
        raise RuntimeError("OPENFGA_HTTP is not set")
    return base_url


def _openfga_store_name() -> str:
    return os.getenv("OPENFGA_STORE_NAME", "").strip() or DEFAULT_STORE_NAME


async def _get_openfga_store_id(client: httpx.AsyncClient, base_url: str) -> str:
    explicit_store_id = os.getenv("OPENFGA_STORE_ID", "").strip()
    if explicit_store_id:
        return explicit_store_id

    response = await client.get(f"{base_url}/stores", headers=_openfga_headers())
    response.raise_for_status()
    body = response.json()
    store_name = _openfga_store_name()
    for store in body.get("stores", []):
        if store.get("name") == store_name and store.get("id"):
            return str(store["id"])
    raise RuntimeError(f"OpenFGA store {store_name} was not found")


async def _check_agent_use(subject: str, agent_id: str) -> bool:
    base_url = _openfga_http_url()
    async with httpx.AsyncClient(timeout=5.0) as client:
        store_id = await _get_openfga_store_id(client, base_url)
        response = await client.post(
            f"{base_url}/stores/{store_id}/check",
            headers=_openfga_headers(),
            json={
                "tuple_key": {
                    "user": f"user:{subject}",
                    "relation": "can_use",
                    "object": f"agent:{agent_id}",
                }
            },
        )
        response.raise_for_status()
        body = response.json()
        return bool(body.get("allowed"))


async def require_agent_use_permission(
    agent_id: str,
    *,
    workflow_config_id: str | None = None,
    mongo: MongoDBService | None = None,
    user: UserContext | None = None,
) -> None:
    """Require the current bearer token subject to have can_use on an agent."""
    if not _is_valid_openfga_id(agent_id):
        _raise_authz(
            400,
            "Invalid agent identifier",
            "invalid_agent_id",
            "invalid_request",
            "fix_request",
        )

    token = current_user_token.get()
    if not token:
        _raise_authz(
            401,
            "Bearer token is required",
            "missing_bearer",
            "not_signed_in",
            "sign_in",
        )

    payload = _decode_payload_from_validated_token(token)
    subject = payload.get("sub") if payload else None
    if not _is_valid_openfga_id(subject):
        _raise_authz(
            401,
            "Bearer token subject could not be verified",
            "bearer_invalid",
            "bearer_invalid",
            "sign_in",
        )

    email_principal = _normalize_email_principal(payload.get("email") if payload else None)
    principal_candidates = [subject]
    if email_principal:
        principal_candidates.append(email_principal)

    parent_traceparent = current_traceparent.get()
    trace_id, span_id, child_traceparent = _child_traceparent(parent_traceparent)
    trace_ctx_token = None
    if child_traceparent:
        trace_ctx_token = current_traceparent.set(child_traceparent)
    start_ns = time.time_ns()

    def reset_trace_context() -> None:
        nonlocal trace_ctx_token
        if trace_ctx_token is not None:
            current_traceparent.reset(trace_ctx_token)
            trace_ctx_token = None

    try:
        allowed = False
        for candidate in principal_candidates:
            allowed = await _check_agent_use(candidate, agent_id)
            if allowed:
                break
    except Exception as exc:
        logger.warning("OpenFGA agent-use check failed for agent=%s: %s", agent_id, exc)
        _log_openfga_rebac_audit(
            subject=subject,
            agent_id=agent_id,
            outcome="deny",
            reason_code="DENY_PDP_UNAVAILABLE",
        )
        reset_trace_context()
        _raise_authz(
            503,
            "Authorization service is temporarily unavailable. Please try again in a moment.",
            "PDP_UNAVAILABLE",
            "pdp_unavailable",
            "retry",
        )
    finally:
        end_ns = time.time_ns()
        await _export_authz_span(
            name="authz.dynamic_agents.agent_use",
            trace_id=trace_id,
            span_id=span_id,
            parent_span_id=_parse_traceparent(parent_traceparent)[1]
            if _parse_traceparent(parent_traceparent)
            else None,
            start_ns=start_ns,
            end_ns=end_ns,
            attributes={
                "authz.action": "can_use",
                "authz.resource": "dynamic_agent",
                "authz.agent_id": agent_id,
                "authz.tenant_id": os.getenv("TENANT_ID", "default"),
            },
        )

    if (
        not allowed
        and workflow_config_id
        and mongo is not None
        and user is not None
        and can_use_agent_via_workflow(agent_id, workflow_config_id, user, mongo)
    ):
        allowed = True

    if allowed:
        _log_openfga_rebac_audit(
            subject=subject,
            agent_id=agent_id,
            outcome="allow",
            reason_code="OK",
        )
        reset_trace_context()
        return

    if not allowed:
        _log_openfga_rebac_audit(
            subject=subject,
            agent_id=agent_id,
            outcome="deny",
            reason_code="DENY_NO_CAPABILITY",
        )
        reset_trace_context()
        _raise_authz(
            403,
            "Permission denied",
            "agent#use",
            "pdp_denied",
            "contact_admin",
        )

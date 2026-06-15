"""Agent-use authorization for Dynamic Agents.

DA is a thin Policy Enforcement Point (PEP): it validates the caller's bearer and
asks the Centralized Authorization Service (CAS) for the decision. CAS is the
single PDP — it evaluates the OpenFGA capability and any org-admin bypass, and
records the decision audit (`cas_decision`). DA performs no in-process OpenFGA
checks and writes no audit of its own.

Config:
    AUTHZ_SERVICE_URL   base URL of the authz service (the BFF/CAS), e.g.
                        http://caipe-ui:3000. DA POSTs to
                        {AUTHZ_SERVICE_URL}/api/authz/v1/decisions.

assisted-by claude code claude-sonnet-4-6
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException

from dynamic_agents.auth.token_context import current_traceparent, current_user_token
from dynamic_agents.models import UserContext

logger = logging.getLogger(__name__)

# Safe id charset for agent ids and subjects (alnum plus . _ -).
_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")

# CAS decision endpoint, relative to AUTHZ_SERVICE_URL.
_DECISIONS_PATH = "/api/authz/v1/decisions"


def _error_detail(error: str, code: str, reason: str, action: str) -> dict[str, Any]:
    return {"success": False, "error": error, "code": code, "reason": reason, "action": action}


def _raise_authz(status_code: int, error: str, code: str, reason: str, action: str) -> None:
    raise HTTPException(status_code=status_code, detail=_error_detail(error, code, reason, action))


def _is_valid_id(value: str | None) -> bool:
    return bool(value and _ID_PATTERN.fullmatch(value))


def _subject_from_token(token: str) -> str | None:
    """Read `sub` from an already-validated bearer. The JWT signature is verified
    upstream (gateway / middleware); here we only decode the claim."""
    parts = token.split(".")
    if len(parts) < 2:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        body = json.loads(base64.urlsafe_b64decode(f"{payload}{padding}").decode("utf-8"))
    except (ValueError, json.JSONDecodeError):
        return None
    sub = body.get("sub") if isinstance(body, dict) else None
    return sub if isinstance(sub, str) and sub.strip() else None


def _authz_service_url() -> str | None:
    """Base URL of the authz service (CAS, served by the BFF)."""
    url = os.getenv("AUTHZ_SERVICE_URL", "").strip().rstrip("/")
    return url or None


def _require_bearer_enabled() -> bool:
    return os.getenv("DA_REQUIRE_BEARER", "").strip().lower() in ("1", "true", "yes")


async def _decide_agent_use(subject: str, agent_id: str, bearer: str) -> bool:
    """Ask CAS whether `subject` may use `agent_id`.

    Forwards the caller's bearer (OBO) so CAS's subject-binding (caller == subject)
    is satisfied; CAS evaluates the capability and the org-admin bypass. A DENY is
    a 200 with ``decision: DENY``; any non-200 — or missing config — raises so the
    caller fails closed (treated as PDP-unavailable)."""
    base = _authz_service_url()
    if not base:
        raise RuntimeError("AUTHZ_SERVICE_URL is not configured")
    headers = {"Authorization": f"Bearer {bearer}", "Content-Type": "application/json"}
    traceparent = current_traceparent.get()
    if traceparent:
        headers["traceparent"] = traceparent
    body = {
        "subject": {"type": "user", "id": subject},
        "resource": {"type": "agent", "id": agent_id},
        "action": "use",
    }
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(f"{base}{_DECISIONS_PATH}", headers=headers, json=body)
    if response.status_code != 200:
        raise RuntimeError(f"CAS decision endpoint returned HTTP {response.status_code}")
    return response.json().get("decision") == "ALLOW"


async def require_agent_use_permission(agent_id: str, user_context: UserContext | None = None) -> None:
    """Require the current bearer's subject to be allowed to use ``agent_id``.

    Delegates the decision to CAS (the single PDP). Raises ``HTTPException`` with a
    structured detail on deny (403) or any meta-failure (400/401/503)."""
    if not _is_valid_id(agent_id):
        _raise_authz(400, "Invalid agent identifier", "invalid_agent_id", "invalid_request", "fix_request")

    token = current_user_token.get()
    if not token:
        if not _require_bearer_enabled() and user_context and user_context.is_admin:
            logger.warning(
                "Allowing legacy gateway user-context agent-use check for admin user=%s agent=%s "
                "(DA_REQUIRE_BEARER=false)",
                user_context.email,
                agent_id,
            )
            return
        _raise_authz(401, "Bearer token is required", "missing_bearer", "not_signed_in", "sign_in")

    subject = _subject_from_token(token)
    if not _is_valid_id(subject):
        _raise_authz(401, "Bearer token subject could not be verified", "bearer_invalid", "bearer_invalid", "sign_in")

    try:
        allowed = await _decide_agent_use(subject, agent_id, token)
    except Exception as exc:  # noqa: BLE001 — any failure to get a decision fails closed
        logger.warning("CAS agent-use decision unavailable for agent=%s: %s", agent_id, exc)
        _raise_authz(
            503,
            "Authorization service is temporarily unavailable. Please try again in a moment.",
            "PDP_UNAVAILABLE",
            "pdp_unavailable",
            "retry",
        )

    if not allowed:
        logger.info("CAS denied agent-use: agent=%s", agent_id)
        _raise_authz(403, "Permission denied", "agent#use", "pdp_denied", "contact_admin")

    logger.debug("CAS allowed agent-use: agent=%s", agent_id)

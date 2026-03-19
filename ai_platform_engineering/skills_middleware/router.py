# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""FastAPI router for the skills catalog API.

Exposes GET /skills returning the merged catalog for UI consumption.
Validates Bearer token via OIDC/JWKS when configured (FR-014).
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(tags=["skills"])


async def _validate_auth(request: Request) -> None:
    """Validate Bearer token if OIDC is configured.

    Follows the same JWKS validation pattern as the RAG server (FR-014).
    When OIDC env vars are not set, auth is bypassed (development mode).
    """
    oidc_issuer = os.getenv("OIDC_ISSUER")
    if not oidc_issuer:
        return  # Auth not configured — development mode

    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[7:]

    try:
        from jose import jwt
        import httpx

        # Fetch JWKS from OIDC discovery
        discovery_url = os.getenv("OIDC_DISCOVERY_URL") or f"{oidc_issuer}/.well-known/openid-configuration"
        async with httpx.AsyncClient(follow_redirects=True) as client:
            oidc_resp = await client.get(discovery_url, timeout=10.0)
            oidc_resp.raise_for_status()
            jwks_uri = oidc_resp.json().get("jwks_uri")

            jwks_resp = await client.get(jwks_uri, timeout=10.0)
            jwks_resp.raise_for_status()
            jwks = jwks_resp.json()

        audience = os.getenv("OIDC_CLIENT_ID", "")
        # Decode and validate
        jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=audience if audience else None,
            issuer=oidc_issuer,
        )
    except Exception as e:
        logger.warning("JWT validation failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _filter_skills(
    skills: list[dict[str, Any]],
    *,
    q: str,
    source: str,
    tags: list[str],
) -> list[dict[str, Any]]:
    """Apply in-memory text search, source, and tag filters."""
    result = skills

    if q:
        q_lower = q.lower()
        result = [
            s for s in result
            if q_lower in s.get("name", "").lower()
            or q_lower in s.get("description", "").lower()
        ]

    if source:
        source_lower = source.lower()
        result = [s for s in result if s.get("source", "").lower() == source_lower]

    if tags:
        tags_lower = {t.lower() for t in tags}
        result = [
            s for s in result
            if tags_lower & {
                t.lower()
                for t in (s.get("metadata") or {}).get("tags", [])
                if isinstance(t, str)
            }
        ]

    return result


def _paginate(
    skills: list[dict[str, Any]],
    *,
    page: int,
    page_size: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return a page slice and pagination metadata.

    When page=0, returns all results (no pagination).
    """
    total = len(skills)

    if page <= 0:
        return skills, {"total": total}

    start = (page - 1) * page_size
    paged = skills[start : start + page_size]
    return paged, {
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": start + page_size < total,
    }


@router.get("/skills")
async def list_skills(
    include_content: bool = False,
    q: str = "",
    source: str = "",
    tags: str = "",
    page: int = 0,
    page_size: int = 50,
    _auth: None = Depends(_validate_auth),
) -> dict[str, Any]:
    """Return the merged skill catalog.

    Query params:
        include_content: If true, include full SKILL.md body for each skill.
        q: Case-insensitive text search in name and description.
        source: Filter by source (default, agent_config, hub).
        tags: Comma-separated tag filter (match any).
        page: Page number, 1-indexed. 0 = no pagination (return all).
        page_size: Items per page (1-100, default 50).

    Returns:
        ``{ skills: [...], meta: { total, page?, page_size?, has_more?,
        sources_loaded, unavailable_sources } }``
    """
    # Clamp page_size
    page_size = max(1, min(100, page_size))

    try:
        from ai_platform_engineering.skills_middleware.catalog import (
            get_merged_skills,
            get_unavailable_sources,
        )

        skills = get_merged_skills(include_content=include_content)
        sources_loaded = sorted({s.get("source", "unknown") for s in skills})
        unavailable = get_unavailable_sources()

        # Apply filters
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        filtered = _filter_skills(skills, q=q, source=source, tags=tag_list)

        # Apply pagination
        paged, page_meta = _paginate(filtered, page=page, page_size=page_size)

        return {
            "skills": paged,
            "meta": {
                **page_meta,
                "sources_loaded": sources_loaded,
                "unavailable_sources": unavailable,
            },
        }
    except Exception as e:
        logger.error("Failed to load skills catalog: %s", e)
        raise HTTPException(
            status_code=503,
            detail={
                "error": "skills_unavailable",
                "message": "Skills are temporarily unavailable. Please try again later.",
            },
        )


@router.post("/skills/refresh")
async def refresh_skills(
    _auth: None = Depends(_validate_auth),
) -> dict[str, str]:
    """Invalidate the skills cache so next request gets fresh data (FR-012)."""
    from ai_platform_engineering.skills_middleware.catalog import invalidate_skills_cache

    invalidate_skills_cache()
    return {"status": "ok", "message": "Skills cache invalidated"}

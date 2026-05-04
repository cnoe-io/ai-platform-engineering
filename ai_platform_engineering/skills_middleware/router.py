# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
"""FastAPI router for the skills catalog API.

Exposes GET /skills returning the merged catalog for UI consumption.
Validates Bearer token via OIDC/JWKS when configured (FR-014).
Optional catalog API key header (FR-018 / gateway-api.md).
Applies visibility entitlement (FR-020).
"""

from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ai_platform_engineering.skills_middleware.entitlement import (
    filter_by_visibility_param,
    filter_skills_by_entitlement,
    team_ids_from_claims,
)

logger = logging.getLogger(__name__)

CATALOG_API_KEY_HEADER = os.getenv("CAIPE_CATALOG_API_KEY_HEADER", "X-Caipe-Catalog-Key").strip() or "X-Caipe-Catalog-Key"


class SkillHubCrawlBody(BaseModel):
    """Request body for GitHub hub crawl preview (no persistence)."""

    type: str = Field(default="github", description="Hub type; only github supported for crawl.")
    location: str = Field(..., description="owner/repo")
    credentials_ref: str | None = Field(default=None, description="Env var name for GitHub token.")


class CatalogAuthContext(BaseModel):
    """Resolved principal for catalog entitlement (FR-020)."""

    sub: str | None = None
    team_ids: list[str] = Field(default_factory=list)
    bypass_entitlement: bool = False
    auth_method: str = "anonymous"


router = APIRouter(tags=["skills"])


async def get_catalog_auth_key_mgmt(request: Request) -> CatalogAuthContext:
    """JWT/session path only; reject catalog API key header (T050)."""
    if CATALOG_API_KEY_HEADER in request.headers:
        raise HTTPException(
            status_code=403,
            detail="Catalog API key cannot be used to manage API keys",
        )
    return await get_catalog_auth(request)


def _catalog_api_key_owner(auth: CatalogAuthContext) -> str:
    if auth.sub:
        return auth.sub
    if auth.bypass_entitlement:
        return os.getenv("CAIPE_CATALOG_API_KEY_DEFAULT_OWNER", "local-anonymous")
    raise HTTPException(status_code=401, detail="Authentication required")


async def get_catalog_auth(request: Request) -> CatalogAuthContext:
    """Resolve JWT or catalog API key; enforce auth when OIDC is configured."""
    oidc_issuer = os.getenv("OIDC_ISSUER")

    # 1) Catalog API key when client sends the header (FR-018)
    if CATALOG_API_KEY_HEADER in request.headers:
        from ai_platform_engineering.skills_middleware.api_keys_store import verify_catalog_api_key

        raw_key = request.headers.get(CATALOG_API_KEY_HEADER, "").strip()
        owner = verify_catalog_api_key(raw_key) if raw_key else None
        if owner is None:
            raise HTTPException(status_code=401, detail="Invalid or expired API key")
        return CatalogAuthContext(
            sub=owner,
            team_ids=[],
            bypass_entitlement=False,
            auth_method="api_key",
        )

    # 2) Bearer JWT when OIDC configured
    auth_header = request.headers.get("Authorization", "")
    if oidc_issuer:
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

        token = auth_header[7:]

        try:
            import jwt as pyjwt
            import httpx

            discovery_url = os.getenv("OIDC_DISCOVERY_URL") or f"{oidc_issuer}/.well-known/openid-configuration"
            async with httpx.AsyncClient(follow_redirects=True) as client:
                oidc_resp = await client.get(discovery_url, timeout=10.0)
                oidc_resp.raise_for_status()
                jwks_uri = oidc_resp.json().get("jwks_uri")

            jwks_client = pyjwt.PyJWKClient(jwks_uri)
            signing_key = jwks_client.get_signing_key_from_jwt(token)

            audience = os.getenv("OIDC_CLIENT_ID", "")
            decode_opts: dict[str, Any] = {
                "algorithms": ["RS256"],
                "issuer": oidc_issuer,
            }
            if audience:
                decode_opts["audience"] = audience

            payload = pyjwt.decode(
                token,
                signing_key.key,
                **decode_opts,
            )
            if not isinstance(payload, dict):
                raise ValueError("invalid payload")
            sub = payload.get("sub")
            teams = team_ids_from_claims(payload)
            return CatalogAuthContext(
                sub=str(sub) if sub is not None else None,
                team_ids=teams,
                bypass_entitlement=False,
                auth_method="jwt",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("JWT validation failed: %s", e)
            raise HTTPException(status_code=401, detail="Invalid or expired token")

    # 3) Development / no OIDC: full catalog (no entitlement filter)
    return CatalogAuthContext(
        sub=None,
        team_ids=[],
        bypass_entitlement=True,
        auth_method="anonymous",
    )


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
            s
            for s in result
            if q_lower in s.get("name", "").lower() or q_lower in s.get("description", "").lower()
        ]

    if source:
        source_lower = source.lower()
        result = [s for s in result if s.get("source", "").lower() == source_lower]

    if tags:
        tags_lower = {t.lower() for t in tags}
        result = [
            s
            for s in result
            if tags_lower
            & {
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

    When page<=0, returns all results (no pagination).
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
    visibility: str = "",
    page: int = 0,
    page_size: int = 50,
    auth: CatalogAuthContext = Depends(get_catalog_auth),
) -> dict[str, Any]:
    """Return the merged skill catalog.

    Query params:
        include_content: If true, include full SKILL.md body for each skill.
        q: Case-insensitive text search in name and description.
        source: Filter by source (default, agent_skills, hub).
        tags: Comma-separated tag filter (match any).
        visibility: Optional filter within entitled set (global | team | personal).
        page: Page number, 1-indexed. 0 = no pagination (return all).
        page_size: Items per page (1-100, default 50).

    Returns:
        ``{ skills: [...], meta: { total, page?, page_size?, has_more?,
        sources_loaded, unavailable_sources } }``
    """
    page_size = max(1, min(100, page_size))

    try:
        from ai_platform_engineering.skills_middleware.catalog import (
            get_merged_skills,
            get_unavailable_sources,
        )

        skills = get_merged_skills(include_content=include_content)
        sources_loaded = sorted({s.get("source", "unknown") for s in skills})
        unavailable = get_unavailable_sources()

        entitled = filter_skills_by_entitlement(
            skills,
            sub=auth.sub,
            team_ids=auth.team_ids,
            bypass_entitlement=auth.bypass_entitlement,
        )

        if visibility.strip():
            entitled = filter_by_visibility_param(entitled, visibility)

        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
        filtered = _filter_skills(entitled, q=q, source=source, tags=tag_list)

        paged, page_meta = _paginate(filtered, page=page, page_size=page_size)

        meta: dict[str, Any] = {
            **page_meta,
            "sources_loaded": sources_loaded,
            "unavailable_sources": unavailable,
        }
        if q and not paged:
            meta["message"] = "no_matches"

        return {
            "skills": paged,
            "meta": meta,
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
    include_hubs: bool = True,
    _auth: CatalogAuthContext = Depends(get_catalog_auth),
) -> dict[str, Any]:
    """Invalidate catalog cache and rebuild supervisor graph so MAS picks up skills (FR-012).

    Query params:
        include_hubs: If false, keep the hub cache intact and only re-merge
            default + agent_skills sources.  Useful after agent-skills CRUD
            to avoid the expensive GitHub hub re-fetch.
    """
    from ai_platform_engineering.skills_middleware.catalog import invalidate_skills_cache
    from ai_platform_engineering.skills_middleware.mas_registry import get_mas_instance

    invalidate_skills_cache(include_hubs=include_hubs)
    mas = get_mas_instance()
    rebuilt = False
    if mas is not None:
        try:
            if hasattr(mas, "_rebuild_graph_async"):
                rebuilt = bool(await mas._rebuild_graph_async())
            elif hasattr(mas, "_rebuild_graph"):
                rebuilt = bool(mas._rebuild_graph())
        except Exception as e:
            logger.error("MAS rebuild after skills refresh failed: %s", e)

    out: dict[str, Any] = {
        "status": "ok",
        "message": "Skills cache invalidated; supervisor graph rebuilt."
        if rebuilt
        else "Skills cache invalidated; supervisor rebuild skipped or failed (MAS not registered).",
        "supervisor_rebuilt": rebuilt,
    }
    if mas is not None:
        out["graph_generation"] = getattr(mas, "_graph_generation", None)
        if hasattr(mas, "get_skills_status"):
            out["skills_loaded_count"] = mas.get_skills_status().get("skills_loaded_count")
        else:
            out["skills_loaded_count"] = getattr(mas, "_skills_loaded_count", None)
    return out


@router.get("/internal/supervisor/skills-status")
async def supervisor_skills_status() -> dict[str, Any]:
    """Operator-visible skills load metadata (FR-016).

    No auth required — returns only non-sensitive operational metadata.
    Access is restricted by network (internal path prefix convention).
    """
    from ai_platform_engineering.skills_middleware.mas_registry import get_mas_instance

    mas = get_mas_instance()
    if mas is None or not hasattr(mas, "get_skills_status"):
        return {
            "graph_generation": None,
            "skills_loaded_count": None,
            "skills_merged_at": None,
            "catalog_cache_generation": None,
            "last_built_catalog_generation": None,
            "sync_status": "unknown",
            "mas_registered": False,
        }
    status = mas.get_skills_status()
    status["mas_registered"] = True
    return status


class CatalogApiKeyMintResponse(BaseModel):
    """One-time response after minting a catalog API key."""

    key: str = Field(..., description="Full raw key key_id.secret; store securely; shown once.")
    key_id: str


@router.post("/catalog-api-keys", response_model=CatalogApiKeyMintResponse)
async def mint_catalog_api_key(
    auth: CatalogAuthContext = Depends(get_catalog_auth_key_mgmt),
) -> CatalogApiKeyMintResponse:
    """Mint a catalog read API key for the authenticated principal (T050)."""
    from ai_platform_engineering.skills_middleware.api_keys_store import create_catalog_api_key

    owner = _catalog_api_key_owner(auth)
    try:
        full_key, key_id = create_catalog_api_key(owner, scopes=["catalog:read"])
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    return CatalogApiKeyMintResponse(key=full_key, key_id=key_id)


@router.get("/catalog-api-keys")
async def list_catalog_api_keys(
    auth: CatalogAuthContext = Depends(get_catalog_auth_key_mgmt),
) -> dict[str, Any]:
    """List catalog API keys for the current principal (metadata only)."""
    from ai_platform_engineering.skills_middleware.api_keys_store import list_catalog_api_keys

    owner = _catalog_api_key_owner(auth)
    keys = list_catalog_api_keys(owner)
    return {"keys": keys}


@router.delete("/catalog-api-keys/{key_id}")
async def delete_catalog_api_key(
    key_id: str,
    auth: CatalogAuthContext = Depends(get_catalog_auth_key_mgmt),
) -> dict[str, Any]:
    """Revoke a catalog API key owned by the current principal."""
    from ai_platform_engineering.skills_middleware.api_keys_store import (
        get_catalog_api_key_owner_if_active,
        revoke_catalog_api_key,
    )

    owner = _catalog_api_key_owner(auth)
    row_owner = get_catalog_api_key_owner_if_active(key_id)
    if row_owner is None:
        raise HTTPException(status_code=404, detail="Key not found")
    if row_owner != owner:
        raise HTTPException(status_code=403, detail="Forbidden")
    ok = revoke_catalog_api_key(key_id)
    return {"revoked": ok}


@router.post("/skill-hubs/crawl")
async def skill_hub_crawl(
    body: SkillHubCrawlBody,
    _auth: CatalogAuthContext = Depends(get_catalog_auth),
) -> dict[str, Any]:
    """Preview SKILL.md paths for a GitHub repo without registering a hub (FR-017)."""
    from ai_platform_engineering.skills_middleware.loaders.hub_github import (
        preview_github_hub_skills,
    )

    if body.type.lower() != "github":
        raise HTTPException(
            status_code=400,
            detail={"error": "unsupported_type", "message": f"Crawl not supported for type: {body.type}"},
        )
    result = preview_github_hub_skills(
        body.location.strip(),
        body.credentials_ref,
        max_paths=200,
    )
    err = result.get("error")
    if err == "invalid_location":
        raise HTTPException(
            status_code=400,
            detail={"error": "invalid_location", "message": "Expected owner/repo location."},
        )
    if err:
        raise HTTPException(
            status_code=502,
            detail={"error": "crawl_failed", "message": err},
        )
    return result


class ScanContentBody(BaseModel):
    """Request body for scanning a single skill's content (FR-027)."""

    name: str = Field(..., min_length=1, max_length=256, description="Skill name for temp tree.")
    content: str = Field(..., min_length=1, description="Raw SKILL.md body to scan.")
    config_id: str | None = Field(default=None, description="Agent-config id for findings linkage.")


@router.post("/skills/scan-content")
async def scan_skill_content(
    body: ScanContentBody,
    _auth: CatalogAuthContext = Depends(get_catalog_auth),
) -> dict[str, Any]:
    """Scan a single skill body synchronously and return pass/block result (FR-027)."""
    import shutil

    from ai_platform_engineering.skills_middleware.skill_scanner_runner import (
        run_scan_all_on_directory,
        severity_meets_threshold,
        write_single_skill_to_temp_tree,
    )
    from ai_platform_engineering.skills_middleware.hub_skill_scan import _persist_scan_run

    from ai_platform_engineering.skills_middleware.scan_gate import get_scan_gate
    gate = get_scan_gate()
    fail_on = (os.getenv("SKILL_SCANNER_FAIL_ON") or "").strip().lower()
    if gate == "strict" and not fail_on:
        fail_on = "high"

    tmp_root = None
    try:
        tmp_root = write_single_skill_to_temp_tree(body.name.strip(), body.content)
        result = run_scan_all_on_directory(tmp_root)
    except Exception as e:
        logger.warning("scan-content failed for %s: %s", body.name, e)
        return {
            "passed": True,
            "blocked": False,
            "scan_status": "unscanned",
            "max_severity": None,
            "exit_code": None,
            "summary": "Scanner error occurred",
        }
    finally:
        if tmp_root and tmp_root.exists():
            shutil.rmtree(tmp_root, ignore_errors=True)

    if result.get("skipped"):
        return {
            "passed": True,
            "blocked": False,
            "scan_status": "unscanned",
            "max_severity": None,
            "exit_code": None,
            "summary": "skill-scanner not available",
        }

    blocked = False
    if result.get("exit_code") not in (0, None):
        if gate == "strict" and fail_on:
            blocked = severity_meets_threshold(result.get("max_severity"), fail_on)
        elif gate == "strict":
            blocked = True

    scan_status = "flagged" if blocked else "passed"

    _persist_scan_run(
        body.config_id or body.name,
        result,
        blocked=blocked,
        source_type="agent_skills",
        source_id=body.config_id,
    )

    return {
        "passed": not blocked,
        "blocked": blocked,
        "scan_status": scan_status,
        "max_severity": result.get("max_severity"),
        "exit_code": result.get("exit_code"),
        "summary": (result.get("stdout") or "")[:4000],
    }

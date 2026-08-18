"""Shared service and administrator transport authentication."""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header, HTTPException

from ai_platform_engineering.authz.config import Settings


def admin_dependency(settings: Settings):
    async def require_admin(
        authorization: Annotated[str | None, Header()] = None,
    ) -> str:
        token = (
            authorization[7:].strip()
            if authorization and authorization.lower().startswith("bearer ")
            else ""
        )
        if not settings.admin_token or not hmac.compare_digest(token, settings.admin_token):
            raise HTTPException(status_code=403, detail="admin authorization required")
        return "service_account:caipe-authz-admin"

    return require_admin

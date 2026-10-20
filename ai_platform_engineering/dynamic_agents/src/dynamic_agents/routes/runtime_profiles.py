"""Authenticated discovery of operator-admitted sandbox execution profiles."""

from fastapi import APIRouter, Depends, HTTPException

from dynamic_agents.auth.auth import get_user_context
from dynamic_agents.config import get_settings
from dynamic_agents.models import MANAGED_AGENT_RUNTIME, PRIVATE_CODING_SANDBOX_RUNTIME, UserContext
from dynamic_agents.services.sandbox_client import SandboxClient, SandboxError

router = APIRouter(prefix="/runtime-profiles", tags=["agents"])


def _runtime_options(private_available: bool) -> list[dict]:
    return [
        {"kind": "native", "name": "Managed Agent", "status": "supported", "selectable": True,
         "runtime_contract": MANAGED_AGENT_RUNTIME.model_dump()},
        {"kind": "sandbox", "name": "Private Coding Sandbox", "status": "supported", "selectable": private_available,
         "runtime_contract": PRIVATE_CODING_SANDBOX_RUNTIME.model_dump()},
    ]


@router.get("")
async def runtime_profiles(_user: UserContext = Depends(get_user_context)) -> dict:
    settings = get_settings()
    if not settings.sandbox_service_url:
        return {"profiles": [], "runtimes": _runtime_options(False)}
    try:
        profiles = await SandboxClient(settings).profiles()
    except SandboxError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    admitted = [{
        **profile.model_dump(), "runtime_contract": PRIVATE_CODING_SANDBOX_RUNTIME.model_dump(), "capabilities": {
            "mcp": profile.capabilities.get("mcp", False) and bool(settings.harness_tools_public_url),
            "skills": profile.capabilities.get("skills", False),
            "attachments": profile.capabilities.get("attachments", False),
        },
    } for profile in profiles if profile.capabilities.get("mcp", False) and settings.harness_tools_public_url]
    return {"profiles": admitted, "runtimes": _runtime_options(bool(admitted))}

"""Sandbox policy management endpoints for Dynamic Agents.

Provides REST endpoints for reading, updating, and managing OpenShell
sandbox policies. Supports the "Allow Once" / "Always Allow" workflow
for policy denials streamed to the UI.
"""

import asyncio
import json
import logging
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from dynamic_agents.auth.access import can_use_agent
from dynamic_agents.auth.auth import get_current_user
from dynamic_agents.models import UserContext
from dynamic_agents.services.mongo import MongoDBService, get_mongo_service
from dynamic_agents.services.sandbox import get_sandbox_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


class PolicyUpdateRequest(BaseModel):
    """Request body for full policy replacement."""

    policy_yaml: str = Field(..., description="Complete policy YAML to apply")


class AllowRuleRequest(BaseModel):
    """Request body for adding a network allow rule."""

    host: str = Field(..., description="Hostname to allow (e.g., 'api.github.com')")
    port: int = Field(443, description="Port number")
    binary: str | None = Field(None, description="Optional binary path to scope the rule")
    temporary: bool = Field(False, description="If true, rule is marked for session cleanup")


class RemoveRuleRequest(BaseModel):
    """Request body for removing a rule."""

    rule_id: str = Field(..., description="Rule key to remove from the policy")


def _get_sandbox_name(agent_id: str, agent: Any) -> str:
    """Derive the sandbox name for an agent."""
    if agent.sandbox and agent.sandbox.sandbox_name:
        return agent.sandbox.sandbox_name
    return f"da-{agent_id}"


@router.get("/policy/{agent_id}")
async def get_sandbox_policy(
    agent_id: str,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Get the current sandbox policy YAML for an agent."""
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        raise HTTPException(status_code=400, detail="Sandbox not enabled for this agent")

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()
    policy = mgr.get_policy(sandbox_name)

    from dynamic_agents.services.sandbox_policy import serialize_policy

    return {
        "success": True,
        "sandbox_name": sandbox_name,
        "policy": policy,
        "policy_yaml": serialize_policy(policy) if policy else "",
    }


@router.put("/policy/{agent_id}")
async def update_sandbox_policy(
    agent_id: str,
    body: PolicyUpdateRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Update sandbox policy with hot reload.

    Replaces the full policy YAML and hot-reloads it in the sandbox.
    """
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        raise HTTPException(status_code=400, detail="Sandbox not enabled for this agent")

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()

    import yaml
    try:
        policy = yaml.safe_load(body.policy_yaml)
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}")

    result = mgr.update_policy(sandbox_name, policy)
    logger.info(f"Policy updated for agent {agent_id} sandbox {sandbox_name}: {result.get('status')}")

    if result.get("status") == "loaded":
        mgr.push_policy_update(sandbox_name, "loaded")

    return {"success": result.get("status") == "loaded", **result}


@router.post("/policy/{agent_id}/allow-rule")
async def add_allow_rule(
    agent_id: str,
    body: AllowRuleRequest,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Add a network allow rule to the sandbox policy.

    Used by the UI's "Allow Once" / "Always Allow" buttons when a
    sandbox denial event is shown. The rule is applied with hot reload.
    """
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        raise HTTPException(status_code=400, detail="Sandbox not enabled for this agent")

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()

    result = mgr.add_allow_rule(
        sandbox_name,
        host=body.host,
        port=body.port,
        binary=body.binary,
        temporary=body.temporary,
    )

    logger.info(
        f"Allow rule added for agent {agent_id}: host={body.host}:{body.port} "
        f"temporary={body.temporary} result={result.get('status')}"
    )

    if result.get("status") == "loaded":
        mgr.push_policy_update(sandbox_name, "loaded", rule_id=result.get("rule_id"))

    return {"success": result.get("status") == "loaded", **result}


@router.delete("/policy/{agent_id}/rule/{rule_id}")
async def remove_rule(
    agent_id: str,
    rule_id: str,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Remove a rule from the sandbox policy.

    Removes the specified rule and hot-reloads the policy.
    """
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        raise HTTPException(status_code=400, detail="Sandbox not enabled for this agent")

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()

    result = mgr.remove_rule(sandbox_name, rule_id)
    logger.info(f"Rule {rule_id} removed for agent {agent_id}: {result.get('status')}")

    if result.get("status") == "loaded":
        mgr.push_policy_update(sandbox_name, "loaded", rule_id=rule_id)

    return {"success": result.get("status") == "loaded", **result}


@router.get("/status/{agent_id}")
async def get_sandbox_status(
    agent_id: str,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> dict:
    """Get sandbox health and policy status."""
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        return {"success": True, "sandbox_enabled": False}

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()
    status = mgr.get_sandbox_status(sandbox_name)

    return {"success": True, "sandbox_enabled": True, **status}


@router.get("/events/{agent_id}")
async def sandbox_event_stream(
    agent_id: str,
    user: UserContext = Depends(get_current_user),
    mongo: MongoDBService = Depends(get_mongo_service),
) -> StreamingResponse:
    """SSE stream of sandbox denial and policy update events for an agent.

    Connects to the sandbox manager's denial queue and yields events
    as they arrive. The client should use EventSource to consume this.
    """
    agent = mongo.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    if not can_use_agent(agent, user):
        raise HTTPException(status_code=403, detail="Access denied")

    if not agent.sandbox or not agent.sandbox.enabled:
        raise HTTPException(status_code=400, detail="Sandbox not enabled for this agent")

    sandbox_name = _get_sandbox_name(agent_id, agent)
    mgr = get_sandbox_manager()

    await mgr.start_watch(sandbox_name)

    sub = mgr.subscribe(sandbox_name)

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(sub.get(), timeout=30.0)
                    event_type = event.pop("_type", "sandbox_denial")
                    yield f"event: {event_type}\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                except asyncio.CancelledError:
                    break
        finally:
            mgr.unsubscribe(sandbox_name, sub)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

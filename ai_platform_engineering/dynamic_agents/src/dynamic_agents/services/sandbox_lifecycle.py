"""Destructive external-session cleanup under canonical native admission."""

from __future__ import annotations

import hashlib

from pydantic import ValidationError

from dynamic_agents.auth.authz import current_subject_reference
from dynamic_agents.config import Settings
from dynamic_agents.services.mongo import MongoDBService
from dynamic_agents.services.sandbox_client import SandboxAllocation, SandboxClient, SandboxError, SandboxProfile
from dynamic_agents.services.session_bindings import get_sandbox_binding, reset_sandbox_binding
from dynamic_agents.services.session_runs import await_session_operation


async def clear_sandbox_session(mongo: MongoDBService, agent_id: str, session_id: str, settings: Settings) -> bool:
    """Delete the pinned environment before resetting its durable reference.

    Do not require the profile catalog to remain enabled: explicit cleanup must
    still work after profile retirement. The portal independently authorizes the
    same caller and checks the current allocation UID and resource version.
    """
    state = await await_session_operation(get_sandbox_binding, mongo, agent_id, session_id)
    if state is None:
        return False
    client = SandboxClient(settings)
    if state.get("owner_subject") != current_subject_reference():
        raise SandboxError("Only the sandbox's original caller can delete its environment")
    if state.get("connection_version") != hashlib.sha256(client.base.encode()).hexdigest():
        raise SandboxError("The sandbox control-plane binding changed; cleanup requires operator recovery")
    try:
        profile = SandboxProfile.model_validate(state["profile"])
        allocation = SandboxAllocation.model_validate(state["allocation"]) if state.get("allocation") is not None else None
    except (KeyError, TypeError, ValidationError):
        raise SandboxError("The saved sandbox cleanup binding is invalid") from None
    if allocation is None:
        # A provision request may have succeeded before its caller lost the
        # response. Lookup is owner-bound and never provisions during cleanup.
        allocation = await client.lookup(agent_id, session_id, profile)
    if allocation is not None and allocation.conversation_id != client.conversation_reference(agent_id, session_id):
        raise SandboxError("The saved sandbox conversation binding changed")
    if allocation is not None and (allocation.profile_id, allocation.revision) != (profile.id, profile.revision):
        raise SandboxError("The saved sandbox profile binding changed")
    if allocation is not None:
        await client.delete(allocation, profile)
    await await_session_operation(reset_sandbox_binding, mongo, agent_id, session_id, state)
    return True

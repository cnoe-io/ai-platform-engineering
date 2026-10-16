"""A sandbox placement of the same admitted CAIPE execution lifecycle."""

from __future__ import annotations

import hashlib
from collections.abc import AsyncGenerator, Callable
from contextlib import aclosing, asynccontextmanager
from dataclasses import dataclass
from typing import Any

from dynamic_agents.config import Settings
from dynamic_agents.models import DynamicAgentConfig, InputFile
from dynamic_agents.services.harness_acp import HarnessACPDriver
from dynamic_agents.services.harness_inputs import HarnessInputs
from dynamic_agents.services.harness_workspace import HarnessWorkspaceBridge
from dynamic_agents.services.mongo import MongoDBService
from dynamic_agents.services.native_run_coordinator import current_native_execution_run
from dynamic_agents.services.native_run_repository import NativeRunRepository
from dynamic_agents.services.sandbox_client import SandboxAllocation, SandboxClient, SandboxError, SandboxProfile
from dynamic_agents.services.session_bindings import get_sandbox_binding, save_sandbox_binding
from dynamic_agents.services.session_runs import await_session_operation
from dynamic_agents.services.stream_encoders import StreamEncoder
from dynamic_agents.services.stream_encoders.events import RunFinished, WarningEvent
from dynamic_agents.services.stream_encoders.semantic import SemanticStreamEncoder


@dataclass
class SandboxRuntime:
    driver: HarnessACPDriver
    run_id: str
    workspace: HarnessWorkspaceBridge
    attachments: bool

    async def dispatch(self, message: str, encoder: StreamEncoder[str], files: list[InputFile] | None) -> AsyncGenerator[str, None]:
        if files and not self.attachments:
            raise SandboxError("The sandbox profile has not qualified attachments")
        # Keep semantics typed through artifact publication. Formatting UI SSE
        # is the final step, just as at the shared native ACP boundary.
        semantic = SemanticStreamEncoder()
        async with aclosing(self.driver.stream(message, semantic, run_id=self.run_id, files=files)) as events:
            async for event in events:
                if isinstance(event, RunFinished):
                    for warning in await self.workspace.publish():
                        for frame in encoder.encode_event(WarningEvent(message=warning)):
                            yield frame
                for frame in encoder.encode_event(event):
                    yield frame


def _workspace_files(prompt: str, skills_files: dict[str, Any], harness: str) -> dict[str, str]:
    files = {"AGENTS.md": prompt, "CLAUDE.md": prompt}
    root = ".claude/skills/" if harness == "claude-code" else ".agents/skills/"
    for path, value in skills_files.items():
        if not path.startswith("/skills/"):
            raise SandboxError("A skill file is outside its approved skill directory")
        relative = path.removeprefix("/skills/")
        if any(part in {"", ".", ".."} for part in relative.split("/")) or "\\" in relative or "\x00" in relative:
            raise SandboxError("A skill file path is invalid")
        content = value.get("content", "") if isinstance(value, dict) else value
        if isinstance(content, list):
            content = "\n".join(content)
        if not isinstance(content, str):
            raise SandboxError("A skill file has an unsupported content type")
        files[root + relative] = content
    return files


def _session_options(agent: DynamicAgentConfig, prompt: str, profile: SandboxProfile) -> dict:
    if profile.harness != "claude-code":
        return {}
    options: dict[str, Any] = {
        "systemPrompt": prompt, "settingSources": ["project"], "allowDangerouslySkipPermissions": False,
    }
    # Preserve the configured execution bound using the harness's own loop.
    # Native model retry/compaction internals remain owned by each harness.
    for item in agent.features.middleware if agent.features else []:
        if item.type == "model_call_limit" and item.enabled:
            limit = item.params.get("run_limit")
            if type(limit) is int and limit > 0:
                options["maxTurns"] = limit
    return {"claudeCode": {"options": options}}


@asynccontextmanager
async def sandbox_runtime(
    mongo: MongoDBService, agent: DynamicAgentConfig, session_id: str, settings: Settings,
    *, system_prompt: str, skills_files: dict[str, Any], mcp_servers: list[Any],
    bind_driver: Callable[[HarnessACPDriver], None],
    bind_workspace: Callable[[HarnessWorkspaceBridge], None],
) -> AsyncGenerator[SandboxRuntime, None]:
    run = current_native_execution_run.get()
    if run is None:
        raise SandboxError("Sandbox execution requires a durable admitted CAIPE run")
    client = SandboxClient(settings)
    connection_version = hashlib.sha256(client.base.encode()).hexdigest()
    saved = await await_session_operation(get_sandbox_binding, mongo, agent.id, session_id)
    profiles = await client.profiles()
    profile = next((item for item in profiles if item.id == agent.execution.profile_id), None)
    if profile is None:
        raise SandboxError("The sandbox execution profile is unavailable; choose an admitted profile in a new conversation")
    if not profile.capabilities.get("mcp", False):
        raise SandboxError("The sandbox profile has not qualified CAIPE platform tool access")
    if skills_files and not profile.capabilities.get("skills", False):
        raise SandboxError("The sandbox profile has not qualified the agent's configured skills")
    if saved is not None:
        if saved.get("owner_subject") != run.owner_subject or saved.get("connection_version") != connection_version:
            raise SandboxError("This sandbox is bound to its original caller and connection")
        if saved.get("profile") != profile.model_dump():
            raise SandboxError("The admitted sandbox profile changed; explicit migration or a new conversation is required")
    state = dict(saved) if saved is not None else {
        "owner_subject": run.owner_subject, "connection_version": connection_version,
        "profile": profile.model_dump(), "allocation": None, "provider_session_id": None,
    }
    # Persist intent before remote provisioning: explicit cleanup can look up
    # the deterministic allocation even if this worker loses the POST reply.
    await await_session_operation(save_sandbox_binding, mongo, agent.id, session_id, state)
    if state["allocation"] is None:
        allocation = await client.provision(agent.id, session_id, profile)
        state["allocation"] = allocation.model_dump()
    else:
        allocation = await client.restore(SandboxAllocation.model_validate(state["allocation"]), profile)
    existing_session_id = state.get("provider_session_id")
    # Runtime readiness is operational, not part of immutable identity. Keep
    # the first saved allocation bytes rather than replacing them on load.
    await await_session_operation(save_sandbox_binding, mongo, agent.id, session_id, state)
    workspace = HarnessWorkspaceBridge(mongo, agent, session_id, client, allocation)
    inputs_files = await workspace.seed_inputs()
    workspace_prompt = system_prompt + (
        "\n\nWorkspace files: your real filesystem is rooted at the approved working directory. "
        "Existing CAIPE logical files are copied under inputs/ with their relative paths retained. "
        "For example, logical /reports/input.txt is available as inputs/reports/input.txt. "
        "Write new output files using workspace-relative paths. Approved UTF-8 outputs are "
        "published to CAIPE when the turn finishes. Do not place credentials in output files."
    )
    files = _workspace_files(workspace_prompt, skills_files, profile.harness)
    files.update(inputs_files)
    await client.prepare(allocation, files)
    bind_workspace(workspace)
    inputs = HarnessInputs(NativeRunRepository(mongo))

    async def persist_session(provider_session_id: str) -> None:
        state["provider_session_id"] = provider_session_id
        await await_session_operation(save_sandbox_binding, mongo, agent.id, session_id, state)

    async with client.acp(allocation) as transport:
        driver = HarnessACPDriver(
            transport, agent_name=agent.name, canonical_session_id=session_id,
            persist_session=persist_session, persist_input=lambda pending: inputs.persist(run.run_id, pending),
            wait_for_decision=lambda pending: inputs.wait(run.run_id, pending),
        )
        bind_driver(driver)
        try:
            await driver.open(allocation.cwd, mcp_servers=mcp_servers, existing_session_id=existing_session_id,
                              session_meta=_session_options(agent, workspace_prompt, profile))
            if not driver.capabilities.get("loadSession"):
                raise SandboxError("The sandbox harness must support loading its durable native session")
            yield SandboxRuntime(driver, run.run_id, workspace, profile.capabilities.get("attachments", False))
        finally:
            await driver.close()

"""Qualified sandbox placement through the real canonical execution service.

The remote portal/agent are deterministic peers. An empty tool selection avoids
external services while shared prompt/skill preparation reads isolated Mongo.
The HTTP client, ACP driver, bindings, admission, durable pump and cross-replica
replay execute production code. Native compatibility uses the existing real
checkpoint test graph, without constructing or contacting a model.
"""

from __future__ import annotations

import asyncio
import json
import os
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from langchain_core.messages import HumanMessage

from dynamic_agents.auth.token_context import current_user_token
from dynamic_agents.models import AgentExecutionConfig, DynamicAgentConfig, ModelConfig
from dynamic_agents.services import agent_execution, agent_runtime, sandbox_client
from dynamic_agents.services.agent_execution import AgentExecutionService, ExecutionTurn
from dynamic_agents.services.harness_inputs import HarnessInputs
from dynamic_agents.services.mongo import MongoDBService
from dynamic_agents.services.session_bindings import get_native_binding, get_sandbox_binding
from tests.test_harness_acp import HarnessPeer
from tests.test_native_acp_mongodb import (
    _graph,
    _ReconstructedRuntimeCache,
)
from tests.test_native_acp_mongodb import (
    native_database as native_database,
)

HUMAN_BEARER = "fixture-human-bearer-kept-out-of-agent"


class ProviderPeer(HarnessPeer):
    def __init__(self, portal: PortalPeer, *, load_error: bool = False) -> None:
        super().__init__(load_error=load_error, interaction=portal.interaction)
        self.portal = portal
        self.prompt_seen = asyncio.Event()
        self.continue_prompt = asyncio.Event()

    async def send(self, message):
        method = message.get("method")
        if method == "session/prompt":
            # The provider reference is an immutable canonical binding before
            # the agent can cause its first tool side effect.
            saved = get_sandbox_binding(self.portal.state.mongo, self.portal.state.agent.id, self.portal.state.session_id)
            assert saved["provider_session_id"] == message["params"]["sessionId"] == "provider-session"
            assert self.portal.prepared
            self.prompt_seen.set()
        if method == "session/load" and not self.load_error:
            await self._update({"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "HISTORICAL_REPLAY"}})
        await super().send(message)

    async def _prompt(self, request_id):
        if self.portal.hold:
            try:
                await self._update({"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "Preparing the request"}})
                await self.continue_prompt.wait()
            except asyncio.CancelledError:
                await self.inbox.put({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "cancelled"}})
                return
        await super()._prompt(request_id)


class ProviderWebSocket:
    def __init__(self, peer):
        self.peer = peer

    async def send(self, raw):
        assert isinstance(raw, str) and raw.endswith("\n")
        await self.peer.send(json.loads(raw))

    async def recv(self):
        value = await self.peer.receive()
        if value is None:
            raise OSError("The fixture provider connection closed")
        return json.dumps(value) + "\n"

    async def close(self):
        await self.peer.close()


class PortalPeer:
    def __init__(self, state, harness="codex"):
        self.state = state
        self.profile = {"id": "qualified-profile", "name": "Qualified provider", "harness": harness,
            "revision": "fixture-revision-1", "capabilities": {"mcp": True, "skills": True, "attachments": True}}
        self.allocation = None
        self.requests = []
        self.prepared = []
        self.peers = []
        self.hold = False
        self.fail_next_load = False
        self.interaction = None
        self.fail_provision = False

    def http(self, request):
        assert request.headers["Authorization"] == f"Bearer {HUMAN_BEARER}"
        payload = json.loads(request.content) if request.content else None
        self.requests.append((request.method, request.url.path, payload))
        if request.method == "GET" and request.url.path.endswith("/api/caipe/profiles"):
            return httpx.Response(200, json={"profiles": [self.profile]})
        if request.method == "POST" and request.url.path.endswith("/api/caipe/sandboxes"):
            assert set(payload) == {"conversation_id", "profile_id", "revision"}
            intent = get_sandbox_binding(self.state.mongo, self.state.agent.id, self.state.session_id)
            assert intent["allocation"] is None and intent["provider_session_id"] is None
            assert intent["profile"]["id"] == payload["profile_id"] and intent["profile"]["revision"] == payload["revision"]
            assert intent["owner_subject"] == f"email:{self.state.user.email}"
            if self.fail_provision:
                return httpx.Response(503, json={"error": "Provisioning reply lost"})
            self.allocation = {"id": "fixture-sandbox", "uid": "fixture-generation", "namespace": "fixture-namespace",
                "conversation_id": payload["conversation_id"], "profile_id": payload["profile_id"], "revision": payload["revision"],
                "cwd": "/home/fixture/workspace", "state": "Running", "resource_version": "1"}
            return httpx.Response(201, json=self.allocation)
        if request.method == "GET" and request.url.path.endswith("/api/caipe/sandboxes/fixture-sandbox"):
            return httpx.Response(200, json=self.allocation)
        if request.method == "PUT" and request.url.path.endswith("/api/caipe/sandboxes/fixture-sandbox/workspace"):
            assert payload["uid"] == self.allocation["uid"]
            assert payload["conversation_id"] == self.allocation["conversation_id"]
            self.prepared.append(payload["files"])
            return httpx.Response(200, json={"status": "prepared"})
        if request.method == "GET" and request.url.path.endswith("/api/caipe/sandboxes/fixture-sandbox/workspace/files"):
            return httpx.Response(200, json={"files": [], "truncated": False})
        raise AssertionError(f"Unexpected fixture portal request: {request.method} {request.url.path}")

    def connection(self, url, **options):
        portal = self
        assert url.startswith("wss://portal.example.test/control/api/caipe/sandboxes/fixture-sandbox/acp?")
        assert options["additional_headers"] == {"Authorization": f"Bearer {HUMAN_BEARER}"}

        class Connection:
            async def __aenter__(self):
                self.peer = ProviderPeer(portal, load_error=portal.fail_next_load)
                portal.fail_next_load = False
                portal.peers.append(self.peer)
                return ProviderWebSocket(self.peer)

            async def __aexit__(self, *_args):
                await self.peer.close()

        return Connection()


class NativeReplicaCache(_ReconstructedRuntimeCache):
    def set_mongo_service(self, mongo):
        assert mongo._client is self.state.client and mongo._db.name == self.state.db.name


@pytest.fixture
async def sandbox_database(native_database, monkeypatch):
    state = native_database
    state.session_id = str(uuid4())
    state.agent = DynamicAgentConfig(_id="example-agent", name="Qualified agent", owner_id="owner@example.com",
        system_prompt="Approved platform instructions", skills=["qualified"],
        execution=AgentExecutionConfig(kind="sandbox", profile_id="qualified-profile"))
    state.settings.mongodb_uri = os.environ["NATIVE_ACP_TEST_MONGODB_URI"]
    monkeypatch.setenv("MONGODB_DATABASE", state.db.name)
    monkeypatch.setenv("SKILL_SCANNER_GATE", "warn")
    state.db["agent_skills"].insert_one({"_id": "qualified", "id": "qualified", "name": "qualified",
        "description": "Approved fixture skill", "skill_content": "Approved skill content", "scan_status": "clean"})
    state.settings.sandbox_service_url = "https://portal.example.test/control"
    state.settings.harness_tools_public_url = "https://caipe.example.test/api/v1/harness-tools"
    portal = PortalPeer(state)
    state.portal = portal
    state.replicas = [state.mongo]
    original_client = httpx.AsyncClient

    def http_client(**options):
        return original_client(**options, transport=httpx.MockTransport(portal.http))

    def forbidden_model(*_args, **_kwargs):
        pytest.fail("Service placement qualification must not construct or contact a model")

    monkeypatch.setattr(sandbox_client.httpx, "AsyncClient", http_client)
    monkeypatch.setattr(sandbox_client, "_BoundConnection", portal.connection)
    monkeypatch.setattr(agent_runtime, "get_llm", forbidden_model)
    # This service fixture admits a fixed caller; JWT/CAS denial is tested separately.
    monkeypatch.setattr(agent_execution, "require_agent_use_permission", AsyncMock())
    token = current_user_token.set(HUMAN_BEARER)
    try:
        yield state
    finally:
        for mongo in state.replicas:
            coordinator = getattr(mongo, "_native_run_coordinator", None)
            if coordinator is not None:
                await coordinator.shutdown()
        current_user_token.reset(token)


def _service(state, *, replica=False, cache=None):
    mongo = state.mongo
    if replica:
        mongo = MongoDBService(state.settings)
        mongo._client, mongo._db = state.client, state.db
        state.replicas.append(mongo)
    return AgentExecutionService(mongo, settings=state.settings, cache=cache)


def _turn(state, turn_id, message="Investigate the selected resource"):
    return ExecutionTurn(agent=state.agent, session_id=state.session_id, user=state.user, message=message, turn_id=turn_id)


async def _collect(service, run):
    async with asyncio.timeout(10):
        frames = [frame async for frame in service.run_events(run, run.first_sequence)]
    final = await service.coordinator.repository.get(run.run_id, owner_subject=run.owner_subject)
    return final, frames


@pytest.mark.parametrize("harness", ["codex", "claude-code"])
async def test_service_provisions_prepares_and_persists_native_reference_before_first_prompt(sandbox_database, harness):
    state = sandbox_database
    state.portal.profile["harness"] = harness
    service = _service(state)
    run = await service.start_run(_turn(state, "first-turn"), "custom")
    final, frames = await _collect(service, run)
    assert final.status == "completed"
    assert any("Result" in frame for frame in frames)
    assert final.lease_id and not state.mongo.get_session_runs_collection().find_one({"session_id": state.session_id})
    saved = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    assert saved["provider_session_id"] == "provider-session"
    assert saved["allocation"]["uid"] == "fixture-generation"
    assert saved["owner_subject"] == f"email:{state.user.email}"
    assert state.portal.prepared[0]["AGENTS.md"].startswith(state.agent.system_prompt)
    assert "inputs/" in state.portal.prepared[0]["AGENTS.md"]
    root = ".claude" if harness == "claude-code" else ".agents"
    assert "Approved skill content" in state.portal.prepared[0][f"{root}/skills/agent-skills/qualified/SKILL.md"]
    messages = state.portal.peers[0].sent
    assert [message.get("method") for message in messages][:3] == ["initialize", "session/new", "session/prompt"]
    assert HUMAN_BEARER not in json.dumps(messages)
    if harness == "claude-code":
        options = messages[1]["params"]["_meta"]["claudeCode"]["options"]
        assert options["systemPrompt"] == state.portal.prepared[0]["AGENTS.md"]
        assert options["allowDangerouslySkipPermissions"] is False
    assert state.portal.peers[0].closed


async def test_second_replica_loads_exact_provider_session_and_does_not_replay_history(sandbox_database):
    state = sandbox_database
    first = _service(state)
    run = await first.start_run(_turn(state, "first-turn"), "custom")
    assert (await _collect(first, run))[0].status == "completed"
    before = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    await first.coordinator.shutdown()
    second = _service(state, replica=True)
    run = await second.start_run(_turn(state, "second-turn"), "custom")
    final, frames = await _collect(second, run)
    assert final.status == "completed"
    assert not any("HISTORICAL_REPLAY" in frame for frame in frames)
    methods = [message.get("method") for message in state.portal.peers[1].sent]
    assert methods[:3] == ["initialize", "session/load", "session/prompt"]
    assert "session/new" not in methods
    assert get_sandbox_binding(state.mongo, state.agent.id, state.session_id) == before
    assert sum(method == "POST" for method, _, _ in state.portal.requests) == 1


async def test_failed_provision_reply_retains_durable_intent_before_remote_side_effect(sandbox_database):
    state = sandbox_database
    state.portal.fail_provision = True
    service = _service(state)
    run = await service.start_run(_turn(state, "lost-provision-reply"), "custom")
    final, _ = await _collect(service, run)
    assert final.status == "failed"
    intent = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    assert intent["allocation"] is None and intent["provider_session_id"] is None
    assert intent["profile"]["id"] == "qualified-profile"
    assert intent["owner_subject"] == f"email:{state.user.email}"
    assert not state.portal.prepared and not state.portal.peers
    assert state.mongo.get_session_runs_collection().find_one({"session_id": state.session_id}) is None


@pytest.mark.parametrize("capability", ["mcp", "skills"])
async def test_unqualified_platform_resource_capability_fails_before_provisioning(sandbox_database, capability):
    state = sandbox_database
    state.portal.profile["capabilities"][capability] = False
    service = _service(state)
    run = await service.start_run(_turn(state, "unqualified-profile"), "custom")
    final, _ = await _collect(service, run)
    assert final.status == "failed"
    assert not any(method == "POST" for method, _, _ in state.portal.requests)
    assert not state.portal.peers


async def test_failed_provider_load_never_creates_a_replacement_session(sandbox_database):
    state = sandbox_database
    service = _service(state)
    run = await service.start_run(_turn(state, "first-turn"), "custom")
    assert (await _collect(service, run))[0].status == "completed"
    original = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    state.portal.fail_next_load = True
    replica = _service(state, replica=True)
    run = await replica.start_run(_turn(state, "unavailable-load"), "custom")
    final, _ = await _collect(replica, run)
    assert final.status == "failed"
    methods = [message.get("method") for message in state.portal.peers[-1].sent]
    assert "session/load" in methods and "session/new" not in methods and "session/prompt" not in methods
    assert get_sandbox_binding(state.mongo, state.agent.id, state.session_id) == original


async def test_invoke_retains_durable_result_and_duplicate_turn_does_not_repeat_prompt(sandbox_database):
    state = sandbox_database
    service = _service(state)
    turn = _turn(state, "invoke-once")
    first = await service.invoke(turn)
    second = await _service(state, replica=True).invoke(turn)
    assert first.content == second.content == "Result"
    assert first.interrupt is second.interrupt is None
    assert len(state.portal.peers) == 1
    record = state.db["native_acp_execution_runs"].find_one({"turn_id": "invoke-once"})
    assert record["status"] == "completed" and record["result"]["content"] == "Result"


async def test_cross_replica_stop_cancels_the_provider_and_releases_original_admission(sandbox_database):
    state = sandbox_database
    state.portal.hold = True
    service = _service(state)
    run = await service.start_run(_turn(state, "held-turn"), "custom")
    async with asyncio.timeout(5):
        while not state.portal.peers:
            await asyncio.sleep(0.01)
        await state.portal.peers[0].prompt_seen.wait()
    replica = _service(state, replica=True)
    assert await replica.cancel(state.agent.id, state.session_id, turn_id="held-turn")
    final, _ = await _collect(replica, run)
    assert final.status == "cancelled"
    assert state.portal.peers[0].closed
    assert any(message.get("method") == "session/cancel" for message in state.portal.peers[0].sent)
    assert state.mongo.get_session_runs_collection().find_one({"session_id": state.session_id}) is None
    assert get_sandbox_binding(state.mongo, state.agent.id, state.session_id)["provider_session_id"] == "provider-session"


async def test_subscriber_disconnect_keeps_original_provider_and_other_replica_replays_completion(sandbox_database):
    state = sandbox_database
    state.portal.hold = True
    service = _service(state)
    run = await service.start_run(_turn(state, "detached-turn"), "custom")
    subscription = service.run_events(run)
    async with asyncio.timeout(5):
        first_frame = await anext(subscription)
        while not state.portal.peers:
            await asyncio.sleep(0.01)
        await state.portal.peers[0].prompt_seen.wait()
    assert "id: " in first_frame
    await subscription.aclose()
    assert not state.portal.peers[0].closed
    assert state.mongo.get_session_runs_collection().find_one({"session_id": state.session_id})
    state.portal.peers[0].continue_prompt.set()
    replica = _service(state, replica=True)
    final, frames = await _collect(replica, run)
    assert final.status == "completed" and any("Result" in frame for frame in frames)
    assert len(state.portal.peers) == 1
    assert len([message for message in state.portal.peers[0].sent if message.get("method") == "session/prompt"]) == 1


async def test_service_resume_on_another_replica_continues_the_same_provider_prompt(sandbox_database):
    state = sandbox_database
    state.portal.interaction = "permission"
    service = _service(state)
    run = await service.start_run(_turn(state, "permission-turn"), "custom")
    paused, frames = await _collect(service, run)
    assert paused.status == "awaiting_input" and paused.active
    assert any("input_required" in frame for frame in frames)
    pending = await HarnessInputs(service.coordinator.repository).current(state.agent.id, state.session_id)
    replica = _service(state, replica=True)
    resume = ExecutionTurn(agent=state.agent, session_id=state.session_id, user=state.user, turn_id="actual-human-decision",
        resume_data=json.dumps({"type": "form_input", "interrupt_id": pending["interrupt_id"], "values": {"option_id": "allow-once"}}))
    continued = await replica.start_run(resume, "custom")
    assert continued.run_id == run.run_id and continued.first_sequence == paused.last_sequence
    final, frames = await _collect(replica, continued)
    assert final.status == "completed" and any("Result" in frame for frame in frames)
    assert final.public()["turn_id"] == "actual-human-decision"
    assert len(state.portal.peers) == 1
    assert len([message for message in state.portal.peers[0].sent if message.get("method") == "session/prompt"]) == 1
    assert sum(method == "POST" for method, _, _ in state.portal.requests) == 1


async def test_profile_drift_fails_without_provisioning_or_replacing_provider_history(sandbox_database):
    state = sandbox_database
    service = _service(state)
    run = await service.start_run(_turn(state, "original-profile"), "custom")
    assert (await _collect(service, run))[0].status == "completed"
    original = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    state.portal.profile["revision"] = "fixture-revision-2"
    replica = _service(state, replica=True)
    run = await replica.start_run(_turn(state, "changed-profile"), "custom")
    final, _ = await _collect(replica, run)
    assert final.status == "failed"
    assert len(state.portal.peers) == 1
    assert get_sandbox_binding(state.mongo, state.agent.id, state.session_id) == original
    assert sum(method == "POST" for method, _, _ in state.portal.requests) == 1


async def test_recreated_sandbox_generation_is_not_accepted_as_the_original_native_session(sandbox_database):
    state = sandbox_database
    service = _service(state)
    run = await service.start_run(_turn(state, "original-generation"), "custom")
    assert (await _collect(service, run))[0].status == "completed"
    original = get_sandbox_binding(state.mongo, state.agent.id, state.session_id)
    state.portal.allocation = {**state.portal.allocation, "uid": "replacement-generation"}
    replica = _service(state, replica=True)
    run = await replica.start_run(_turn(state, "recreated-sandbox"), "custom")
    final, _ = await _collect(replica, run)
    assert final.status == "failed"
    assert len(state.portal.peers) == 1
    assert get_sandbox_binding(state.mongo, state.agent.id, state.session_id) == original
    assert sum(method == "POST" for method, _, _ in state.portal.requests) == 1


async def test_existing_native_checkpoint_is_preserved_when_agent_definition_selects_sandbox(sandbox_database):
    state = sandbox_database
    native = state.agent.model_copy(update={"execution": AgentExecutionConfig(), "model": ModelConfig(
        id="example-model", provider="example-provider",
    )})
    graph = _graph(state, native)
    config = {"configurable": {"thread_id": state.session_id}}
    await graph.ainvoke({"messages": [HumanMessage(content="Original native request", id="original-turn")]}, config)
    original = await graph.aget_state(config)
    state.agent = state.agent.model_copy(update={"model": native.model})
    cache = NativeReplicaCache(state)
    service = _service(state, cache=cache)
    run = await service.start_run(_turn(state, "native-followup"), "custom")
    final, frames = await _collect(service, run)
    assert final.status == "completed"
    assert any("Remembered" in frame for frame in frames)
    binding = get_native_binding(state.mongo, state.agent.id, state.session_id)
    assert binding.execution.kind == "native" and binding.model == native.model
    restored = await _graph(state, native).aget_state(config)
    assert [(item.id, item.content) for item in restored.values["messages"][:2]] == [
        (item.id, item.content) for item in original.values["messages"]]
    assert not state.portal.requests and not state.portal.peers


async def test_admitted_native_conversation_retains_its_model_after_current_definition_removes_it(sandbox_database):
    state = sandbox_database
    state.agent = state.agent.model_copy(update={"execution": AgentExecutionConfig(), "model": ModelConfig(
        id="original-native-model", provider="original-native-provider",
    )})
    original_model = state.agent.model
    service = _service(state, cache=NativeReplicaCache(state))
    run = await service.start_run(_turn(state, "native-admission"), "custom")
    assert (await _collect(service, run))[0].status == "completed"
    state.agent = state.agent.model_copy(update={"execution": AgentExecutionConfig(kind="sandbox", profile_id="qualified-profile"), "model": None})
    replica = _service(state, replica=True, cache=NativeReplicaCache(state))
    run = await replica.start_run(_turn(state, "native-after-definition-change"), "custom")
    final, frames = await _collect(replica, run)
    assert final.status == "completed" and any("Remembered" in frame for frame in frames)
    binding = get_native_binding(state.mongo, state.agent.id, state.session_id)
    assert binding.execution.kind == "native" and binding.model == original_model
    assert not state.portal.requests and not state.portal.peers


async def test_parent_use_revocation_fails_before_remote_provisioning(sandbox_database, monkeypatch):
    state = sandbox_database
    denied = AsyncMock(side_effect=HTTPException(403, "Agent use denied"))
    monkeypatch.setattr(agent_execution, "require_agent_use_permission", denied)
    service = _service(state)
    run = await service.start_run(_turn(state, "revoked-agent-use"), "custom")
    completed, _ = await _collect(service, run)
    assert completed.status == "failed"
    assert state.portal.requests == []

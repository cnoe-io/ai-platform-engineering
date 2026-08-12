from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from langchain_core.tools import StructuredTool
from pydantic import BaseModel

from dynamic_agents.models import DynamicAgentConfig
from dynamic_agents.routes.chat import apply_config_override
from dynamic_agents.services.agent_runtime import AgentRuntime
from dynamic_agents.services.memory_namespaces import _decode_result, _extract_values


class _ToolArgs(BaseModel):
    pod_id: str | None
    query: str


def _runtime(namespace: str | None, *, required: bool = True) -> AgentRuntime:
    runtime = object.__new__(AgentRuntime)
    runtime._memory_namespace = namespace
    runtime.config = SimpleNamespace(
        name="test",
        builtin_tools=SimpleNamespace(
            memory=SimpleNamespace(
                enabled=True,
                namespace_scoped_tools=[
                    SimpleNamespace(
                        server="pods",
                        tools=["lookup"],
                        bind_arg="pod_id",
                        require_namespace=required,
                    )
                ],
            )
        ),
    )
    return runtime


def _tool(calls: list[dict]) -> StructuredTool:
    async def invoke(pod_id: str | None, query: str) -> dict:
        calls.append({"pod_id": pod_id, "query": query})
        return calls[-1]

    return StructuredTool(
        name="pods_lookup",
        description="lookup",
        args_schema=_ToolArgs,
        coroutine=invoke,
    )


@pytest.mark.asyncio
async def test_bound_arg_is_hidden_and_model_value_cannot_override_context() -> None:
    calls: list[dict] = []
    wrapped = _runtime("pod-safe")._apply_namespace_scoped_tools([_tool(calls)])

    assert "pod_id" not in wrapped[0].args_schema.model_fields
    await wrapped[0].ainvoke({"query": "status", "pod_id": "pod-evil"})
    assert calls == [{"pod_id": "pod-safe", "query": "status"}]


@pytest.mark.asyncio
async def test_optional_unscoped_binding_injects_none_and_required_tool_is_hidden() -> None:
    calls: list[dict] = []
    assert _runtime(None, required=True)._apply_namespace_scoped_tools([_tool(calls)]) == []

    wrapped = _runtime(None, required=False)._apply_namespace_scoped_tools([_tool(calls)])
    await wrapped[0].ainvoke({"query": "status"})
    assert calls == [{"pod_id": None, "query": "status"}]


def test_dynamic_result_decoding_and_array_path_expansion() -> None:
    result = SimpleNamespace(content=[{"type": "text", "text": '{"pods":[{"id":"a"},{"id":"b"}]}'}])

    decoded = _decode_result(result)

    assert _extract_values(decoded, "pods[].id") == ["a", "b"]


def _agent_with_memory(*, enabled: bool = True) -> DynamicAgentConfig:
    return DynamicAgentConfig.model_validate(
        {
            "_id": "agent-1",
            "name": "Memory agent",
            "system_prompt": "Help the user.",
            "model": {"id": "test", "provider": "test"},
            "owner_id": "owner@example.com",
            "builtin_tools": {
                "memory": {
                    "enabled": enabled,
                    "allow_custom": False,
                    "namespaces": [{"key": "pod-1", "label": "Pod 1"}],
                }
            },
        }
    )


def test_config_override_can_disable_memory_without_changing_policy() -> None:
    overridden = apply_config_override(
        _agent_with_memory(),
        {"builtin_tools": {"memory": {"enabled": False}}},
    )

    assert overridden.builtin_tools is not None
    assert overridden.builtin_tools.memory is not None
    assert overridden.builtin_tools.memory.enabled is False
    assert overridden.builtin_tools.memory.namespaces[0].key == "pod-1"


@pytest.mark.parametrize(
    "override",
    [
        {"enabled": True},
        {"allow_custom": True},
        {"namespaces": [{"key": "pod-2", "label": "Pod 2"}]},
    ],
)
def test_config_override_cannot_relax_memory_policy(override: dict) -> None:
    agent = _agent_with_memory(enabled=override != {"enabled": True})

    with pytest.raises(HTTPException) as exc_info:
        apply_config_override(agent, {"builtin_tools": {"memory": override}})

    assert getattr(exc_info.value, "status_code", None) == 400

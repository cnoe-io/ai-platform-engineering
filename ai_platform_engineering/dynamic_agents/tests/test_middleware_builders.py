# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0
# assisted-by claude code claude-sonnet-4-6

"""Unit tests for new middleware builders: summarization, human_in_the_loop,
shell_tool, filesystem_search."""

from unittest.mock import MagicMock, patch

from dynamic_agents.services.middleware import (
    _build_filesystem_search,
    _build_human_in_the_loop,
    _build_shell_tool,
    _build_summarization,
    get_middleware_definitions,
)

# ---------------------------------------------------------------------------
# SummarizationMiddleware builders (T009–T011)
# ---------------------------------------------------------------------------


def test_build_summarization_skips_when_no_model():
    assert _build_summarization({}) is None


def test_build_summarization_skips_when_only_model_id():
    assert _build_summarization({"model_id": "claude-3"}) is None


def test_build_summarization_with_model():
    fake_llm = MagicMock()
    with patch(
        "dynamic_agents.services.middleware._instantiate_model",
        return_value=fake_llm,
    ):
        result = _build_summarization(
            {
                "model_id": "claude-3",
                "model_provider": "bedrock",
                "trigger_tokens": 3000,
                "trigger_messages": 40,
                "keep_messages": 15,
            }
        )

    from langchain.agents.middleware.summarization import SummarizationMiddleware

    assert isinstance(result, SummarizationMiddleware)


def test_build_summarization_uses_defaults_when_params_absent():
    fake_llm = MagicMock()
    with patch(
        "dynamic_agents.services.middleware._instantiate_model",
        return_value=fake_llm,
    ):
        result = _build_summarization({"model_id": "m", "model_provider": "p"})

    assert result is not None


def test_summarization_appears_in_definitions():
    defs = get_middleware_definitions()
    keys = [d["key"] for d in defs]
    assert "summarization" in keys
    summ = next(d for d in defs if d["key"] == "summarization")
    assert summ["model_params"] is True
    assert "trigger_tokens" in summ["param_schema"]
    assert "trigger_messages" in summ["param_schema"]
    assert "keep_messages" in summ["param_schema"]


# ---------------------------------------------------------------------------
# HumanInTheLoopMiddleware builders (T013–T014)
# ---------------------------------------------------------------------------


def test_build_hitl_skips_when_no_tool_names():
    assert _build_human_in_the_loop({"tool_names": ""}) is None


def test_build_hitl_skips_when_tool_names_missing():
    assert _build_human_in_the_loop({}) is None


def test_build_hitl_with_tool_names():
    from langchain.agents.middleware.human_in_the_loop import HumanInTheLoopMiddleware

    result = _build_human_in_the_loop(
        {
            "tool_names": "deploy,delete",
            "description_prefix": "Confirm action",
        }
    )
    assert isinstance(result, HumanInTheLoopMiddleware)
    assert "deploy" in result.interrupt_on
    assert "delete" in result.interrupt_on


def test_build_hitl_strips_whitespace_in_tool_names():
    from langchain.agents.middleware.human_in_the_loop import HumanInTheLoopMiddleware

    result = _build_human_in_the_loop({"tool_names": " deploy , delete , restart "})
    assert isinstance(result, HumanInTheLoopMiddleware)
    assert "deploy" in result.interrupt_on
    assert "delete" in result.interrupt_on
    assert "restart" in result.interrupt_on


def test_hitl_appears_in_definitions():
    defs = get_middleware_definitions()
    keys = [d["key"] for d in defs]
    assert "human_in_the_loop" in keys
    hitl = next(d for d in defs if d["key"] == "human_in_the_loop")
    assert hitl["model_params"] is False
    assert "tool_names" in hitl["param_schema"]
    assert "description_prefix" in hitl["param_schema"]


# ---------------------------------------------------------------------------
# ShellToolMiddleware builders (T016–T017)
# ---------------------------------------------------------------------------


def test_build_shell_tool_empty_workspace_root():
    from langchain.agents.middleware.shell_tool import ShellToolMiddleware

    result = _build_shell_tool({"workspace_root": "", "tool_name": "shell"})
    assert isinstance(result, ShellToolMiddleware)


def test_build_shell_tool_with_workspace_root(tmp_path):
    from langchain.agents.middleware.shell_tool import ShellToolMiddleware

    result = _build_shell_tool({"workspace_root": str(tmp_path), "tool_name": "sh"})
    assert isinstance(result, ShellToolMiddleware)


def test_build_shell_tool_uses_default_tool_name():
    from langchain.agents.middleware.shell_tool import ShellToolMiddleware

    result = _build_shell_tool({})
    assert isinstance(result, ShellToolMiddleware)


def test_shell_tool_appears_in_definitions():
    defs = get_middleware_definitions()
    keys = [d["key"] for d in defs]
    assert "shell_tool" in keys
    shell = next(d for d in defs if d["key"] == "shell_tool")
    assert "workspace_root" in shell["param_schema"]
    assert "tool_name" in shell["param_schema"]


# ---------------------------------------------------------------------------
# FilesystemFileSearchMiddleware builders (T019–T020)
# ---------------------------------------------------------------------------


def test_build_filesystem_search_skips_when_no_root_path():
    assert _build_filesystem_search({"root_path": ""}) is None


def test_build_filesystem_search_skips_when_root_path_missing():
    assert _build_filesystem_search({}) is None


def test_build_filesystem_search_with_root_path(tmp_path):
    from langchain.agents.middleware.file_search import FilesystemFileSearchMiddleware

    result = _build_filesystem_search(
        {
            "root_path": str(tmp_path),
            "use_ripgrep": True,
            "max_file_size_mb": 10,
        }
    )
    assert isinstance(result, FilesystemFileSearchMiddleware)


def test_build_filesystem_search_uses_defaults(tmp_path):
    from langchain.agents.middleware.file_search import FilesystemFileSearchMiddleware

    result = _build_filesystem_search({"root_path": str(tmp_path)})
    assert isinstance(result, FilesystemFileSearchMiddleware)


def test_filesystem_search_appears_in_definitions():
    defs = get_middleware_definitions()
    keys = [d["key"] for d in defs]
    assert "filesystem_search" in keys
    fs = next(d for d in defs if d["key"] == "filesystem_search")
    assert "root_path" in fs["param_schema"]
    assert "use_ripgrep" in fs["param_schema"]
    assert "max_file_size_mb" in fs["param_schema"]


# ---------------------------------------------------------------------------
# Smoke test: all 12 entries present (T023)
# ---------------------------------------------------------------------------


def test_all_12_middleware_definitions_present():
    defs = get_middleware_definitions()
    keys = {d["key"] for d in defs}
    expected = {
        "model_retry",
        "tool_retry",
        "model_call_limit",
        "tool_call_limit",
        "context_editing",
        "pii",
        "llm_tool_selector",
        "model_fallback",
        "summarization",
        "human_in_the_loop",
        "shell_tool",
        "filesystem_search",
    }
    assert expected == keys, f"Missing: {expected - keys}, Extra: {keys - expected}"

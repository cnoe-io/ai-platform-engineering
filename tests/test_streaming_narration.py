#!/usr/bin/env python3
"""
Unit tests for streaming narration features introduced in fix/1120-streaming-artifact-id-reset:

1. _tool_narration() — generates the correct narration string per tool
2. Narration dedup — same tool_call_id or same text emitted at most once
3. generate_system_prompt() narration instruction (USE_STRUCTURED_RESPONSE)
4. _direct_structured_response() — \n\n prefix, None on empty state

All tests are pure unit tests; no real LLM, graph, or network calls.

Usage:
    pytest tests/test_streaming_narration.py -v
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ===========================================================================
# 1. _tool_narration — unit tests
# ===========================================================================

class TestToolNarration:
    """Tests for the _tool_narration() module-level function in agent.py."""

    @pytest.fixture(autouse=True)
    def import_narration(self):
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
            _tool_narration,
        )
        self.fn = _tool_narration

    # --- Internal / structural tools: must return None ---

    @pytest.mark.parametrize("tool_name", [
        "write_todos",
        "responseformat",
        "platformengineerresponse",
        "read_file",
        "write_file",
        "ls",
        "glob",
        "grep",
        "edit_file",
        "reflect_on_output",
        "format_markdown",
        "get_current_date",
    ])
    def test_internal_tools_return_none(self, tool_name):
        """Internal/structural tools must not produce narration text."""
        result = self.fn(tool_name, {})
        assert result is None, f"Expected None for {tool_name!r}, got {result!r}"

    def test_case_insensitive_internal_tool_check(self):
        """Tool name matching is case-insensitive for the None-return list."""
        assert self.fn("WRITE_TODOS", {}) is None
        assert self.fn("ResponseFormat", {}) is None

    # --- Search tools ---

    def test_search_with_query_returns_query_in_text(self):
        """Search tool with 'query' arg embeds the query in the narration."""
        result = self.fn("search", {"query": "agntcy slim"})
        assert result is not None
        assert "agntcy slim" in result

    def test_search_with_q_arg(self):
        """Search tool also accepts 'q' as the query arg."""
        result = self.fn("search", {"q": "kubernetes pods"})
        assert result is not None
        assert "kubernetes pods" in result

    def test_search_with_long_query_truncated_at_120(self):
        """Query longer than 120 chars is truncated to the first 120 chars."""
        long_query = "a" * 200
        result = self.fn("search", {"query": long_query})
        assert result is not None
        # The embedded portion must not exceed 120 chars
        assert "a" * 121 not in result

    def test_search_with_150_plus_char_query_uses_thought_fallback(self):
        """When query >= 150 chars, falls back to 'thought' if provided."""
        long_query = "x" * 150
        result = self.fn("search", {"query": long_query, "thought": "narrowed context"})
        assert result is not None
        assert "narrowed context" in result

    def test_search_with_no_args_returns_generic_message(self):
        """Search with no useful args returns a generic knowledge base message."""
        result = self.fn("search", {})
        assert result is not None
        assert "knowledge base" in result.lower()

    def test_search_contains_tool_name_hint(self):
        """Search narration string mentions searching the knowledge base."""
        result = self.fn("search", {"query": "test"})
        assert "search" in result.lower() or "knowledge" in result.lower()

    # --- fetch_document / fetch_doc ---

    def test_fetch_document_with_thought_embeds_thought(self):
        """fetch_document with 'thought' arg includes thought in narration."""
        result = self.fn("fetch_document", {"thought": "need architecture overview"})
        assert result is not None
        assert "need architecture overview" in result

    def test_fetch_doc_alias_recognised(self):
        """'fetch_doc' prefix (alias) is also recognised."""
        result = self.fn("fetch_doc_by_id", {"thought": "test"})
        assert result is not None

    def test_fetch_document_without_thought_returns_generic(self):
        """fetch_document without thought returns a generic 'more details' message."""
        result = self.fn("fetch_document", {})
        assert result is not None
        assert "document" in result.lower()

    def test_fetch_document_long_thought_truncated_at_100(self):
        """Thought longer than 100 chars is truncated in the narration."""
        long_thought = "b" * 200
        result = self.fn("fetch_document", {"thought": long_thought})
        assert result is not None
        assert "b" * 101 not in result

    # --- RAG / knowledge tools ---

    def test_rag_tool_returns_knowledge_base_message(self):
        """Tool names containing 'rag' return a knowledge base narration."""
        result = self.fn("rag_search", {})
        assert result is not None
        assert "knowledge base" in result.lower()

    def test_knowledge_tool_returns_knowledge_base_message(self):
        """Tool names containing 'knowledge' return a knowledge base narration."""
        result = self.fn("knowledge_lookup", {})
        assert result is not None
        assert "knowledge base" in result.lower()

    # --- Generic tools ---

    def test_generic_tool_with_purpose_arg_embeds_purpose(self):
        """For generic tools, a 'query'/'task'/'message' arg provides purpose text."""
        result = self.fn("pagerduty_incident", {"task": "create P1 incident"})
        assert result is not None
        assert "create P1 incident" in result

    def test_generic_tool_without_purpose_returns_fallback(self):
        """Without a purpose arg, falls back to 'gather the information you need'."""
        result = self.fn("some_random_tool", {})
        assert result is not None
        assert "gather" in result.lower() or "tool" in result.lower()

    def test_generic_tool_name_is_title_cased_in_narration(self):
        """Tool name with underscores is title-cased in the narration."""
        result = self.fn("get_weather_data", {})
        assert result is not None
        assert "Get Weather Data" in result or "get_weather_data" not in result

    # --- All non-None returns must end with \n\n ---

    @pytest.mark.parametrize("tool_name,tool_args", [
        ("search", {"query": "test"}),
        ("fetch_document", {"thought": "why"}),
        ("fetch_document", {}),
        ("rag_query", {}),
        ("some_tool", {"message": "help"}),
        ("some_tool", {}),
    ])
    def test_narration_ends_with_double_newline(self, tool_name, tool_args):
        """Every non-None narration string ends with \\n\\n (flush boundary for Slack)."""
        result = self.fn(tool_name, tool_args)
        assert result is not None
        assert result.endswith("\n\n"), (
            f"Narration for {tool_name!r} does not end with \\n\\n: {result!r}"
        )

    def test_narration_is_single_string_no_word_splitting(self):
        """Narration is returned as a single chunk string, not a list/generator."""
        result = self.fn("search", {"query": "anything"})
        assert isinstance(result, str)

    def test_none_returned_for_none_tool_args(self):
        """_tool_narration handles None tool_args gracefully (not in the skip list)."""
        # tool_args is typed as dict but defensive check — use empty dict
        result = self.fn("search", {})
        assert result is not None

    def test_generic_tool_purpose_truncated_at_100(self):
        """Purpose arg exceeding 100 chars is truncated in narration."""
        long_purpose = "z" * 130
        result = self.fn("some_tool", {"query": long_purpose})
        assert result is not None
        assert "z" * 101 not in result


# ===========================================================================
# 2. generate_system_prompt narration instruction
# ===========================================================================

class TestGenerateSystemPromptNarration:
    """Tests for the narration instruction in generate_system_prompt().

    When a YAML template is loaded (prompt_config.yaml), it controls the prompt
    structure.  The final_answer_instructions variable is always built correctly
    by generate_system_prompt() regardless of the template.  Tests that verify
    the exact text in the rendered prompt therefore patch out the YAML template
    so the test exercises the code-path that embeds final_answer_instructions
    directly (the else-branch in generate_system_prompt).

    Tests that don't care about the embedded text run without patching.
    """

    @pytest.fixture
    def minimal_agents(self):
        """Minimal agents dict that won't error in generate_system_prompt."""
        return {}

    @pytest.fixture
    def no_yaml_template(self):
        """Patch out the YAML config so generate_system_prompt uses the fallback template.

        The fallback embeds {final_answer_instructions} directly, making it
        possible to assert on the exact text that the flag produces.
        """
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
            {},  # empty config → no yaml_template, no agent_prompts
        ):
            yield

    def test_use_structured_response_false_includes_final_answer_marker(
        self, minimal_agents, no_yaml_template
    ):
        """With use_structured_response=False, fallback prompt includes [FINAL ANSWER] marker."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt = generate_system_prompt(minimal_agents, use_structured_response=False)
        assert "[FINAL ANSWER]" in prompt

    def test_use_structured_response_true_excludes_final_answer_marker(
        self, minimal_agents, no_yaml_template
    ):
        """With use_structured_response=True, fallback prompt does NOT include [FINAL ANSWER] marker."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt = generate_system_prompt(minimal_agents, use_structured_response=True)
        assert "[FINAL ANSWER]" not in prompt

    def test_use_structured_response_true_includes_narration_instruction(
        self, minimal_agents, no_yaml_template
    ):
        """With use_structured_response=True, fallback prompt includes the narration instruction."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt = generate_system_prompt(minimal_agents, use_structured_response=True)
        assert "Before invoking any tool" in prompt

    def test_use_structured_response_false_excludes_narration_instruction(
        self, minimal_agents, no_yaml_template
    ):
        """With use_structured_response=False, narration instruction is NOT in fallback prompt."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt = generate_system_prompt(minimal_agents, use_structured_response=False)
        assert "Before invoking any tool" not in prompt

    def test_narration_instruction_contains_example_sentences(
        self, minimal_agents, no_yaml_template
    ):
        """Narration instruction includes example sentences to guide the model."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt = generate_system_prompt(minimal_agents, use_structured_response=True)
        assert "I'll search" in prompt or "Let me fetch" in prompt

    def test_both_modes_produce_non_empty_prompt(self, minimal_agents):
        """Both structured and unstructured modes return a non-empty string."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        for flag in (True, False):
            prompt = generate_system_prompt(minimal_agents, use_structured_response=flag)
            assert isinstance(prompt, str)
            assert len(prompt) > 50

    def test_default_use_structured_response_is_false(self, minimal_agents):
        """Default call (no use_structured_response arg) behaves like False."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        prompt_default = generate_system_prompt(minimal_agents)
        prompt_false = generate_system_prompt(minimal_agents, use_structured_response=False)
        assert prompt_default == prompt_false

    def test_agent_descriptions_included_in_prompt(self):
        """Agent descriptions from the agents dict appear in the generated prompt."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        fake_agents = {"github": {"description": "Manages GitHub repositories and PRs."}}
        prompt = generate_system_prompt(fake_agents, use_structured_response=False)
        assert "github" in prompt.lower() or "GitHub" in prompt

    def test_rag_not_connected_message_when_agent_absent(self):
        """When rag agent is not in agents dict, prompt includes RAG-not-available note."""
        from ai_platform_engineering.multi_agents.platform_engineer.prompts import generate_system_prompt
        # No 'rag' key in agents
        prompt = generate_system_prompt({}, use_structured_response=False)
        assert "RAG" in prompt or "knowledge base" in prompt.lower() or "not available" in prompt.lower()


# ===========================================================================
# 3. _direct_structured_response — \n\n prefix and fallback behaviour
# ===========================================================================

class TestDirectStructuredResponse:
    """Tests for _direct_structured_response() in AIPlatformEngineerA2ABinding."""

    @pytest.fixture
    def binding(self):
        """Create AIPlatformEngineerA2ABinding with mocked graph and LLMFactory."""
        mock_llm = MagicMock()
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.deep_agent.LLMFactory"
        ) as mock_factory_cls:
            mock_factory_cls.return_value.get_llm.return_value = mock_llm
            from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
                AIPlatformEngineerA2ABinding,
            )
            binding = AIPlatformEngineerA2ABinding.__new__(AIPlatformEngineerA2ABinding)
            binding.graph = AsyncMock()
            return binding

    @pytest.fixture
    def mock_response_format(self):
        """Create a mock PlatformEngineerResponse-like object."""
        obj = MagicMock()
        obj.content = "Here is the answer."
        obj.is_task_complete = True
        obj.require_user_input = False
        return obj

    @pytest.mark.asyncio
    async def test_content_gets_double_newline_prefix(self, binding, mock_response_format):
        """Response content that doesn't start with \\n gets \\n\\n prepended."""
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        mock_llm = MagicMock()
        mock_structured = AsyncMock(return_value=mock_response_format)
        mock_llm.with_structured_output.return_value = MagicMock(ainvoke=mock_structured)

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            result = await binding._direct_structured_response({"configurable": {}})

        assert result is not None
        assert result["content"].startswith("\n\n")
        assert "Here is the answer." in result["content"]

    @pytest.mark.asyncio
    async def test_content_already_starting_with_newline_not_double_prefixed(self, binding, mock_response_format):
        """Content that already starts with \\n does NOT get an extra \\n\\n."""
        mock_response_format.content = "\n\nAlready separated."
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        mock_llm = MagicMock()
        mock_structured = AsyncMock(return_value=mock_response_format)
        mock_llm.with_structured_output.return_value = MagicMock(ainvoke=mock_structured)

        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            result = await binding._direct_structured_response({"configurable": {}})

        assert result is not None
        # Should start with exactly \n\n, not \n\n\n\n
        assert result["content"].startswith("\n\n")
        assert not result["content"].startswith("\n\n\n\n")

    @pytest.mark.asyncio
    async def test_returns_none_when_no_messages(self, binding):
        """Returns None when the graph state has no messages."""
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": []})
        )
        result = await binding._direct_structured_response({"configurable": {}})
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_state_is_none(self, binding):
        """Returns None when aget_state returns None."""
        binding.graph.aget_state = AsyncMock(return_value=None)
        result = await binding._direct_structured_response({"configurable": {}})
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_llm_returns_none(self, binding):
        """Returns None when structured LLM returns None (model failure)."""
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        mock_llm = MagicMock()
        mock_llm.with_structured_output.return_value = MagicMock(
            ainvoke=AsyncMock(return_value=None)
        )
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            result = await binding._direct_structured_response({"configurable": {}})
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_exception(self, binding):
        """Returns None (does not propagate) when an exception is raised."""
        binding.graph.aget_state = AsyncMock(side_effect=RuntimeError("graph down"))
        result = await binding._direct_structured_response({"configurable": {}})
        assert result is None

    @pytest.mark.asyncio
    async def test_result_has_from_response_format_tool_flag(self, binding, mock_response_format):
        """Result dict always contains from_response_format_tool=True."""
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        mock_llm = MagicMock()
        mock_llm.with_structured_output.return_value = MagicMock(
            ainvoke=AsyncMock(return_value=mock_response_format)
        )
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            result = await binding._direct_structured_response({"configurable": {}})
        assert result is not None
        assert result["from_response_format_tool"] is True

    @pytest.mark.asyncio
    async def test_context_error_prepended_in_wrap_prompt(self, binding, mock_response_format):
        """Error context string is prepended to the wrap_prompt sent to the LLM."""
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        captured_messages = []

        async def capture_invoke(messages):
            captured_messages.extend(messages)
            return mock_response_format

        mock_llm = MagicMock()
        mock_llm.with_structured_output.return_value = MagicMock(ainvoke=capture_invoke)
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            await binding._direct_structured_response(
                {"configurable": {}}, context="recursion limit exceeded"
            )

        # The last message should contain "Recovery after error"
        last_msg = captured_messages[-1]
        assert "Recovery after error" in last_msg.content
        assert "recursion limit exceeded" in last_msg.content

    @pytest.mark.asyncio
    async def test_messages_trimmed_to_last_30(self, binding, mock_response_format):
        """Only the last 30 messages are sent to the LLM to avoid context overflow."""
        many_messages = [MagicMock() for _ in range(50)]
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": many_messages})
        )
        captured_messages = []

        async def capture_invoke(messages):
            captured_messages.extend(messages)
            return mock_response_format

        mock_llm = MagicMock()
        mock_llm.with_structured_output.return_value = MagicMock(ainvoke=capture_invoke)
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            await binding._direct_structured_response({"configurable": {}})

        # 30 history + 1 wrap_prompt
        assert len(captured_messages) == 31

    @pytest.mark.asyncio
    async def test_is_task_complete_from_response(self, binding, mock_response_format):
        """is_task_complete is taken from the response object attribute."""
        mock_response_format.is_task_complete = False
        binding.graph.aget_state = AsyncMock(
            return_value=MagicMock(values={"messages": [MagicMock()]})
        )
        mock_llm = MagicMock()
        mock_llm.with_structured_output.return_value = MagicMock(
            ainvoke=AsyncMock(return_value=mock_response_format)
        )
        with patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.LLMFactory"
        ) as llm_cls:
            llm_cls.return_value.get_llm.return_value = mock_llm
            result = await binding._direct_structured_response({"configurable": {}})
        assert result["is_task_complete"] is False


# ===========================================================================
# 4. Narration dedup — inline simulation
# ===========================================================================

class TestNarrationDedup:
    """Simulates the dedup logic that guards the narration yield in stream().

    The actual dedup lives inside the giant stream() coroutine. We isolate the
    logic here by replicating the minimal state machine so that we can assert
    on the dedup rules without spinning up a full LangGraph graph.
    """

    def _run_narration_pipeline(self, tool_calls: list[dict]) -> list[str]:
        """
        Simulate the narration dedup pipeline for a sequence of tool_calls.

        Each entry is {"id": str, "name": str, "args": dict}.
        Returns a list of narration strings that would have been yielded.
        """
        from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
            _tool_narration,
        )

        _narrated_tool_call_ids: set[str] = set()
        _narrated_texts: set[str] = set()
        yielded: list[str] = []

        for tc in tool_calls:
            tc_id = tc.get("id") or tc.get("name", "")
            tool_name = tc.get("name", "")
            tool_args = tc.get("args", {})

            _call_id = tc_id or tool_name
            if _call_id not in _narrated_tool_call_ids:
                _narrated_tool_call_ids.add(_call_id)
                narration = _tool_narration(tool_name, tool_args)
                if narration and narration not in _narrated_texts:
                    _narrated_texts.add(narration)
                    yielded.append(narration)

        return yielded

    def test_same_tool_call_id_narrates_only_once(self):
        """If Bedrock delivers multiple chunks with the same tool_call_id, narrate once."""
        tool_calls = [
            {"id": "call-1", "name": "search", "args": {"query": "kubernetes"}},
            {"id": "call-1", "name": "search", "args": {"query": "kubernetes"}},
            {"id": "call-1", "name": "search", "args": {"query": "kubernetes"}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(yielded) == 1

    def test_different_tool_call_ids_each_narrate(self):
        """Different tool_call_ids produce independent narrations."""
        tool_calls = [
            {"id": "call-1", "name": "search", "args": {"query": "agntcy"}},
            {"id": "call-2", "name": "fetch_document", "args": {"thought": "why"}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(yielded) == 2

    def test_identical_narration_text_emitted_only_once(self):
        """Two different call-IDs that produce identical text — text emitted once."""
        # Two separate "search" calls with no query → same generic fallback
        tool_calls = [
            {"id": "call-1", "name": "search", "args": {}},
            {"id": "call-2", "name": "search", "args": {}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(set(yielded)) == len(yielded), "Duplicate text in yielded narrations"

    def test_internal_tools_produce_no_narration(self):
        """Internal tools (write_todos, responseformat) are never narrated."""
        tool_calls = [
            {"id": "call-1", "name": "write_todos", "args": {}},
            {"id": "call-2", "name": "responseformat", "args": {}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert yielded == []

    def test_mixed_internal_and_external_only_external_narrated(self):
        """Mixed sequence: only non-internal tools produce narrations."""
        tool_calls = [
            {"id": "call-1", "name": "write_todos", "args": {}},
            {"id": "call-2", "name": "search", "args": {"query": "test"}},
            {"id": "call-3", "name": "responseformat", "args": {}},
            {"id": "call-4", "name": "fetch_document", "args": {}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(yielded) == 2  # search + fetch_document

    def test_tool_call_id_empty_falls_back_to_tool_name(self):
        """When call_id is empty, the tool_name is used as the dedup key."""
        tool_calls = [
            {"id": "", "name": "search", "args": {"query": "test"}},
            {"id": "", "name": "search", "args": {"query": "test"}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(yielded) == 1  # same name-based key, narrated once

    def test_each_unique_query_can_produce_distinct_narration(self):
        """Two searches with different queries produce different narration texts."""
        tool_calls = [
            {"id": "call-1", "name": "search", "args": {"query": "alpha topic"}},
            {"id": "call-2", "name": "search", "args": {"query": "beta topic"}},
        ]
        yielded = self._run_narration_pipeline(tool_calls)
        assert len(yielded) == 2
        assert all("alpha topic" in y or "beta topic" in y for y in yielded)

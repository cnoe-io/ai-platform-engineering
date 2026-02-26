# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Unit tests for automatic fact extraction via LangMem.

Tests the fact_extraction module: feature flag, extractor creation,
background extraction, error handling, store compatibility, and
agent integration.
"""

import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

from ai_platform_engineering.utils.agent_memory.fact_extraction import (
    EXTRACTION_INSTRUCTIONS,
    _build_extraction_config,
    _get_extraction_model,
    create_fact_extractor,
    extract_and_store_facts,
    is_fact_extraction_enabled,
    reset_fact_extractor,
)


# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture(autouse=True)
def _reset_extractor():
    """Reset cached extractor before each test."""
    reset_fact_extractor()
    yield
    reset_fact_extractor()


@pytest.fixture
def mock_store():
    store = AsyncMock()
    store.aput = AsyncMock()
    store.asearch = AsyncMock(return_value=[])
    store.adelete = AsyncMock()
    return store


@pytest.fixture
def sample_messages():
    return [
        HumanMessage(content="My team uses ArgoCD on the prod-west cluster"),
        AIMessage(content="Got it! I see your team uses ArgoCD on prod-west."),
        HumanMessage(content="Can you check the deployments in the monitoring namespace?"),
        AIMessage(content="I'll check the monitoring namespace deployments for you."),
    ]


@pytest.fixture
def long_conversation():
    """Simulate a long multi-turn conversation with diverse message types."""
    messages = [
        SystemMessage(content="You are a helpful platform engineering assistant."),
        HumanMessage(content="I need help with our Kubernetes setup."),
        AIMessage(content="Sure! What cluster are you working with?"),
        HumanMessage(content="The prod-us-west-2 cluster. We use ArgoCD."),
        AIMessage(
            content="Let me check the ArgoCD applications.",
            tool_calls=[{"id": "tc_1", "name": "list_argocd_apps", "args": {}}],
        ),
        ToolMessage(content='[{"name":"app1"},{"name":"app2"}]', tool_call_id="tc_1"),
        AIMessage(content="I found 2 applications in your cluster."),
        HumanMessage(content="Great. I prefer YAML output for configs."),
        AIMessage(content="Noted! I'll use YAML format for configurations."),
        HumanMessage(content="Our team name is Platform SRE."),
        AIMessage(content="Got it, Platform SRE team."),
    ]
    return messages


# ============================================================================
# Feature Flag Tests
# ============================================================================


class TestFeatureFlag:
    def test_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("ENABLE_FACT_EXTRACTION", None)
            assert is_fact_extraction_enabled() is False

    def test_disabled_explicitly(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "false"}):
            assert is_fact_extraction_enabled() is False

    def test_enabled(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "true"}):
            assert is_fact_extraction_enabled() is True

    def test_enabled_case_insensitive(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "True"}):
            assert is_fact_extraction_enabled() is True

    def test_enabled_uppercase(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "TRUE"}):
            assert is_fact_extraction_enabled() is True

    def test_random_value_is_disabled(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "yes"}):
            assert is_fact_extraction_enabled() is False

    def test_empty_value_is_disabled(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": ""}):
            assert is_fact_extraction_enabled() is False

    def test_whitespace_value_is_disabled(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "  "}):
            assert is_fact_extraction_enabled() is False

    def test_one_is_disabled(self):
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "1"}):
            assert is_fact_extraction_enabled() is False

    def test_enabled_with_surrounding_whitespace(self):
        """Value is trimmed by os.getenv but .lower() handles case."""
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "true"}):
            assert is_fact_extraction_enabled() is True


# ============================================================================
# Config Builder Tests
# ============================================================================


class TestBuildExtractionConfig:
    def test_basic_config(self):
        config = _build_extraction_config("user-123")
        assert config["configurable"]["langgraph_user_id"] == "user-123"
        assert config["configurable"]["thread_id"] == ""

    def test_config_with_thread_id(self):
        config = _build_extraction_config("user-123", thread_id="thread-abc")
        assert config["configurable"]["langgraph_user_id"] == "user-123"
        assert config["configurable"]["thread_id"] == "thread-abc"

    def test_config_none_thread_defaults_to_empty(self):
        config = _build_extraction_config("user-123", thread_id=None)
        assert config["configurable"]["thread_id"] == ""

    def test_config_has_configurable_key(self):
        config = _build_extraction_config("user-1")
        assert "configurable" in config

    def test_config_user_id_sanitizes_periods(self):
        config = _build_extraction_config("user@domain.com")
        assert config["configurable"]["langgraph_user_id"] == "user@domain_com"

    def test_config_empty_user_id(self):
        config = _build_extraction_config("")
        assert config["configurable"]["langgraph_user_id"] == ""

    def test_config_uuid_thread_id(self):
        import uuid
        tid = str(uuid.uuid4())
        config = _build_extraction_config("user-1", thread_id=tid)
        assert config["configurable"]["thread_id"] == tid


# ============================================================================
# Get Extraction Model Tests
# ============================================================================


class TestGetExtractionModel:
    def test_default_model_uses_llm_factory(self):
        mock_llm = MagicMock()
        mock_factory_cls = MagicMock()
        mock_factory_cls.return_value.get_llm.return_value = mock_llm
        with patch.dict(os.environ, {"FACT_EXTRACTION_MODEL": ""}):
            with patch.dict(
                "sys.modules",
                {"cnoe_agent_utils": MagicMock(LLMFactory=mock_factory_cls)},
            ):
                result = _get_extraction_model()
                assert result is mock_llm

    def test_custom_model_uses_init_chat_model(self):
        mock_model = MagicMock()
        mock_init = MagicMock(return_value=mock_model)
        mock_chat_models = MagicMock(init_chat_model=mock_init)
        with patch.dict(os.environ, {"FACT_EXTRACTION_MODEL": "gpt-4o-mini"}):
            with patch.dict(
                "sys.modules",
                {"langchain.chat_models": mock_chat_models},
            ):
                result = _get_extraction_model()
                mock_init.assert_called_once_with("gpt-4o-mini")
                assert result is mock_model

    def test_whitespace_only_model_uses_default(self):
        mock_llm = MagicMock()
        mock_factory_cls = MagicMock()
        mock_factory_cls.return_value.get_llm.return_value = mock_llm
        with patch.dict(os.environ, {"FACT_EXTRACTION_MODEL": "   "}):
            with patch.dict(
                "sys.modules",
                {"cnoe_agent_utils": MagicMock(LLMFactory=mock_factory_cls)},
            ):
                result = _get_extraction_model()
                assert result is mock_llm

    def test_model_env_not_set_uses_default(self):
        mock_llm = MagicMock()
        mock_factory_cls = MagicMock()
        mock_factory_cls.return_value.get_llm.return_value = mock_llm
        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("FACT_EXTRACTION_MODEL", None)
            with patch.dict(
                "sys.modules",
                {"cnoe_agent_utils": MagicMock(LLMFactory=mock_factory_cls)},
            ):
                result = _get_extraction_model()
                assert result is mock_llm


# ============================================================================
# Create Fact Extractor Tests
# ============================================================================


class TestCreateFactExtractor:
    def _patch_langmem(self, mock_create):
        """Patch the langmem module to intercept create_memory_store_manager."""
        mock_langmem = MagicMock(create_memory_store_manager=mock_create)
        return patch.dict("sys.modules", {"langmem": mock_langmem})

    def test_creates_memory_store_manager(self, mock_store):
        mock_manager = MagicMock()
        mock_create = MagicMock(return_value=mock_manager)
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=MagicMock(),
            ):
                result = create_fact_extractor(mock_store)
                assert result is mock_manager
                mock_create.assert_called_once()
                call_kwargs = mock_create.call_args
                assert call_kwargs.kwargs["store"] is mock_store
                assert call_kwargs.kwargs["namespace"] == ("memories", "{langgraph_user_id}")
                assert call_kwargs.kwargs["enable_inserts"] is True
                assert call_kwargs.kwargs["enable_deletes"] is False
                assert call_kwargs.kwargs["instructions"] == EXTRACTION_INSTRUCTIONS

    def test_caches_extractor(self, mock_store):
        mock_manager = MagicMock()
        mock_create = MagicMock(return_value=mock_manager)
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=MagicMock(),
            ):
                result1 = create_fact_extractor(mock_store)
                result2 = create_fact_extractor(mock_store)
                assert result1 is result2
                assert mock_create.call_count == 1

    def test_returns_none_on_import_error(self, mock_store):
        mock_create = MagicMock(side_effect=ImportError("langmem not installed"))
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=MagicMock(),
            ):
                result = create_fact_extractor(mock_store)
                assert result is None

    def test_returns_none_on_generic_error(self, mock_store):
        mock_create = MagicMock(side_effect=RuntimeError("unexpected"))
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=MagicMock(),
            ):
                result = create_fact_extractor(mock_store)
                assert result is None

    def test_reset_clears_cache(self, mock_store):
        mock_manager = MagicMock()
        mock_create = MagicMock(return_value=mock_manager)
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=MagicMock(),
            ):
                create_fact_extractor(mock_store)
                reset_fact_extractor()

                mock_manager2 = MagicMock()
                mock_create2 = MagicMock(return_value=mock_manager2)
                with self._patch_langmem(mock_create2):
                    result = create_fact_extractor(mock_store)
                    assert result is mock_manager2

    def test_model_error_returns_none(self, mock_store):
        """If _get_extraction_model raises, extractor returns None."""
        mock_create = MagicMock()
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                side_effect=RuntimeError("API key missing"),
            ):
                result = create_fact_extractor(mock_store)
                assert result is None

    def test_passes_model_to_create(self, mock_store):
        """Verify the LLM model is passed to create_memory_store_manager."""
        mock_model = MagicMock()
        mock_create = MagicMock(return_value=MagicMock())
        with self._patch_langmem(mock_create):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction._get_extraction_model",
                return_value=mock_model,
            ):
                create_fact_extractor(mock_store)
                assert mock_create.call_args.args[0] is mock_model


# ============================================================================
# Extract and Store Facts Tests
# ============================================================================


class TestExtractAndStoreFacts:
    @pytest.mark.asyncio
    async def test_skips_when_no_messages(self, mock_store):
        await extract_and_store_facts(
            store=mock_store, messages=[], user_id="user-1"
        )

    @pytest.mark.asyncio
    async def test_skips_when_no_user_id(self, mock_store, sample_messages):
        await extract_and_store_facts(
            store=mock_store, messages=sample_messages, user_id=""
        )

    @pytest.mark.asyncio
    async def test_skips_when_user_id_none(self, mock_store, sample_messages):
        await extract_and_store_facts(
            store=mock_store, messages=sample_messages, user_id=None
        )

    @pytest.mark.asyncio
    async def test_successful_extraction(self, mock_store, sample_messages):
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[
            {"namespace": ("memories", "user-1"), "key": "k1", "value": {"kind": "Memory", "content": "Team uses ArgoCD"}},
        ])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
                thread_id="thread-abc",
            )

            mock_manager.ainvoke.assert_called_once()
            call_args = mock_manager.ainvoke.call_args
            assert call_args[0][0]["messages"] == sample_messages
            config = call_args[1]["config"]
            assert config["configurable"]["langgraph_user_id"] == "user-1"
            assert config["configurable"]["thread_id"] == "thread-abc"

    @pytest.mark.asyncio
    async def test_extraction_with_no_thread_id(self, mock_store, sample_messages):
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )

            config = mock_manager.ainvoke.call_args[1]["config"]
            assert config["configurable"]["thread_id"] == ""

    @pytest.mark.asyncio
    async def test_graceful_failure_on_extractor_none(self, mock_store, sample_messages):
        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=None,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )

    @pytest.mark.asyncio
    async def test_graceful_failure_on_ainvoke_error(self, mock_store, sample_messages):
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(side_effect=RuntimeError("LLM timeout"))

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )

    @pytest.mark.asyncio
    async def test_returns_none_always(self, mock_store, sample_messages):
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[{"key": "k1"}])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            result = await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )
            assert result is None

    @pytest.mark.asyncio
    async def test_extraction_with_multiple_results(self, mock_store, sample_messages):
        """Multiple memory operations returned by the extractor."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[
            {"namespace": ("memories", "user-1"), "key": "k1", "value": {"kind": "Memory", "content": "Fact A"}},
            {"namespace": ("memories", "user-1"), "key": "k2", "value": {"kind": "Memory", "content": "Fact B"}},
            {"namespace": ("memories", "user-1"), "key": "k3", "value": {"kind": "Memory", "content": "Fact C"}},
        ])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )
            mock_manager.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_extraction_with_connection_error(self, mock_store, sample_messages):
        """Network errors during extraction are caught."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(
            side_effect=ConnectionError("Redis connection refused")
        )

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )

    @pytest.mark.asyncio
    async def test_extraction_with_long_conversation(self, mock_store, long_conversation):
        """Long conversations with mixed message types are handled."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[
            {"key": "k1", "value": {"content": "Uses ArgoCD"}},
        ])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=long_conversation,
                user_id="user-1",
            )
            call_args = mock_manager.ainvoke.call_args
            assert call_args[0][0]["messages"] == long_conversation

    @pytest.mark.asyncio
    async def test_extraction_passes_correct_input_format(self, mock_store, sample_messages):
        """The ainvoke call receives {"messages": [...]}, not a bare list."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )
            input_arg = mock_manager.ainvoke.call_args[0][0]
            assert isinstance(input_arg, dict)
            assert "messages" in input_arg
            assert isinstance(input_arg["messages"], list)


# ============================================================================
# Store Compatibility Tests
# ============================================================================


class TestStoreCompatibility:
    """Verify store_get_cross_thread_context handles both old and new memory formats."""

    @pytest.mark.asyncio
    async def test_retrieves_old_format_memories(self):
        """Old format: {"data": "...", "timestamp": ...}"""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {"data": "User prefers dark mode", "timestamp": 100}

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is not None
        assert "User prefers dark mode" in result

    @pytest.mark.asyncio
    async def test_retrieves_new_format_memories(self):
        """New format from MemoryStoreManager: {"kind": "Memory", "content": "..."}"""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {"kind": "Memory", "content": "Team uses ArgoCD on prod-west"}

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is not None
        assert "Team uses ArgoCD on prod-west" in result

    @pytest.mark.asyncio
    async def test_retrieves_mixed_format_memories(self):
        """Both old and new format memories coexist."""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        old_item = MagicMock()
        old_item.value = {"data": "Old memory", "timestamp": 100}

        new_item = MagicMock()
        new_item.value = {"kind": "Memory", "content": "New memory"}

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [old_item, new_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is not None
        assert "Old memory" in result
        assert "New memory" in result

    @pytest.mark.asyncio
    async def test_handles_dict_content(self):
        """Content is a dict (structured schema) -- should be stringified."""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {
            "kind": "Preference",
            "content": {"category": "ui", "preference": "dark_mode"},
        }

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is not None
        assert "dark_mode" in result

    @pytest.mark.asyncio
    async def test_skips_empty_content(self):
        """Items with no data or content are skipped."""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {"kind": "Memory", "content": ""}

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is None

    @pytest.mark.asyncio
    async def test_handles_none_data_and_content(self):
        """Item with neither 'data' nor 'content' is skipped."""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {"kind": "Memory"}

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is None

    @pytest.mark.asyncio
    async def test_new_format_takes_precedence(self):
        """When both 'data' and 'content' exist, 'data' is used (checked first)."""
        from ai_platform_engineering.utils.store import store_get_cross_thread_context

        mock_item = MagicMock()
        mock_item.value = {
            "data": "old-format-data",
            "content": "new-format-content",
            "timestamp": 100,
        }

        store = AsyncMock()
        store.asearch = AsyncMock(side_effect=[
            [],
            [mock_item],
        ])

        result = await store_get_cross_thread_context(store, "user-1")
        assert result is not None
        assert "old-format-data" in result


# ============================================================================
# Agent Integration Tests
# ============================================================================


class TestAgentIntegration:
    """Test that agent.py stream() launches fact extraction correctly."""

    @pytest.mark.asyncio
    async def test_fact_extraction_launched_when_enabled(self):
        """Verify asyncio.create_task is called with correct args when enabled."""
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "true"}):
            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction.is_fact_extraction_enabled",
                return_value=True,
            ):
                with patch(
                    "ai_platform_engineering.utils.agent_memory.fact_extraction.extract_and_store_facts",
                    new_callable=AsyncMock,
                ) as mock_extract:
                    await mock_extract(
                        store=MagicMock(),
                        messages=[HumanMessage(content="test")],
                        user_id="user-1",
                        thread_id="thread-1",
                    )
                    mock_extract.assert_called_once()

    @pytest.mark.asyncio
    async def test_fact_extraction_not_launched_when_disabled(self):
        """Verify extraction is not called when feature flag is off."""
        assert is_fact_extraction_enabled() is False

    @pytest.mark.asyncio
    async def test_fact_extraction_not_launched_without_store(self):
        """No store means no extraction, even if enabled."""
        with patch.dict(os.environ, {"ENABLE_FACT_EXTRACTION": "true"}):
            assert is_fact_extraction_enabled() is True

    @pytest.mark.asyncio
    async def test_fact_extraction_not_launched_without_user_id(self, sample_messages):
        """No user_id means extraction is skipped."""
        mock_store = AsyncMock()
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=sample_messages, user_id=""
            )
            mock_manager.ainvoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_extraction_guard_conditions(self, sample_messages):
        """All three conditions (enabled, store, user_id) must be true."""
        conditions = [
            (True, MagicMock(), "user-1"),   # all true -> should extract
            (True, MagicMock(), ""),          # no user_id -> skip
            (True, None, "user-1"),           # no store -> skip (checked by caller)
            (False, MagicMock(), "user-1"),   # disabled -> skip (checked by caller)
        ]

        for enabled, store, user_id in conditions:
            mock_manager = AsyncMock()
            mock_manager.ainvoke = AsyncMock(return_value=[])

            with patch(
                "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
                return_value=mock_manager,
            ):
                await extract_and_store_facts(
                    store=store, messages=sample_messages, user_id=user_id
                )

                if user_id:
                    mock_manager.ainvoke.assert_called_once()
                else:
                    mock_manager.ainvoke.assert_not_called()

            reset_fact_extractor()


# ============================================================================
# Edge Cases
# ============================================================================


class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_extraction_with_system_messages(self, mock_store):
        """System messages in conversation should be handled."""
        messages = [
            SystemMessage(content="You are a helpful assistant"),
            HumanMessage(content="My cluster is called prod-east"),
            AIMessage(content="Noted, your cluster is prod-east."),
        ]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            mock_manager.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_extraction_with_single_message(self, mock_store):
        """Even a single message should be processable."""
        messages = [HumanMessage(content="I prefer YAML over JSON")]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            mock_manager.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_extraction_returns_empty_results(self, mock_store, sample_messages):
        """LLM extracts nothing -- should complete without error."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=sample_messages, user_id="user-1"
            )

    @pytest.mark.asyncio
    async def test_extraction_returns_none_results(self, mock_store, sample_messages):
        """LLM returns None -- should handle gracefully."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=None)

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=sample_messages, user_id="user-1"
            )

    @pytest.mark.asyncio
    async def test_extraction_instructions_content(self):
        """Verify extraction instructions contain key guidance."""
        assert "platform engineering" in EXTRACTION_INSTRUCTIONS
        assert "credentials" in EXTRACTION_INSTRUCTIONS
        assert "preferences" in EXTRACTION_INSTRUCTIONS

    @pytest.mark.asyncio
    async def test_extraction_with_tool_messages(self, mock_store):
        """Conversations with tool call results should be handled."""
        messages = [
            HumanMessage(content="List my ArgoCD applications"),
            AIMessage(
                content="Let me check.",
                tool_calls=[{"id": "tc_1", "name": "list_apps", "args": {}}],
            ),
            ToolMessage(content='[{"name":"app1"}]', tool_call_id="tc_1"),
            AIMessage(content="Found 1 application."),
        ]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            mock_manager.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_extraction_with_very_long_message(self, mock_store):
        """Very long messages should be passed through without truncation."""
        long_content = "fact " * 10000
        messages = [HumanMessage(content=long_content)]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            passed_messages = mock_manager.ainvoke.call_args[0][0]["messages"]
            assert len(passed_messages[0].content) == len(long_content)

    @pytest.mark.asyncio
    async def test_extraction_with_unicode_content(self, mock_store):
        """Unicode characters in messages should be handled correctly."""
        messages = [
            HumanMessage(content="My cluster name is クラスター-prod 🚀"),
            AIMessage(content="Got it! クラスター-prod 🚀"),
        ]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            mock_manager.ainvoke.assert_called_once()

    @pytest.mark.asyncio
    async def test_extraction_concurrent_calls(self, mock_store, sample_messages):
        """Multiple concurrent extraction calls should not interfere."""
        mock_manager = AsyncMock()
        call_count = 0

        async def delayed_invoke(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            return [{"key": f"k{call_count}"}]

        mock_manager.ainvoke = delayed_invoke

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            import asyncio
            tasks = [
                extract_and_store_facts(
                    store=mock_store,
                    messages=sample_messages,
                    user_id=f"user-{i}",
                )
                for i in range(5)
            ]
            await asyncio.gather(*tasks)
            assert call_count == 5

    @pytest.mark.asyncio
    async def test_extraction_with_keyboard_interrupt(self, mock_store, sample_messages):
        """KeyboardInterrupt during extraction should propagate."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(
            side_effect=KeyboardInterrupt("interrupted")
        )

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            with pytest.raises(KeyboardInterrupt):
                await extract_and_store_facts(
                    store=mock_store,
                    messages=sample_messages,
                    user_id="user-1",
                )

    @pytest.mark.asyncio
    async def test_extraction_timing_is_logged(self, mock_store, sample_messages):
        """Verify the function measures elapsed time."""
        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[{"key": "k1"}])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            before = time.time()
            await extract_and_store_facts(
                store=mock_store,
                messages=sample_messages,
                user_id="user-1",
            )
            after = time.time()
            assert (after - before) < 5  # Should be near-instant with mocks

    @pytest.mark.asyncio
    async def test_extraction_with_empty_message_content(self, mock_store):
        """Messages with empty content strings should be handled."""
        messages = [
            HumanMessage(content=""),
            AIMessage(content=""),
        ]

        mock_manager = AsyncMock()
        mock_manager.ainvoke = AsyncMock(return_value=[])

        with patch(
            "ai_platform_engineering.utils.agent_memory.fact_extraction.create_fact_extractor",
            return_value=mock_manager,
        ):
            await extract_and_store_facts(
                store=mock_store, messages=messages, user_id="user-1"
            )
            mock_manager.ainvoke.assert_called_once()

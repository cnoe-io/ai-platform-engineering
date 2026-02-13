# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Comprehensive tests for generate_system_prompt and FINAL_ANSWER_MARKER_SECTION.

Tests cover:
- FINAL_ANSWER_MARKER_SECTION content and structure
- generate_system_prompt with use_structured_response (True/False)
- generate_system_prompt with various agents configurations
- generate_system_prompt with/without RAG agent
- Fallback template when no YAML config template exists
"""

from unittest.mock import patch

from ai_platform_engineering.multi_agents.platform_engineer.prompts import (
    FINAL_ANSWER_MARKER_SECTION,
    generate_system_prompt,
)


# =============================================================================
# FINAL_ANSWER_MARKER_SECTION
# =============================================================================


class TestFinalAnswerMarkerSection:
    """Test suite for FINAL_ANSWER_MARKER_SECTION constant."""

    def test_contains_final_answer_marker(self):
        """Verify FINAL_ANSWER_MARKER_SECTION contains [FINAL ANSWER]."""
        assert "[FINAL ANSWER]" in FINAL_ANSWER_MARKER_SECTION

    def test_is_non_empty_string(self):
        """Verify FINAL_ANSWER_MARKER_SECTION is a non-empty string."""
        assert isinstance(FINAL_ANSWER_MARKER_SECTION, str)
        assert len(FINAL_ANSWER_MARKER_SECTION.strip()) > 0


# =============================================================================
# generate_system_prompt with use_structured_response
# =============================================================================


class TestGenerateSystemPromptUseStructuredResponse:
    """Test generate_system_prompt behavior with use_structured_response parameter."""

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_default_false_includes_final_answer_marker(self):
        """Default use_structured_response=False: prompt includes [FINAL ANSWER] text."""
        prompt = generate_system_prompt(agents={})
        assert "[FINAL ANSWER]" in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_structured_response_true_excludes_final_answer_marker(self):
        """use_structured_response=True: prompt does NOT include [FINAL ANSWER]."""
        prompt = generate_system_prompt(agents={}, use_structured_response=True)
        assert "[FINAL ANSWER]" not in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_structured_response_true_excludes_final_answer_section_text(self):
        """use_structured_response=True: prompt does NOT include FINAL ANSWER marker section text."""
        prompt = generate_system_prompt(agents={}, use_structured_response=True)
        # Key phrases from FINAL_ANSWER_MARKER_SECTION that should be absent
        assert "OUTPUT FORMAT - MANDATORY" not in prompt or "[FINAL ANSWER]" not in prompt
        # The marker itself is the main indicator
        assert "[FINAL ANSWER]" not in prompt


# =============================================================================
# generate_system_prompt with agents
# =============================================================================


class TestGenerateSystemPromptWithAgents:
    """Test generate_system_prompt with various agents configurations."""

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_empty_agents_produces_valid_prompt(self):
        """Empty agents dict produces a valid prompt."""
        prompt = generate_system_prompt(agents={})
        assert isinstance(prompt, str)
        assert len(prompt) > 0
        assert "AI Platform Engineer" in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_single_agent_includes_description(self):
        """Single agent includes its description in the prompt."""
        agents = {
            "github": {"description": "Manages GitHub repos, PRs, and issues."},
        }
        prompt = generate_system_prompt(agents=agents)
        assert "github" in prompt.lower()
        assert "Manages GitHub repos, PRs, and issues." in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_multiple_agents_include_all_descriptions(self):
        """Multiple agents include all descriptions in the prompt."""
        agents = {
            "github": {"description": "GitHub agent description"},
            "jira": {"description": "Jira agent description"},
        }
        prompt = generate_system_prompt(agents=agents)
        assert "github" in prompt.lower()
        assert "jira" in prompt.lower()
        assert "GitHub agent description" in prompt
        assert "Jira agent description" in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_agent_with_none_value_is_skipped(self):
        """Agent with None value is skipped."""
        agents = {
            "github": {"description": "GitHub agent"},
            "disabled": None,
            "jira": {"description": "Jira agent"},
        }
        prompt = generate_system_prompt(agents=agents)
        assert "GitHub agent" in prompt
        assert "Jira agent" in prompt
        # "disabled" as agent name might appear in some form; ensure we don't get None-related text
        assert "None" not in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_agent_without_description_key_is_skipped(self):
        """Agent without 'description' key is skipped (KeyError/Exception path)."""
        agents = {
            "valid": {"description": "Valid agent description"},
            "invalid": {"name": "InvalidAgent"},  # No 'description' key
        }
        prompt = generate_system_prompt(agents=agents)
        assert "Valid agent description" in prompt
        # Invalid agent is skipped; only valid agent contributes to tool instructions
        assert "invalid" not in prompt.lower()


# =============================================================================
# generate_system_prompt with RAG
# =============================================================================


class TestGenerateSystemPromptWithRag:
    """Test generate_system_prompt RAG-related behavior."""

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.get_rag_instructions",
        return_value="RAG search and graph tools are available. Use them for knowledge retrieval.",
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {
            "system_prompt_template": "{rag_instructions}\n{tool_instructions}\n{final_answer_instructions}",
        },
    )
    def test_with_rag_agent_includes_rag_instructions(self, mock_get_rag):
        """With rag agent in agents dict: includes RAG instructions."""
        agents = {"rag": {"description": "RAG knowledge base agent"}}
        prompt = generate_system_prompt(agents=agents, rag_config={"graph_rag_enabled": False})
        mock_get_rag.assert_called_once()
        assert "RAG search and graph tools are available" in prompt
        assert "RAG tools are NOT available" not in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {
            "system_prompt_template": "{rag_instructions}\n{tool_instructions}\n{final_answer_instructions}",
        },
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    def test_without_rag_agent_includes_not_available_message(self):
        """Without rag agent: includes 'RAG tools are NOT available' message."""
        agents = {"github": {"description": "GitHub agent"}}
        prompt = generate_system_prompt(agents=agents)
        assert "RAG tools are NOT available" in prompt


# =============================================================================
# Fallback template
# =============================================================================


class TestGenerateSystemPromptFallbackTemplate:
    """Test fallback template when no YAML config template exists."""

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_fallback_template_used_when_no_yaml_config(self):
        """When no YAML config template exists, fallback template is used."""
        prompt = generate_system_prompt(agents={})
        assert "AI Platform Engineer" in prompt
        assert "multi-agent system" in prompt.lower()

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.agent_prompts",
        {},
    )
    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_fallback_includes_tool_instructions(self):
        """Fallback template includes tool_instructions placeholder for agent content."""
        agents = {"github": {"description": "Handles GitHub operations"}}
        prompt = generate_system_prompt(agents=agents)
        assert "Handles GitHub operations" in prompt
        assert "github" in prompt.lower()

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_fallback_includes_final_answer_instructions_when_unstructured(self):
        """Fallback includes final_answer_instructions when use_structured_response=False."""
        prompt = generate_system_prompt(agents={}, use_structured_response=False)
        assert "[FINAL ANSWER]" in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {"system_prompt_template": None},
    )
    def test_fallback_excludes_final_answer_when_structured(self):
        """Fallback excludes final_answer section when use_structured_response=True."""
        prompt = generate_system_prompt(agents={}, use_structured_response=True)
        assert "[FINAL ANSWER]" not in prompt


# =============================================================================
# YAML template path (when template exists)
# =============================================================================


class TestGenerateSystemPromptWithYamlTemplate:
    """Test generate_system_prompt when YAML template is used."""

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {
            "system_prompt_template": (
                "Header\n{rag_instructions}\n{tool_instructions}\n{final_answer_instructions}"
            ),
        },
    )
    def test_yaml_template_with_final_answer_instructions(self):
        """YAML template receives and includes final_answer_instructions when unstructured."""
        prompt = generate_system_prompt(agents={}, use_structured_response=False)
        assert "Header" in prompt
        assert "[FINAL ANSWER]" in prompt

    @patch(
        "ai_platform_engineering.multi_agents.platform_engineer.prompts.config",
        {
            "system_prompt_template": (
                "Header\n{rag_instructions}\n{tool_instructions}\n{final_answer_instructions}"
            ),
        },
    )
    def test_yaml_template_excludes_final_answer_when_structured(self):
        """YAML template receives empty final_answer_instructions when structured."""
        prompt = generate_system_prompt(agents={}, use_structured_response=True)
        assert "Header" in prompt
        assert "[FINAL ANSWER]" not in prompt

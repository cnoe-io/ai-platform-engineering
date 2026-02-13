# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for AIPlatformEngineerA2ABinding.handle_structured_response."""

import json
from unittest.mock import MagicMock, patch

import pytest

from ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent import (
    AIPlatformEngineerA2ABinding,
)
from ai_platform_engineering.multi_agents.platform_engineer.response_format import (
    InputField,
    Metadata,
    PlatformEngineerResponse,
)


@pytest.fixture
def binding():
    """Create AIPlatformEngineerA2ABinding with mocked dependencies."""
    with (
        patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.AIPlatformEngineerMAS"
        ) as mock_mas,
        patch(
            "ai_platform_engineering.multi_agents.platform_engineer.protocol_bindings.a2a.agent.TracingManager"
        ) as mock_tracing,
    ):
        mock_mas.return_value.get_graph.return_value = MagicMock()
        mock_tracing.return_value = MagicMock()
        yield AIPlatformEngineerA2ABinding()


# -----------------------------------------------------------------------------
# PlatformEngineerResponse input
# -----------------------------------------------------------------------------


class TestPlatformEngineerResponseInput:
    """Tests for handle_structured_response with PlatformEngineerResponse input."""

    def test_valid_platform_engineer_response_yields_correct_output(self, binding):
        """Valid PlatformEngineerResponse object yields correct dict output."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Task completed successfully.",
        )
        result = binding.handle_structured_response(response)
        assert result == {
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Task completed successfully.",
        }

    def test_response_with_metadata_containing_input_fields_propagates_metadata(self, binding):
        """With metadata containing input_fields, metadata is propagated."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Please provide the required parameter.",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(
                        field_name="provider_name",
                        field_description="Cloud provider to use",
                        field_values=["aws", "gcp", "azure"],
                    ),
                ],
            ),
        )
        result = binding.handle_structured_response(response)
        assert result["metadata"] == {
            "user_input": True,
            "input_fields": [
                {
                    "field_name": "provider_name",
                    "field_description": "Cloud provider to use",
                    "field_values": ["aws", "gcp", "azure"],
                    "required": True,
                }
            ],
        }

    def test_response_without_metadata_has_no_metadata_key(self, binding):
        """Without metadata, result has no metadata key."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Done.",
        )
        result = binding.handle_structured_response(response)
        assert "metadata" not in result


# -----------------------------------------------------------------------------
# Dict input
# -----------------------------------------------------------------------------


class TestDictInput:
    """Tests for handle_structured_response with dict input."""

    def test_valid_dict_with_all_required_fields(self, binding):
        """Valid dict with all required fields yields correct output."""
        data = {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Please specify the parameter.",
        }
        result = binding.handle_structured_response(data)
        assert result == {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Please specify the parameter.",
        }

    def test_dict_with_metadata_propagates_metadata(self, binding):
        """Dict with metadata propagates metadata."""
        data = {
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Provide inputs.",
            "metadata": {
                "user_input": True,
                "input_fields": [
                    {
                        "field_name": "model",
                        "field_description": "Model to use",
                        "field_values": ["gpt-4", "claude-3"],
                        "required": True,
                    },
                ],
            },
        }
        result = binding.handle_structured_response(data)
        assert result["metadata"]["user_input"] is True
        assert len(result["metadata"]["input_fields"]) == 1
        assert result["metadata"]["input_fields"][0]["field_name"] == "model"
        assert result["metadata"]["input_fields"][0]["field_values"] == ["gpt-4", "claude-3"]

    def test_invalid_dict_missing_required_fields_falls_back_to_legacy(self, binding):
        """Invalid dict (missing required fields) falls back to legacy parsing."""
        data = {"is_task_complete": True}  # Missing content, require_user_input
        result = binding.handle_structured_response(data)
        # Fallback: str(dict) is not valid JSON, so JSONDecodeError path
        # Content will be string repr of dict; no [FINAL ANSWER] marker
        assert "is_task_complete" in result
        assert "require_user_input" in result
        assert "content" in result
        assert result["is_task_complete"] is False
        assert result["require_user_input"] is False


# -----------------------------------------------------------------------------
# String input - valid JSON
# -----------------------------------------------------------------------------


class TestStringInputValidJson:
    """Tests for handle_structured_response with valid JSON string input."""

    def test_valid_json_string_parsed_correctly(self, binding):
        """Valid JSON string is parsed correctly."""
        json_str = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Parsed from JSON string.",
        })
        result = binding.handle_structured_response(json_str)
        assert result == {
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Parsed from JSON string.",
        }

    def test_json_wrapped_in_json_markdown_fences_parsed(self, binding):
        """JSON wrapped in ```json``` markdown is parsed correctly."""
        inner = json.dumps({
            "is_task_complete": False,
            "require_user_input": True,
            "content": "Inside json fence.",
        })
        wrapped = f"```json\n{inner}\n```"
        result = binding.handle_structured_response(wrapped)
        assert result["content"] == "Inside json fence."
        assert result["is_task_complete"] is False
        assert result["require_user_input"] is True

    def test_json_wrapped_in_plain_markdown_fences_parsed(self, binding):
        """JSON wrapped in ``` markdown is parsed correctly."""
        inner = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Inside plain fence.",
        })
        wrapped = f"```\n{inner}\n```"
        result = binding.handle_structured_response(wrapped)
        assert result["content"] == "Inside plain fence."

    def test_multiple_json_objects_last_valid_used(self, binding):
        """Multiple JSON objects in string: last valid one is used."""
        first = json.dumps({
            "is_task_complete": False,
            "require_user_input": False,
            "content": "First object.",
        })
        second = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Second (last) object.",
        })
        combined = f"{first} {second}"
        result = binding.handle_structured_response(combined)
        assert result["content"] == "Second (last) object."
        assert result["is_task_complete"] is True

    def test_json_with_extra_text_before_still_parsed(self, binding):
        """JSON with extra text before it is still parsed."""
        prefix = "Here is my response:\n\n"
        json_obj = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Actual content.",
        })
        full = prefix + json_obj
        result = binding.handle_structured_response(full)
        assert result["content"] == "Actual content."


# -----------------------------------------------------------------------------
# String input - not JSON
# -----------------------------------------------------------------------------


class TestStringInputNotJson:
    """Tests for handle_structured_response with non-JSON string input."""

    def test_plain_text_returns_is_task_complete_false(self, binding):
        """Plain text returns is_task_complete=False, content=text."""
        text = "I am still working on this..."
        result = binding.handle_structured_response(text)
        assert result == {
            "is_task_complete": False,
            "require_user_input": False,
            "content": text,
        }

    def test_text_with_final_answer_marker_task_complete_true(self, binding):
        """Text with [FINAL ANSWER] marker yields is_task_complete=True."""
        text = "Some preamble [FINAL ANSWER] Here is the final answer."
        result = binding.handle_structured_response(text)
        assert result == {
            "is_task_complete": True,
            "require_user_input": False,
            "content": text,
        }

    def test_text_with_final_answer_underscore_marker_task_complete_true(self, binding):
        """Text with [FINAL_ANSWER] marker yields is_task_complete=True."""
        text = "Done. [FINAL_ANSWER] Result: success."
        result = binding.handle_structured_response(text)
        assert result == {
            "is_task_complete": True,
            "require_user_input": False,
            "content": text,
        }

    def test_empty_string_returns_structured_response(self, binding):
        """Empty string returns structured response."""
        result = binding.handle_structured_response("")
        # Empty string: not JSON-like, no marker -> is_task_complete=False
        assert result == {
            "is_task_complete": False,
            "require_user_input": False,
            "content": "",
        }


# -----------------------------------------------------------------------------
# String input - invalid JSON
# -----------------------------------------------------------------------------


class TestStringInputInvalidJson:
    """Tests for handle_structured_response with invalid JSON string input."""

    def test_malformed_json_falls_back_to_text_handling(self, binding):
        """Malformed JSON falls back to text handling."""
        malformed = '{"is_task_complete": true, "content": "broken'
        result = binding.handle_structured_response(malformed)
        assert "is_task_complete" in result
        assert "require_user_input" in result
        assert "content" in result
        assert result["content"] == malformed
        assert result["is_task_complete"] is False

    def test_json_that_does_not_match_schema_falls_back(self, binding):
        """JSON that does not match PlatformEngineerResponse schema falls back."""
        # Valid JSON but missing required 'content' field - model_validate_json fails
        # Fallback path: json.loads succeeds, returns parsed dict as-is (no content key)
        invalid_schema = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "extra_field": "unexpected",
        })
        result = binding.handle_structured_response(invalid_schema)
        assert "is_task_complete" in result
        assert "extra_field" in result
        # Fallback returns raw parsed dict - content may be absent when schema invalid
        assert result["is_task_complete"] is True
        assert result["extra_field"] == "unexpected"


# -----------------------------------------------------------------------------
# Edge cases
# -----------------------------------------------------------------------------


class TestEdgeCases:
    """Edge case tests for handle_structured_response."""

    def test_was_task_successful_not_in_output_dict(self, binding):
        """was_task_successful is present in model but NOT in output dict."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            was_task_successful=False,
            content="Task failed but completed.",
        )
        result = binding.handle_structured_response(response)
        assert "was_task_successful" not in result
        assert result["is_task_complete"] is True
        assert result["content"] == "Task failed but completed."

    def test_metadata_user_input_true_input_fields_properly_serialized(self, binding):
        """Metadata with user_input=True and input_fields properly serialized."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Need input.",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(
                        field_name="param",
                        field_description="Required param",
                        field_values=["a", "b"],
                        required=True,
                    ),
                ],
            ),
        )
        result = binding.handle_structured_response(response)
        assert result["metadata"]["user_input"] is True
        assert result["metadata"]["input_fields"] is not None
        assert result["metadata"]["input_fields"][0]["field_values"] == ["a", "b"]

    def test_input_field_with_field_values_propagated(self, binding):
        """InputField with field_values is propagated."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Select one.",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(
                        field_name="choice",
                        field_description="Pick",
                        field_values=["x", "y", "z"],
                    ),
                ],
            ),
        )
        result = binding.handle_structured_response(response)
        assert result["metadata"]["input_fields"][0]["field_values"] == ["x", "y", "z"]

    def test_input_field_without_field_values_is_none(self, binding):
        """InputField without field_values yields None in output."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Provide text.",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(
                        field_name="free_text",
                        field_description="Enter text",
                        field_values=None,
                    ),
                ],
            ),
        )
        result = binding.handle_structured_response(response)
        assert result["metadata"]["input_fields"][0]["field_values"] is None

    def test_empty_input_fields_list_serializes_as_none(self, binding):
        """Metadata with empty input_fields list: [] is falsy, so input_fields becomes None."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Need input.",
            metadata=Metadata(user_input=True, input_fields=[]),
        )
        result = binding.handle_structured_response(response)
        # Agent uses: input_fields if getattr(md, 'input_fields', None) else None
        # Empty list [] is falsy, so output has input_fields: None
        assert result["metadata"]["user_input"] is True
        assert result["metadata"]["input_fields"] is None

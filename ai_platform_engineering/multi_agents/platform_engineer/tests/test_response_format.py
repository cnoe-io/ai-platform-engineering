# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""Unit tests for response_format Pydantic models."""

import json

import pytest
from pydantic import ValidationError

from ai_platform_engineering.multi_agents.platform_engineer.response_format import (
    InputField,
    Metadata,
    PlatformEngineerResponse,
)


class TestInputField:
    """Tests for InputField model."""

    def test_required_fields_only(self):
        """Required fields only (field_name, field_description)."""
        field = InputField(field_name="provider_name", field_description="Cloud provider")
        assert field.field_name == "provider_name"
        assert field.field_description == "Cloud provider"
        assert field.field_values is None
        assert field.required is True

    def test_with_optional_field_values_list(self):
        """With optional field_values list."""
        field = InputField(
            field_name="model",
            field_description="Model selection",
            field_values=["gpt-4", "claude-3", "llama"],
        )
        assert field.field_values == ["gpt-4", "claude-3", "llama"]

    def test_with_field_values_as_none(self):
        """With field_values as None."""
        field = InputField(
            field_name="project_name",
            field_description="Project identifier",
            field_values=None,
        )
        assert field.field_values is None

    def test_required_defaults_to_true(self):
        """required defaults to True."""
        field = InputField(field_name="x", field_description="y")
        assert field.required is True

    def test_required_can_be_set_to_false(self):
        """required can be set to False."""
        field = InputField(
            field_name="optional_field",
            field_description="Optional",
            required=False,
        )
        assert field.required is False

    def test_missing_field_name_raises_validation_error(self):
        """Missing field_name raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            InputField(field_description="Missing field_name")
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("field_name",) for e in errors)

    def test_missing_field_description_raises_validation_error(self):
        """Missing field_description raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            InputField(field_name="test")
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("field_description",) for e in errors)

    def test_empty_field_values_list(self):
        """Empty field_values list."""
        field = InputField(
            field_name="empty_select",
            field_description="No options",
            field_values=[],
        )
        assert field.field_values == []


class TestMetadata:
    """Tests for Metadata model."""

    def test_required_user_input_field(self):
        """Required user_input field."""
        meta = Metadata(user_input=True)
        assert meta.user_input is True
        assert meta.input_fields is None

    def test_with_input_fields_list(self):
        """With input_fields list."""
        meta = Metadata(
            user_input=True,
            input_fields=[
                InputField(field_name="param", field_description="Param desc"),
            ],
        )
        assert meta.user_input is True
        assert len(meta.input_fields) == 1
        assert meta.input_fields[0].field_name == "param"

    def test_without_input_fields_none(self):
        """Without input_fields (None)."""
        meta = Metadata(user_input=False)
        assert meta.input_fields is None

    def test_empty_input_fields_list(self):
        """Empty input_fields list."""
        meta = Metadata(user_input=True, input_fields=[])
        assert meta.input_fields == []

    def test_missing_user_input_raises_validation_error(self):
        """Missing user_input raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            Metadata(input_fields=[])
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("user_input",) for e in errors)

    def test_user_input_as_true(self):
        """user_input as True."""
        meta = Metadata(user_input=True)
        assert meta.user_input is True

    def test_user_input_as_false(self):
        """user_input as False."""
        meta = Metadata(user_input=False)
        assert meta.user_input is False


class TestPlatformEngineerResponse:
    """Tests for PlatformEngineerResponse model."""

    def test_complete_response_with_all_fields(self):
        """Complete response with all fields."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            was_task_successful=True,
            content="Please provide the required parameter.",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(
                        field_name="parameter_name",
                        field_description="The parameter to provide",
                        field_values=["opt1", "opt2"],
                    ),
                ],
            ),
        )
        assert response.is_task_complete is False
        assert response.require_user_input is True
        assert response.was_task_successful is True
        assert response.content == "Please provide the required parameter."
        assert response.metadata is not None
        assert response.metadata.user_input is True
        assert len(response.metadata.input_fields) == 1
        assert response.metadata.input_fields[0].field_name == "parameter_name"

    def test_minimal_response_required_fields_only(self):
        """Minimal response (required fields only, metadata=None, was_task_successful defaults)."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Task done.",
        )
        assert response.is_task_complete is True
        assert response.require_user_input is False
        assert response.was_task_successful is True
        assert response.content == "Task done."
        assert response.metadata is None

    def test_was_task_successful_defaults_to_true(self):
        """was_task_successful defaults to True."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Done",
        )
        assert response.was_task_successful is True

    def test_was_task_successful_can_be_set_to_false(self):
        """was_task_successful can be set to False."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            was_task_successful=False,
            content="Task failed.",
        )
        assert response.was_task_successful is False

    def test_task_complete_scenario(self):
        """Task complete scenario (is_task_complete=True, require_user_input=False)."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Operation completed successfully.",
        )
        assert response.is_task_complete is True
        assert response.require_user_input is False

    def test_user_input_required_scenario(self):
        """User input required scenario (is_task_complete=False, require_user_input=True, with metadata)."""
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Please specify the provider.",
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
        assert response.is_task_complete is False
        assert response.require_user_input is True
        assert response.metadata.user_input is True
        assert len(response.metadata.input_fields) == 1

    def test_task_failed_scenario(self):
        """Task failed scenario (was_task_successful=False)."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            was_task_successful=False,
            content="Sub-agent was unavailable.",
        )
        assert response.was_task_successful is False
        assert "unavailable" in response.content

    def test_missing_required_fields_raises_validation_error(self):
        """Missing required fields raise ValidationError."""
        with pytest.raises(ValidationError):
            PlatformEngineerResponse()

    def test_missing_content_raises_validation_error(self):
        """Missing content raises ValidationError."""
        with pytest.raises(ValidationError) as exc_info:
            PlatformEngineerResponse(
                is_task_complete=True,
                require_user_input=False,
            )
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("content",) for e in errors)

    def test_json_serialization_roundtrip(self):
        """JSON serialization roundtrip."""
        original = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Test content",
            metadata=Metadata(
                user_input=True,
                input_fields=[
                    InputField(field_name="x", field_description="y", field_values=["a"]),
                ],
            ),
        )
        json_str = original.model_dump_json()
        parsed = PlatformEngineerResponse.model_validate_json(json_str)
        assert parsed.is_task_complete == original.is_task_complete
        assert parsed.require_user_input == original.require_user_input
        assert parsed.content == original.content
        assert parsed.metadata is not None
        assert parsed.metadata.input_fields[0].field_values == ["a"]

    def test_model_validate_from_dict(self):
        """model_validate from dict."""
        data = {
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Validated from dict",
        }
        response = PlatformEngineerResponse.model_validate(data)
        assert response.content == "Validated from dict"

    def test_model_validate_json_from_string(self):
        """model_validate_json from JSON string."""
        json_str = json.dumps({
            "is_task_complete": True,
            "require_user_input": False,
            "content": "Validated from JSON string",
        })
        response = PlatformEngineerResponse.model_validate_json(json_str)
        assert response.content == "Validated from JSON string"

    def test_json_schema_extra_contains_valid_example(self):
        """json_schema_extra contains valid example that validates."""
        schema = PlatformEngineerResponse.model_json_schema()
        example = schema.get("example")
        assert example is not None
        validated = PlatformEngineerResponse.model_validate(example)
        assert validated.is_task_complete is False
        assert validated.require_user_input is True
        assert validated.metadata is not None
        assert len(validated.metadata.input_fields) == 2

    def test_content_can_contain_markdown(self):
        """Content can contain markdown."""
        content = "# Heading\n\n- List item 1\n- List item 2\n\n**Bold** and *italic*."
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content=content,
        )
        assert response.content == content

    def test_content_can_be_empty_string(self):
        """Content can be empty string."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="",
        )
        assert response.content == ""

    def test_metadata_with_input_fields_propagates_correctly(self):
        """Metadata with input_fields propagates correctly."""
        input_fields = [
            InputField(
                field_name="field_a",
                field_description="Description A",
                field_values=["v1", "v2"],
                required=True,
            ),
            InputField(
                field_name="field_b",
                field_description="Description B",
                required=False,
            ),
        ]
        response = PlatformEngineerResponse(
            is_task_complete=False,
            require_user_input=True,
            content="Provide inputs",
            metadata=Metadata(user_input=True, input_fields=input_fields),
        )
        assert len(response.metadata.input_fields) == 2
        assert response.metadata.input_fields[0].field_name == "field_a"
        assert response.metadata.input_fields[0].field_values == ["v1", "v2"]
        assert response.metadata.input_fields[1].field_name == "field_b"
        assert response.metadata.input_fields[1].required is False

    def test_model_dump_includes_all_fields_with_defaults(self):
        """Model dump includes all fields with defaults."""
        response = PlatformEngineerResponse(
            is_task_complete=True,
            require_user_input=False,
            content="Minimal",
        )
        dumped = response.model_dump()
        assert "is_task_complete" in dumped
        assert "require_user_input" in dumped
        assert "was_task_successful" in dumped
        assert "content" in dumped
        assert "metadata" in dumped
        assert dumped["was_task_successful"] is True
        assert dumped["metadata"] is None

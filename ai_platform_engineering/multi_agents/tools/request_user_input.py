# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
Request User Input Tool

This tool allows the LLM to request structured input from the user.
Instead of asking questions in natural language, the LLM calls this tool
with a structured schema, and the UI renders an appropriate form.

This follows the AG-UI/A2UI pattern for spec-based dynamic UI generation.
"""

import json
import logging
from typing import List, Optional, Literal
from pydantic import BaseModel, Field
from langchain_core.tools import tool

logger = logging.getLogger(__name__)


class InputFieldSchema(BaseModel):
    """Schema for a single input field in the user input form."""
    
    field_name: str = Field(
        description="Unique identifier for the field (snake_case, e.g., 'repository_name')"
    )
    field_label: str = Field(
        description="Human-readable label for the field (e.g., 'Repository Name')"
    )
    field_description: Optional[str] = Field(
        default=None,
        description="Helper text explaining what the field is for"
    )
    field_type: Literal["text", "select", "boolean", "number", "url", "email"] = Field(
        default="text",
        description="The type of input field to render"
    )
    field_values: Optional[List[str]] = Field(
        default=None,
        description="For 'select' type: list of allowed values. For 'boolean': ['Yes', 'No'] is implied."
    )
    placeholder: Optional[str] = Field(
        default=None,
        description="Placeholder text for text inputs"
    )
    required: bool = Field(
        default=True,
        description="Whether this field is required"
    )
    default_value: Optional[str] = Field(
        default=None,
        description="Default value for the field"
    )


class UserInputRequest(BaseModel):
    """Schema for requesting structured user input."""
    
    title: str = Field(
        description="Title for the input form (e.g., 'Create GitHub Repository')"
    )
    description: str = Field(
        description="Brief description of what information is needed and why"
    )
    fields: List[InputFieldSchema] = Field(
        description="List of input fields to collect from the user"
    )


@tool(args_schema=UserInputRequest)
def request_user_input(
    title: str,
    description: str,
    fields: List[dict]
) -> str:
    """
    Request structured input from the user via a dynamic form.
    
    Use this tool when you need specific information from the user to proceed.
    Instead of asking in natural language, call this tool with the fields you need.
    The UI will render an appropriate form for the user to fill out.
    
    WHEN TO USE:
    - When you need specific parameters to execute a task (repo name, visibility, etc.)
    - When you need the user to choose from options (select fields)
    - When you need confirmation with specific details (boolean fields)
    
    WHEN NOT TO USE:
    - For simple yes/no confirmations (just ask in natural language)
    - When you already have all the information you need
    - For clarifying questions that don't need structured input
    
    Args:
        title: Title for the input form (e.g., "Create GitHub Repository")
        description: Brief description of what information is needed
        fields: List of field definitions, each with:
            - field_name: Unique identifier (snake_case)
            - field_label: Human-readable label
            - field_description: Helper text (optional)
            - field_type: "text", "select", "boolean", "number", "url", "email"
            - field_values: For select type, list of options
            - placeholder: Placeholder text (optional)
            - required: Whether field is required (default: True)
            - default_value: Default value (optional)
    
    Returns:
        A confirmation message. The actual form rendering is handled by the UI.
    
    Example:
        request_user_input(
            title="Create GitHub Repository",
            description="Please provide the details for the new repository",
            fields=[
                {
                    "field_name": "repository_name",
                    "field_label": "Repository Name",
                    "field_description": "The name for your new repository",
                    "field_type": "text",
                    "placeholder": "my-awesome-project",
                    "required": True
                },
                {
                    "field_name": "visibility",
                    "field_label": "Visibility",
                    "field_description": "Who can see this repository",
                    "field_type": "select",
                    "field_values": ["Public", "Private"],
                    "required": True
                },
                {
                    "field_name": "initialize_readme",
                    "field_label": "Initialize with README",
                    "field_description": "Create an initial README.md file",
                    "field_type": "boolean",
                    "required": False,
                    "default_value": "Yes"
                }
            ]
        )
    """
    # Validate fields
    validated_fields = []
    for field in fields:
        try:
            if isinstance(field, dict):
                validated_field = InputFieldSchema(**field)
            else:
                validated_field = field
            validated_fields.append(validated_field.model_dump())
        except Exception as e:
            logger.warning(f"Invalid field definition: {field}, error: {e}")
            # Still include it but with minimal validation
            validated_fields.append(field if isinstance(field, dict) else {"field_name": str(field)})
    
    logger.info(f"📝 User input requested: {title} with {len(validated_fields)} fields")
    logger.debug(f"Fields: {json.dumps(validated_fields, indent=2)}")
    
    # Return a structured response that will be intercepted by the agent binding
    # The actual form rendering happens in the UI based on the tool call arguments
    return json.dumps({
        "status": "input_requested",
        "title": title,
        "description": description,
        "field_count": len(validated_fields),
        "fields": validated_fields
    })

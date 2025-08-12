# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel, Field
from typing import List, Optional


class InputField(BaseModel):
    """Model for input field requirements"""
    field_name: str = Field(description="The name of the field that should be provided.")
    field_description: str = Field(description="A description of what this field represents and how it will be used.")
    field_values: Optional[List[str]] = Field(default=None, description="Possible values for the field, if any.")


class Metadata(BaseModel):
    """Model for response metadata"""
    user_input: bool = Field(description="Whether user input is required")
    input_fields: Optional[List[InputField]] = Field(default=None, description="List of input fields if any")


class PlatformEngineerResponse(BaseModel):
    """Structured response format for AI Platform Engineer"""
    is_task_complete: bool = Field(description="Whether the task is complete")
    require_user_input: bool = Field(description="Whether user input is required")
    content: str = Field(description="The main response content in markdown format")
    metadata: Optional[Metadata] = Field(default=None, description="Additional metadata about the response")

    class Config:
        json_schema_extra = {
            "example": {
                "is_task_complete": False,
                "require_user_input": True,
                "content": "I need more information to complete this task. Please provide the project name.",
                "metadata": {
                    "user_input": True,
                    "input_fields": [
                        {
                            "field_name": "project_name",
                            "field_description": "Name of the project to work with",
                            "field_values": ["project-a", "project-b"]
                        }
                    ]
                }
            }
        }

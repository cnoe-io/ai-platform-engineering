# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel, Field
from typing import List, Optional


class InputField(BaseModel):
    """Model for input field requirements extracted from tool responses"""
    field_name: str = Field(description="The name of the field that should be provided, extracted from the tool's specific request.")
    field_description: str = Field(description="A description of what this field represents, based on the tool's actual request for information.")
    field_values: Optional[List[str]] = Field(default=None, description="Possible values for the field mentioned by the tool, if any.")


class Metadata(BaseModel):
    """Model for response metadata"""
    user_input: bool = Field(description="Whether user input is required. Set to true when tools ask for specific information from user.")
    input_fields: Optional[List[InputField]] = Field(default=None, description="List of input fields extracted from the tool's specific request, if any")


class PlatformEngineerResponse(BaseModel):
    """Structured response format for AI Platform Engineer"""
    is_task_complete: bool = Field(description="Whether the task is complete. Set to false if tools ask for more information.")
    require_user_input: bool = Field(description="Whether user input is required. Set to true if tools request specific information from user.")
    content: str = Field(description="The main response content in markdown format. When tools ask for information, preserve their exact message without rewriting.")
    metadata: Optional[Metadata] = Field(default=None, description="Additional metadata about the response")

    class Config:
        json_schema_extra = {
            "example": {
                "is_task_complete": False,
                "require_user_input": True,
                "content": "Please specify the required parameter and provide the necessary configuration details.",
                "metadata": {
                    "user_input": True,
                    "input_fields": [
                        {
                            "field_name": "parameter_name",
                            "field_description": "The specific parameter that needs to be provided",
                            "field_values": ["option1", "option2", "option3"]
                        },
                        {
                            "field_name": "configuration_details",
                            "field_description": "Additional configuration or context details",
                            "field_values": None
                        }
                    ]
                }
            }
        }

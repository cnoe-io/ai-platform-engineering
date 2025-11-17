# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

from pydantic import BaseModel, Field
from typing import List, Optional
from enum import Enum


class RequestType(str, Enum):
    """Type of user request"""
    OPERATIONAL = "Operational"
    ANALYTICAL = "Analytical"
    DOCUMENTATION = "Documentation"
    HYBRID = "Hybrid"


class ExecutionTask(BaseModel):
    """Individual task in the execution plan"""
    task_number: int = Field(description="Sequential task number")
    description: str = Field(description="Clear description of the task")
    agent_name: Optional[str] = Field(description="Agent responsible for this task")
    can_parallelize: bool = Field(default=True, description="Can this task run in parallel?")


class ExecutionPlan(BaseModel):
    """Enforces execution plan structure before any tool calls"""
    plan_description: str = Field(
        description="Brief 1-sentence description of what will be done"
    )
    request_type: RequestType = Field(
        description="Category of the request: Operational/Analytical/Documentation/Hybrid"
    )
    required_agents: List[str] = Field(
        description="List of agent names that will be invoked (e.g., ['AWS', 'ArgoCD', 'GitHub'])"
    )
    tasks: List[ExecutionTask] = Field(
        description="Ordered list of specific tasks to execute",
        min_length=1
    )
    execution_mode: str = Field(
        default="parallel",
        description="How tasks will be executed: 'parallel' or 'sequential'"
    )


class InputField(BaseModel):
    """Model for input field requirements extracted from tool responses"""
    field_name: str = Field(description="The name of the field that should be provided, extracted from the tool's specific request.")
    field_description: str = Field(description="A description of what this field represents, based on the tool's actual request for information.")
    field_values: Optional[List[str]] = Field(default=None, description="Possible values for the field mentioned by the tool, if any.")


class ResponseMetadata(BaseModel):
    """Model for response metadata"""
    user_input: bool = Field(description="Whether user input is required. Set to true when tools ask for specific information from user.")
    input_fields: Optional[List[InputField]] = Field(default=None, description="List of input fields extracted from the tool's specific request, if any")


class PlatformEngineerWithPlan(BaseModel):
    """Complete response including execution plan and results"""
    execution_plan: ExecutionPlan = Field(
        description="REQUIRED execution plan that MUST be created before any tool calls"
    )
    content: str = Field(
        description="The response content (generated AFTER plan execution). When tools ask for information, preserve their exact message without rewriting."
    )
    is_task_complete: bool = Field(
        default=False,
        description="Whether all tasks in the plan are complete. Set to false if tools ask for more information."
    )
    require_user_input: bool = Field(
        default=False,
        description="Whether user input is required. Set to true if tools request specific information from user."
    )
    metadata: Optional[ResponseMetadata] = Field(
        default=None,
        description="Additional metadata about the response, including user input requirements if tools request information"
    )


# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from typing import List, Optional, Dict, Any
from enum import Enum

from pydantic import BaseModel
from pydantic.fields import Field


class GitHubChatBotQuestion(BaseModel):
    """
    A Pydantic model representing a GitHub-related question submitted to the chat bot along with associated metadata.

    Attributes:
    - chat_id (str): Unique identifier for the chat session.
    - question (str): The question text submitted by the user.
    - repository_context (str, optional): Repository context in format 'owner/repo' if applicable.
    - operation_type (str, optional): Type of GitHub operation requested (create_issue, merge_pr, etc.).
    """

    chat_id: str
    question: str
    repository_context: Optional[str] = Field(
        None, 
        description="Repository context in format 'owner/repo' for the question"
    )
    operation_type: Optional[str] = Field(
        None,
        description="Type of GitHub operation being requested"
    )


class GitHubResourceType(str, Enum):
    """Enumeration of GitHub resource types"""
    REPOSITORY = "repository"
    ISSUE = "issue"
    PULL_REQUEST = "pull_request"
    BRANCH = "branch"
    USER = "user"
    ORGANIZATION = "organization"
    COMMIT = "commit"
    RELEASE = "release"
    WORKFLOW = "workflow"
    SECURITY_ALERT = "security_alert"


class UserInputRequest(BaseModel):
    """An input that the user should provide for the agent to be able to take action."""

    field_name: str = Field(description="The name of the field that should be provided.")
    field_description: str = Field(
        description="A description of what this field represents and how it will be used.",
    )
    field_values: List[str] = Field(
        description="A list of possible values that the user can provide for this field.",
    )
    field_type: Optional[str] = Field(
        "string",
        description="The expected type of the field (string, number, boolean, etc.)"
    )
    required: bool = Field(
        True,
        description="Whether this field is required for the operation to proceed"
    )
    validation_pattern: Optional[str] = Field(
        None,
        description="Regex pattern for validating the field value"
    )


class GitHubResourceReference(BaseModel):
    """Reference to a GitHub resource that was created or modified"""
    
    resource_type: GitHubResourceType = Field(
        description="Type of GitHub resource"
    )
    resource_id: str = Field(
        description="Identifier of the resource (issue number, PR number, etc.)"
    )
    repository: Optional[str] = Field(
        None,
        description="Repository in format 'owner/repo' if applicable"
    )
    url: Optional[str] = Field(
        None,
        description="Direct URL to the resource"
    )
    title: Optional[str] = Field(
        None,
        description="Title or name of the resource"
    )
    details: Optional[Dict[str, Any]] = Field(
        None,
        description="Additional details about the resource"
    )


class AgentResponseMetadata(BaseModel):
    """Metadata about the response from GitHub Agent."""

    user_input: bool = Field(description="Indicates if the response requires user input")
    input_fields: List[UserInputRequest] = Field(
        default_factory=list,
        description="List of input fields required from the user"
    )
    
    # GitHub-specific metadata
    repositories_accessed: List[str] = Field(
        default_factory=list,
        description="List of repositories accessed during this operation"
    )
    resources_created: List[GitHubResourceReference] = Field(
        default_factory=list,
        description="List of GitHub resources created"
    )
    resources_modified: List[GitHubResourceReference] = Field(
        default_factory=list,
        description="List of GitHub resources modified"
    )
    api_calls_made: int = Field(
        0,
        description="Number of GitHub API calls made for this response"
    )
    operation_success: bool = Field(
        True,
        description="Whether the requested operation was successful"
    )
    warning_messages: List[str] = Field(
        default_factory=list,
        description="Any warning messages generated during the operation"
    )
    suggested_next_actions: List[str] = Field(
        default_factory=list,
        description="Suggested follow-up actions the user might want to take"
    )


class GitHubAgentResponse(BaseModel):
    """Response from GitHub Agent."""

    answer: str = Field(description="The response from the GitHub Agent")
    metadata: AgentResponseMetadata = Field(
        description="""Metadata about the response. Set user_input if the response has user input and \
corresponding input fields. Includes GitHub-specific information about operations performed.""",
    )
    
    # Additional response fields specific to GitHub operations
    execution_summary: Optional[str] = Field(
        None,
        description="Summary of what was accomplished in this interaction"
    )
    repository_context: Optional[str] = Field(
        None,
        description="Primary repository context for this response"
    )


class GitHubOperationRequest(BaseModel):
    """Request for a specific GitHub operation"""
    
    operation_type: str = Field(
        description="Type of operation to perform (create_issue, merge_pr, etc.)"
    )
    repository: Optional[str] = Field(
        None,
        description="Target repository in format 'owner/repo'"
    )
    parameters: Dict[str, Any] = Field(
        default_factory=dict,
        description="Parameters for the operation"
    )
    context: Optional[Dict[str, Any]] = Field(
        None,
        description="Additional context for the operation"
    )


class GitHubBatchOperationRequest(BaseModel):
    """Request for multiple GitHub operations to be performed in sequence"""
    
    operations: List[GitHubOperationRequest] = Field(
        description="List of operations to perform"
    )
    stop_on_error: bool = Field(
        True,
        description="Whether to stop processing if an operation fails"
    )
    parallel_execution: bool = Field(
        False,
        description="Whether operations can be executed in parallel"
    )


class GitHubSearchQuery(BaseModel):
    """Model for GitHub search queries"""
    
    query: str = Field(description="Search query string")
    search_type: str = Field(
        "repositories",
        description="Type of search (repositories, issues, users, code, etc.)"
    )
    sort: Optional[str] = Field(
        None,
        description="Sort field for results"
    )
    order: Optional[str] = Field(
        "desc",
        description="Sort order (asc or desc)"
    )
    per_page: int = Field(
        30,
        description="Number of results per page"
    )
    page: int = Field(
        1,
        description="Page number to retrieve"
    )


class GitHubWebhookEvent(BaseModel):
    """Model for GitHub webhook events"""
    
    event_type: str = Field(description="Type of GitHub event")
    repository: str = Field(description="Repository where event occurred")
    sender: str = Field(description="User who triggered the event")
    payload: Dict[str, Any] = Field(description="Full event payload")
    timestamp: str = Field(description="When the event occurred")
    processed: bool = Field(
        False,
        description="Whether this event has been processed"
    )
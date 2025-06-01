# Copyright CNOE Contributors (https://cnoe.io)
# SPDX-License-Identifier: Apache-2.0

from enum import Enum
from typing import Optional, TypedDict, List, Dict, Any

from pydantic import BaseModel, Field


class MsgType(Enum):
    human = "human"
    assistant = "assistant"


class Message(BaseModel):
    type: MsgType = Field(
        ...,
        description="indicates the originator of the message, a human or an assistant",
    )
    content: str = Field(..., description="the content of the message")


class ConfigSchema(TypedDict):
    toolsets: Optional[List[str]]  # GitHub toolsets to enable
    repository_context: Optional[str]  # Default repository context
    github_host: Optional[str]  # GitHub Enterprise Server host


class InputState(BaseModel):
    messages: Optional[list[Message]] = None
    repository_context: Optional[str] = Field(
        None, 
        description="Repository context in format 'owner/repo' for operations"
    )
    target_branch: Optional[str] = Field(
        None,
        description="Target branch for operations (defaults to main/master)"
    )


class OutputState(BaseModel):
    messages: Optional[list[Message]] = None
    repository_info: Optional[Dict[str, Any]] = Field(
        None,
        description="Information about repositories accessed during the operation"
    )
    created_resources: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="List of resources created (issues, PRs, branches, etc.)"
    )
    modified_resources: Optional[List[Dict[str, Any]]] = Field(
        None,
        description="List of resources modified during the operation"
    )


class GitHubOperation(BaseModel):
    """Represents a GitHub operation that was performed"""
    operation_type: str = Field(..., description="Type of operation (create_issue, merge_pr, etc.)")
    resource_type: str = Field(..., description="Type of resource (issue, pull_request, repository, etc.)")
    resource_id: Optional[str] = Field(None, description="ID or identifier of the resource")
    repository: Optional[str] = Field(None, description="Repository in format 'owner/repo'")
    details: Optional[Dict[str, Any]] = Field(None, description="Additional operation details")
    success: bool = Field(True, description="Whether the operation was successful")
    error_message: Optional[str] = Field(None, description="Error message if operation failed")


class AgentState(BaseModel):
    github_input: InputState
    github_output: Optional[OutputState] = None
    conversation_history: List[Dict[str, Any]] = []
    tools: Optional[List[Dict[str, Any]]] = None
    next_action: Optional[Dict[str, Any]] = None
    tool_results: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    
    # GitHub-specific state fields
    current_repository: Optional[str] = Field(
        None,
        description="Currently active repository in format 'owner/repo'"
    )
    enabled_toolsets: Optional[List[str]] = Field(
        None,
        description="List of enabled GitHub toolsets for this session"
    )
    github_operations: List[GitHubOperation] = Field(
        default_factory=list,
        description="History of GitHub operations performed in this session"
    )
    repository_cache: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description="Cache of repository information to avoid repeated API calls"
    )
    user_context: Optional[Dict[str, Any]] = Field(
        None,
        description="Information about the authenticated GitHub user"
    )


class GitHubContext(BaseModel):
    """Helper class for managing GitHub-specific context"""
    owner: str = Field(..., description="Repository owner")
    repo: str = Field(..., description="Repository name")
    branch: Optional[str] = Field(None, description="Target branch")
    
    @property
    def full_name(self) -> str:
        """Return the full repository name in 'owner/repo' format"""
        return f"{self.owner}/{self.repo}"
    
    @classmethod
    def from_string(cls, repo_string: str, branch: Optional[str] = None) -> "GitHubContext":
        """Create GitHubContext from 'owner/repo' string"""
        if "/" not in repo_string:
            raise ValueError("Repository string must be in format 'owner/repo'")
        
        owner, repo = repo_string.split("/", 1)
        return cls(owner=owner, repo=repo, branch=branch)


class ToolsetConfig(BaseModel):
    """Configuration for GitHub toolsets"""
    repos: bool = Field(True, description="Enable repository-related tools")
    issues: bool = Field(True, description="Enable issue-related tools")
    users: bool = Field(True, description="Enable user-related tools")
    pull_requests: bool = Field(True, description="Enable pull request tools")
    code_security: bool = Field(True, description="Enable code security tools")
    experiments: bool = Field(False, description="Enable experimental tools")
    
    def to_list(self) -> List[str]:
        """Convert to list of enabled toolset names"""
        enabled = []
        if self.repos:
            enabled.append("repos")
        if self.issues:
            enabled.append("issues")
        if self.users:
            enabled.append("users")
        if self.pull_requests:
            enabled.append("pull_requests")
        if self.code_security:
            enabled.append("code_security")
        if self.experiments:
            enabled.append("experiments")
        return enabled
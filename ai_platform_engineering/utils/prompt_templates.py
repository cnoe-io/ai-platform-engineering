# Copyright 2025 CNOE
# SPDX-License-Identifier: Apache-2.0

"""
Common Prompt Templates for AI Platform Engineering Agents

This module provides reusable prompt templates and building blocks that can be
imported and used across different agents to ensure consistency and reduce duplication.

Usage:
    from ai_platform_engineering.utils.prompt_templates import (
        graceful_error_handling_template,
        build_system_instruction,
        RESPONSE_FORMAT_XML_COORDINATION,
        RESPONSE_FORMAT_STATUS_SIMPLE
    )
"""

from typing import Dict, List, Optional
from dataclasses import dataclass


# ============================================================================
# GRACEFUL ERROR HANDLING TEMPLATES
# ============================================================================

def graceful_error_handling_template(service_name: str, service_type: str = "services") -> str:
    """
    Generate a graceful error handling template for a specific service.
    
    Args:
        service_name: Name of the service (e.g., "Petstore", "Komodor", "ArgoCD")
        service_type: Type of service (default: "services", could be "API", "platform", etc.)
    
    Returns:
        Formatted graceful error handling instructions
    """
    return f"""## Graceful Input Handling
If you encounter service connectivity or permission issues:
- Provide helpful, user-friendly messages explaining what's wrong
- Offer alternative approaches or next steps when possible
- Never timeout silently or return generic errors
- Focus on what the user can do, not internal system details
- Example: "I'm unable to connect to {service_name} {service_type} at the moment. This might be due to:
  - Temporary {service_name} service issues
  - Network connectivity problems
  - Service configuration needs updating
  Would you like me to try a different approach or provide general {service_name.lower()} guidance?"

Always strive to be helpful and provide guidance even when requests cannot be completed immediately."""


# Agents should call graceful_error_handling_template("ServiceName") directly


# ============================================================================
# RESPONSE FORMAT TEMPLATES
# ============================================================================

# XML-based response format for multi-agent coordination
RESPONSE_FORMAT_XML_COORDINATION = """## Response Format (CRITICAL - Required for Multi-Agent Coordination)

You MUST format EVERY response with these XML tags at the very start:

<task_complete>true|false</task_complete>
<require_user_input>true|false</require_user_input>

Then provide your response content after the tags.

### When to set flags:

**task_complete=true, require_user_input=false**
- You have fully answered the user's request
- No clarification or additional information needed
- User can proceed with the information provided
- Example: Successfully completed an operation, provided requested information

**task_complete=false, require_user_input=true**
- You need clarification from the user
- Required information is missing or ambiguous
- You're asking questions that must be answered before proceeding
- Example: User request is unclear or missing required parameters

**task_complete=false, require_user_input=false**
- Task is in progress (for intermediate updates only)
- Rarely used - most responses should be either complete or need input

### Format Examples:

<example>
User: "Find available items"
Agent Response:
<task_complete>true</task_complete>
<require_user_input>false</require_user_input>

I found 5 available items:
1. **Item A** (ID: 123)
2. **Item B** (ID: 456)
[... rest of response ...]
</example>

<example>
User: "Update the item"
Agent Response:
<task_complete>false</task_complete>
<require_user_input>true</require_user_input>

I'd be happy to help update an item! To proceed, I need:
- **Item ID** or **item name** - Which item would you like to update?
- **What to update** - What information should I change?

Please provide these details.
</example>

### CRITICAL REMINDERS:
- Tags MUST be on separate lines
- Tags MUST come before any other content
- Values MUST be exactly "true" or "false" (lowercase)
- Never omit these tags - they're required for system coordination"""


# Simple status-based response format
RESPONSE_FORMAT_STATUS_SIMPLE = """## Response Format Guidelines

Use these status guidelines for responses:
- Status 'completed': Request has been fully handled
- Status 'input_required': You need clarification from the user
- Status 'error': An error occurred that prevents completion

Provide clear, actionable responses and include relevant IDs or identifiers."""


# Format reminder for XML coordination (can be placed at top of system instructions)
FORMAT_REMINDER_XML = """⚠️ CRITICAL REQUIREMENT - Response Format ⚠️

EVERY response MUST start with these XML tags:
<task_complete>true|false</task_complete>
<require_user_input>true|false</require_user_input>

This is REQUIRED for multi-agent system coordination.
Set task_complete=true when you've fully answered the request.
Set require_user_input=true when you need clarification."""


# ============================================================================
# SYSTEM INSTRUCTION BUILDING BLOCKS
# ============================================================================

@dataclass
class AgentCapability:
    """Represents a capability section for an agent."""
    title: str
    description: str
    items: List[str]


def format_capabilities_section(capabilities: List[AgentCapability]) -> str:
    """
    Format a list of capabilities into a structured section.
    
    Args:
        capabilities: List of AgentCapability objects
        
    Returns:
        Formatted capabilities section
    """
    if not capabilities:
        return ""
        
    sections = ["## Core Capabilities"]
    
    for capability in capabilities:
        sections.append(f"### {capability.title}")
        if capability.description:
            sections.append(capability.description)
        
        for item in capability.items:
            sections.append(f"- {item}")
        sections.append("")  # Add spacing
    
    return "\n".join(sections).rstrip()


def format_response_guidelines(guidelines: List[str]) -> str:
    """
    Format response guidelines into a structured section.
    
    Args:
        guidelines: List of guideline strings
        
    Returns:
        Formatted guidelines section
    """
    if not guidelines:
        return ""
        
    lines = ["## Response Guidelines"]
    for guideline in guidelines:
        lines.append(f"- {guideline}")
    
    return "\n".join(lines)


def format_important_notes(notes: List[str]) -> str:
    """
    Format important notes into a structured section.
    
    Args:
        notes: List of note strings
        
    Returns:
        Formatted notes section
    """
    if not notes:
        return ""
        
    lines = ["## Important Notes"]
    for note in notes:
        lines.append(f"- {note}")
    
    return "\n".join(lines)


def format_tool_usage_guidelines(tools: Dict[str, str]) -> str:
    """
    Format tool usage guidelines.
    
    Args:
        tools: Dict mapping tool names to their usage descriptions
        
    Returns:
        Formatted tool usage section
    """
    if not tools:
        return ""
        
    lines = ["## Tool Usage Guidelines"]
    for i, (tool_name, description) in enumerate(tools.items(), 1):
        lines.append(f"{i}. **{tool_name}**: {description}")
    
    return "\n".join(lines)


def build_system_instruction(
    agent_name: str,
    agent_purpose: str,
    capabilities: Optional[List[AgentCapability]] = None,
    response_guidelines: Optional[List[str]] = None,
    important_notes: Optional[List[str]] = None,
    tool_usage_guidelines: Optional[Dict[str, str]] = None,
    graceful_error_handling: Optional[str] = None,
    response_format: Optional[str] = None,
    additional_sections: Optional[Dict[str, str]] = None
) -> str:
    """
    Build a complete system instruction from components.
    
    Args:
        agent_name: Name of the agent (e.g., "PETSTORE AGENT")
        agent_purpose: Brief description of agent's purpose
        capabilities: List of AgentCapability objects
        response_guidelines: List of response guideline strings
        important_notes: List of important note strings
        tool_usage_guidelines: Dict of tool names to descriptions
        graceful_error_handling: Graceful error handling template
        response_format: Response format instructions
        additional_sections: Additional custom sections
        
    Returns:
        Complete formatted system instruction
    """
    sections = []
    
    # Header
    sections.append(f"# {agent_name.upper()} INSTRUCTIONS")
    sections.append("")
    sections.append(agent_purpose)
    sections.append("")
    
    # Core capabilities
    if capabilities:
        sections.append(format_capabilities_section(capabilities))
        sections.append("")
    
    # Response guidelines
    if response_guidelines:
        sections.append(format_response_guidelines(response_guidelines))
        sections.append("")
    
    # Important notes
    if important_notes:
        sections.append(format_important_notes(important_notes))
        sections.append("")
    
    # Tool usage guidelines
    if tool_usage_guidelines:
        sections.append(format_tool_usage_guidelines(tool_usage_guidelines))
        sections.append("")
    
    # Additional custom sections
    if additional_sections:
        for title, content in additional_sections.items():
            sections.append(f"## {title}")
            sections.append(content)
            sections.append("")
    
    # Graceful error handling
    if graceful_error_handling:
        sections.append(graceful_error_handling)
        sections.append("")
    
    # Response format
    if response_format:
        sections.append(response_format)
        sections.append("")
    
    return "\n".join(sections).rstrip()


# ============================================================================
# COMMON RESPONSE GUIDELINES
# ============================================================================

STANDARD_RESPONSE_GUIDELINES = [
    "Provide clear, actionable responses",
    "Always include relevant IDs or identifiers in responses", 
    "If an operation fails, explain why and suggest alternatives",
    "Use markdown formatting for better readability"
]

SCOPE_LIMITED_GUIDELINES = [
    "Only respond to requests related to your integrated tools",
    "If the user asks about anything unrelated, politely state you can only assist with specific operations",
    "Do not attempt to answer unrelated questions or use tools for other purposes"
]

API_INTERACTION_GUIDELINES = [
    "Always verify resource availability before performing operations",
    "Respect API rate limits", 
    "Provide user-friendly error messages"
]


# ============================================================================
# COMMON IMPORTANT NOTES  
# ============================================================================

HUMAN_IN_LOOP_NOTES = [
    "Before creating, updating, or deleting any resources, ask the user for final confirmation",
    "Clearly summarize the intended action and prompt the user to confirm before proceeding"
]

LOGGING_NOTES = [
    "When returning logs, preserve all newlines and formatting as they appear in the original output",
    "Do not parse, summarize, or interpret log content unless explicitly asked"
]


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def combine_system_instruction_with_format(
    system_instruction: str,
    response_format: str,
    format_reminder: Optional[str] = None
) -> str:
    """
    Combine system instruction with response format, optionally adding format reminder at top.
    
    Args:
        system_instruction: The main system instruction
        response_format: Response format instructions
        format_reminder: Optional format reminder to place at top
        
    Returns:
        Combined instruction string
    """
    parts = []
    
    if format_reminder:
        parts.append(format_reminder)
        parts.append("")
    
    parts.append(system_instruction)
    parts.append("")
    parts.append(response_format)
    
    return "\n".join(parts)


def scope_limited_agent_instruction(
    service_name: str,
    service_operations: str,
    capabilities: Optional[List[AgentCapability]] = None,
    additional_guidelines: Optional[List[str]] = None,
    include_error_handling: bool = True
) -> str:
    """
    Create a scope-limited agent instruction for agents that only handle specific services.
    
    Args:
        service_name: Name of the service (e.g., "ArgoCD", "Jira")
        service_operations: Description of what operations the service handles
        capabilities: Optional list of capabilities
        additional_guidelines: Additional response guidelines
        include_error_handling: Whether to include graceful error handling (default: True)
                               Set to False for demo/template agents that don't make real API calls
        
    Returns:
        Formatted system instruction for scope-limited agent
    """
    purpose = (
        f"You are an expert assistant for {service_name} integration and operations. "
        f"Your purpose is to help users {service_operations}. "
        f"Use the available {service_name} tools to interact with the {service_name} API and provide accurate, "
        f"actionable responses."
    )
    
    guidelines = SCOPE_LIMITED_GUIDELINES.copy()
    guidelines.extend(STANDARD_RESPONSE_GUIDELINES)
    if additional_guidelines:
        guidelines.extend(additional_guidelines)
    
    return build_system_instruction(
        agent_name=f"{service_name} AGENT",
        agent_purpose=purpose,
        capabilities=capabilities,
        response_guidelines=guidelines,
        graceful_error_handling=graceful_error_handling_template(service_name) if include_error_handling else None
    )


# Export commonly used templates and functions
__all__ = [
    # Error handling templates
    "graceful_error_handling_template",
    
    # Response formats
    "RESPONSE_FORMAT_XML_COORDINATION",
    "RESPONSE_FORMAT_STATUS_SIMPLE", 
    "FORMAT_REMINDER_XML",
    
    # Building blocks
    "AgentCapability",
    "build_system_instruction",
    "format_capabilities_section",
    "format_response_guidelines", 
    "format_important_notes",
    "format_tool_usage_guidelines",
    
    # Common guidelines and notes
    "STANDARD_RESPONSE_GUIDELINES",
    "SCOPE_LIMITED_GUIDELINES",
    "API_INTERACTION_GUIDELINES",
    "HUMAN_IN_LOOP_NOTES",
    "LOGGING_NOTES",
    
    # Utility functions
    "combine_system_instruction_with_format",
    "scope_limited_agent_instruction"
]

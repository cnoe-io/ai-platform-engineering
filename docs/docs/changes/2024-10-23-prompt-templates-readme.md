# Common Prompt Templates

**Status**: 🟢 In-use
**Category**: Configuration & Prompts
**Date**: October 23, 2024

This document explains how to use the common prompt template utilities located in `prompt_templates.py` to create consistent, reusable system instructions for AI Platform Engineering agents.

## Overview

The `prompt_templates.py` module provides:

1. **Reusable prompt templates** - Common patterns like graceful error handling
2. **Building block functions** - Tools to construct system instructions programmatically
3. **Predefined guidelines** - Standard response guidelines and important notes
4. **Response formats** - XML coordination and simple status formats

## Quick Start

### Basic Usage

```python
from ai_platform_engineering.utils.prompt_templates import (
    AgentCapability,
    build_system_instruction,
    graceful_error_handling_template,
    STANDARD_RESPONSE_GUIDELINES,
    RESPONSE_FORMAT_XML_COORDINATION
)

# Define your agent's capabilities
capabilities = [
    AgentCapability(
        title="Ticket Management",
        description="Handle Jira tickets and issues",
        items=[
            "Create, update, and search for tickets",
            "Manage ticket status and priorities",
            "Add comments and attachments"
        ]
    )
]

# Build system instruction
system_instruction = build_system_instruction(
    agent_name="JIRA AGENT",
    agent_purpose="You are a Jira integration assistant...",
    capabilities=capabilities,
    response_guidelines=STANDARD_RESPONSE_GUIDELINES,
    graceful_error_handling=graceful_error_handling_template("Jira")
)
```

### Scope-Limited Agents

For agents that only handle specific services:

```python
from ai_platform_engineering.utils.prompt_templates import (
    scope_limited_agent_instruction
)

system_instruction = scope_limited_agent_instruction(
    service_name="ArgoCD",
    service_operations="manage ArgoCD applications and resources",
    additional_guidelines=["Ask for confirmation before destructive operations"]
)
```

## Available Templates

### Graceful Error Handling Templates

Use the template function to generate error handling for any service:

```python
from ai_platform_engineering.utils.prompt_templates import (
    graceful_error_handling_template
)

# For common services
petstore_handling = graceful_error_handling_template("Petstore")
komodor_handling = graceful_error_handling_template("Komodor")
argocd_handling = graceful_error_handling_template("ArgoCD")
jira_handling = graceful_error_handling_template("Jira")

# For custom services or APIs
custom_handling = graceful_error_handling_template("MyService", "API")
```

### Response Format Templates

#### XML Coordination Format
For multi-agent systems requiring task coordination:

```python
from ai_platform_engineering.utils.prompt_templates import (
    RESPONSE_FORMAT_XML_COORDINATION,
    FORMAT_REMINDER_XML,
    combine_system_instruction_with_format
)

# Combine with system instruction
full_instruction = combine_system_instruction_with_format(
    system_instruction=my_system_instruction,
    response_format=RESPONSE_FORMAT_XML_COORDINATION,
    format_reminder=FORMAT_REMINDER_XML
)
```

#### Simple Status Format
For simpler agents:

```python
from ai_platform_engineering.utils.prompt_templates import (
    RESPONSE_FORMAT_STATUS_SIMPLE
)
```

## Building System Instructions

### Using AgentCapability

Structure your agent's capabilities for consistency:

```python
from ai_platform_engineering.utils.prompt_templates import AgentCapability

capabilities = [
    AgentCapability(
        title="User Management",
        description="Handle user accounts and permissions",
        items=[
            "Create and update user accounts",
            "Manage user roles and permissions",
            "Reset passwords and handle authentication"
        ]
    ),
    AgentCapability(
        title="Reporting",
        description="Generate various reports",
        items=[
            "User activity reports",
            "System usage analytics",
            "Performance metrics"
        ]
    )
]
```

### Pre-defined Guidelines

Use standard guidelines for consistency:

```python
from ai_platform_engineering.utils.prompt_templates import (
    STANDARD_RESPONSE_GUIDELINES,      # Basic response quality guidelines
    SCOPE_LIMITED_GUIDELINES,          # For service-specific agents
    API_INTERACTION_GUIDELINES,        # For API-based agents
    HUMAN_IN_LOOP_NOTES,              # For destructive operations
    LOGGING_NOTES                      # For log handling
)

# Combine as needed
my_guidelines = STANDARD_RESPONSE_GUIDELINES + [
    "Include relevant ticket numbers in responses"
]

my_notes = API_INTERACTION_GUIDELINES + HUMAN_IN_LOOP_NOTES
```

### Custom Sections

Add custom sections to your system instructions:

```python
additional_sections = {
    "Authentication": "Always validate user permissions before operations...",
    "Data Privacy": "Never log or expose sensitive user information..."
}

system_instruction = build_system_instruction(
    agent_name="SECURE AGENT",
    agent_purpose="...",
    additional_sections=additional_sections
)
```

## Migration from Legacy Patterns

### Before (Legacy Approach)

```python
# Old way - duplicated across agents
SYSTEM_INSTRUCTION = """
# JIRA AGENT INSTRUCTIONS

You are a Jira assistant...

## Core Capabilities
- Create and update tickets
- Search for issues

## Response Guidelines
- Provide clear responses
- Include ticket IDs

## Graceful Input Handling
If you encounter service connectivity issues:
- Provide helpful messages
- Offer alternatives
...
"""
```

### After (Using Common Utilities)

```python
# New way - reusable and consistent
from ai_platform_engineering.utils.prompt_templates import (
    AgentCapability, build_system_instruction,
    graceful_error_handling_template, STANDARD_RESPONSE_GUIDELINES
)

capabilities = [
    AgentCapability(
        title="Ticket Management",
        description="Handle Jira tickets",
        items=["Create and update tickets", "Search for issues"]
    )
]

SYSTEM_INSTRUCTION = build_system_instruction(
    agent_name="JIRA AGENT",
    agent_purpose="You are a Jira assistant...",
    capabilities=capabilities,
    response_guidelines=STANDARD_RESPONSE_GUIDELINES + ["Include ticket IDs"],
    graceful_error_handling=graceful_error_handling_template("Jira")
)
```

## Benefits

### ✅ Consistency
- All agents use the same error handling patterns
- Standardized response formats across the platform
- Common guidelines ensure uniform behavior

### ✅ Maintainability
- Updates to common patterns propagate to all agents
- Easy to add new standard guidelines
- Single source of truth for prompt patterns

### ✅ Reduced Duplication
- No more copy-paste between agent system instructions
- Reusable building blocks for different agent types
- Shared templates for common scenarios

### ✅ Better Organization
- Clear separation between agent-specific logic and common patterns
- Modular system instructions that are easy to understand
- Structured approach to building complex prompts

## Real Examples

See how these utilities are used in practice:

- **Petstore Agent**: `/agents/template-claude-agent-sdk/agent_petstore/system_instructions.py`
- Shows full refactoring from legacy approach to common utilities
- Demonstrates AgentCapability usage and response format customization

## Adding New Common Patterns

When you identify a pattern used across multiple agents:

1. **Add the pattern to `prompt_templates.py`**
2. **Update existing agents to use the new pattern**
3. **Document the pattern in this README**
4. **Add appropriate exports to `__all__`**

### Example: Adding a New Guideline Set

```python
# In prompt_templates.py
SECURITY_GUIDELINES = [
    "Always validate user permissions before operations",
    "Log security-relevant actions for audit purposes",
    "Never expose sensitive data in responses"
]

# Export it
__all__ += ["SECURITY_GUIDELINES"]
```

## Best Practices

1. **Start with `scope_limited_agent_instruction()`** for simple agents
2. **Use `build_system_instruction()`** for complex agents with multiple capabilities
3. **Always include graceful error handling** for production agents
4. **Combine standard guidelines** rather than writing custom ones
5. **Use AgentCapability** to structure capabilities consistently
6. **Test prompt changes** across multiple agents when updating common templates

## Future Enhancements

Potential areas for expansion:

- **Multi-language support** for internationalized agents
- **Dynamic prompt assembly** based on available tools
- **Agent personality templates** for different interaction styles
- **Validation utilities** to ensure prompt quality and consistency

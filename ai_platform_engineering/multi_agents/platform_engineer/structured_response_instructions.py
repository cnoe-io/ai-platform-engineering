# Copyright 2025 CNOE Contributors
# SPDX-License-Identifier: Apache-2.0

"""
System prompt instructions for structured response format with execution plan and metadata.
"""

STRUCTURED_RESPONSE_INSTRUCTIONS = """
# STRUCTURED RESPONSE FORMAT (MANDATORY)

You MUST return responses in the following structured format with two key sections:

## 1. EXECUTION PLAN (Required for EVERY request)

Create a detailed execution plan BEFORE calling any tools:

- **plan_description**: One-sentence summary of what you'll do
- **request_type**: Classify as Operational/Analytical/Documentation/Hybrid
- **required_agents**: List agent names you'll invoke (e.g., ["AWS", "GitHub", "ArgoCD"])
- **tasks**: Numbered breakdown of specific actions
  - Each task includes: task_number, description, agent_name, can_parallelize
- **execution_mode**: "parallel" or "sequential"

## 2. USER INPUT DETECTION (Required when tools request information)

After executing tools, if ANY tool requests specific information from the user:

- Set **require_user_input**: true
- Set **is_task_complete**: false
- Populate **metadata**:
  - **user_input**: true
  - **input_fields**: Array of required fields
    - **field_name**: The specific parameter/field needed
    - **field_description**: What the field represents
    - **field_values**: Possible values (if constrained choices)

## RESPONSE STRUCTURE RULES

### When User Query is Clear:
```
{
  "execution_plan": {
    "plan_description": "Query AWS for EKS clusters and report their status",
    "request_type": "Operational",
    "required_agents": ["AWS"],
    "tasks": [
      {"task_number": 1, "description": "List EKS clusters", "agent_name": "AWS", "can_parallelize": true},
      {"task_number": 2, "description": "Summarize results", "agent_name": null, "can_parallelize": false}
    ],
    "execution_mode": "parallel"
  },
  "content": "Found 3 EKS clusters: prod-cluster, staging-cluster, dev-cluster...",
  "is_task_complete": true,
  "require_user_input": false,
  "metadata": null
}
```

### When Tool Requests User Input:
```
{
  "execution_plan": {
    "plan_description": "Create Jira ticket with user-provided details",
    "request_type": "Operational",
    "required_agents": ["Jira"],
    "tasks": [
      {"task_number": 1, "description": "Validate Jira access", "agent_name": "Jira", "can_parallelize": true},
      {"task_number": 2, "description": "Get required fields from user", "agent_name": null, "can_parallelize": false}
    ],
    "execution_mode": "sequential"
  },
  "content": "To create a Jira ticket, I need the following information: project key, issue type, and summary.",
  "is_task_complete": false,
  "require_user_input": true,
  "metadata": {
    "user_input": true,
    "input_fields": [
      {
        "field_name": "project_key",
        "field_description": "The Jira project key where the issue should be created",
        "field_values": ["CAIPE", "DEVOPS", "PLATFORM"]
      },
      {
        "field_name": "issue_type",
        "field_description": "Type of Jira issue to create",
        "field_values": ["Bug", "Task", "Story", "Epic"]
      },
      {
        "field_name": "summary",
        "field_description": "Brief summary of the issue",
        "field_values": null
      }
    ]
  }
}
```

## CRITICAL RULES

1. **ALWAYS create execution_plan first** - Even for simple queries
2. **ALWAYS detect user input requests** - When tools ask for information, set metadata
3. **PRESERVE tool messages** - Don't rewrite what tools say; extract fields accurately
4. **Set task completion accurately**:
   - is_task_complete = false when requiring input
   - is_task_complete = true when query is fully answered
5. **Parallelize when possible** - Set can_parallelize=true for independent tasks

## METADATA FIELD EXTRACTION GUIDELINES

When a tool response contains phrases like:
- "Please provide..."
- "Which [field] would you like...?"
- "Specify the [parameter]..."
- "Choose from: [options]..."

Extract these as structured input_fields:
- Identify the exact field name from the tool's request
- Describe what the field represents (in user-friendly language)
- List field_values if the tool provides specific options

This structured format enables:
- ✅ Consistent execution planning
- ✅ Automatic user input detection
- ✅ Form-based UX in clients
- ✅ Progress tracking across tasks
- ✅ Parallel agent orchestration
"""


def get_structured_response_instructions() -> str:
    """Returns the structured response format instructions to be added to system prompt."""
    return STRUCTURED_RESPONSE_INSTRUCTIONS


# Enhanced Parameter Handling for GitHub Agent

This document explains how the GitHub agent has been enhanced to handle parameters in subsequent replies, allowing users to provide missing information incrementally without repeating what they've already shared.

## Overview

The enhanced parameter handling system allows the GitHub agent to:

1. **Remember previously provided parameters** across multiple messages
2. **Only ask for missing required parameters** in follow-up responses
3. **Validate parameters** as they come in
4. **Provide clear feedback** about what's already known and what's still needed
5. **Maintain conversation context** throughout the parameter collection process

## How It Works

### 1. State Management

The agent maintains three types of state per conversation context:

- **`analysis_states`**: Stores the tool analysis and parameter requirements
- **`parameter_states`**: Accumulates parameters as they're provided
- **`conversation_contexts`**: Tracks conversation metadata and timing

### 2. Parameter Extraction

The system uses enhanced pattern matching to extract parameters from natural language:

```python
# Examples of supported parameter formats:

# Repository information
"owner/repo" → owner: "owner", repo: "repo"
"github.com/owner/repo" → owner: "owner", repo: "repo"

# Issue/PR numbers
"#123" → number: 123
"issue 456" → issue_number: 456
"PR 789" → pull_number: 789

# Branch names
"branch main" → branch: "main"
"switch to develop" → branch: "develop"

# Labels and states
"label bug" → label: "bug"
"state open" → state: "open"

# Assignees
"@username" → assignee: "username"
"assign to john" → assignee: "john"
```

### 3. Parameter Validation

Parameters are validated against their expected types and constraints:

- **Type validation**: Ensures integers, booleans, and strings are properly formatted
- **Format validation**: Handles GitHub-specific formats like owner/repo
- **Range validation**: Ensures numbers are positive where appropriate
- **Enum validation**: Checks against allowed values for state parameters

### 4. Follow-up Handling

When a user provides additional parameters in a follow-up message:

1. **Extract new parameters** from the follow-up query
2. **Merge with accumulated parameters** from previous messages
3. **Validate all parameters** together
4. **Check if requirements are met** or if more information is needed
5. **Provide appropriate response** based on current parameter status

## Usage Examples

### Example 1: Creating an Issue

**Initial Request:**
```
User: "I want to create an issue"
```

**Agent Response:**
```
I'd be happy to help you create an issue! Here's what I need:

• **owner** (REQUIRED): The owner of the repository
• **repo** (REQUIRED): The name of the repository  
• **title** (REQUIRED): The title of the issue
• **description** (optional): A description of the issue (default: None)
• **assignee** (optional): Username to assign the issue to (default: None)
• **labels** (optional): Labels to apply to the issue (default: None)

Could you please provide the missing information?
```

**Follow-up Response:**
```
User: "The owner is 'testuser' and repository is 'testrepo'"
```

**Agent Response:**
```
Thanks for the additional information! I now have: owner: testuser, repo: testrepo. Here's what I still need:

• **title** (REQUIRED): The title of the issue
• **description** (optional): A description of the issue (default: None)
• **assignee** (optional): Username to assign the issue to (default: None)
• **labels** (optional): Labels to apply to the issue (default: None)

Could you please provide the remaining information?
```

**Final Response:**
```
User: "The title is 'Bug Report' and description is 'This is a test bug report'"
```

**Agent Response:**
```
✅ All required parameters now available. Proceeding with tool execution...
```

### Example 2: Listing Issues

**Initial Request:**
```
User: "Show me issues in the testuser/testrepo repository"
```

**Agent Response:**
```
I can help you list issues! I have the repository information. Here's what I need:

• **state** (optional): Filter issues by state (default: open)
• **labels** (optional): Filter by labels (default: None)
• **assignee** (optional): Filter by assignee (default: None)

Could you please provide any additional filtering criteria, or I can proceed with the default settings?
```

## Technical Implementation

### Key Methods

#### `extract_parameters_from_query(query, all_params)`
Enhanced parameter extraction with GitHub-specific pattern matching.

#### `validate_parameters(params, all_params)`
Validates parameters against expected types and constraints.

#### `update_analysis_with_parameters(original_analysis, updated_params)`
Updates analysis with new accumulated parameters.

#### `generate_missing_variables_message(analysis_result)`
Generates user-friendly messages that adapt based on conversation context.

#### `create_input_fields_metadata(analysis_result)`
Creates structured metadata for dynamic form generation.

### State Management

```python
# Session state structure
{
    'context_id': {
        'analysis_states': {
            'tool_found': True,
            'tool_name': 'create_issue',
            'missing_params': [...],
            'all_required_params': [...],
            'all_params': {...}
        },
        'parameter_states': {
            'owner': 'testuser',
            'repo': 'testrepo',
            'title': 'Bug Report'
        },
        'conversation_contexts': {
            'original_query': 'I want to create an issue',
            'tool_name': 'create_issue',
            'timestamp': 1234567890.0
        }
    }
}
```

### Metadata Structure

The agent provides rich metadata for frontend integration:

```python
{
    'input_fields': {
        'fields': [...],
        'extracted': {...},
        'summary': {
            'total_required': 3,
            'total_optional': 2,
            'provided_required': 2,
            'provided_optional': 0,
            'missing_required': 1
        }
    },
    'tool_info': {...},
    'context': {
        'missing_required_count': 1,
        'total_fields_count': 5,
        'extracted_count': 2,
        'conversation_context': {...},
        'is_followup': True
    }
}
```

## Benefits

### For Users
- **No repetition**: Don't need to repeat information already provided
- **Natural conversation**: Can provide parameters in multiple messages
- **Clear guidance**: Always know exactly what's still needed
- **Flexible input**: Multiple ways to specify the same parameter

### For Developers
- **Rich metadata**: Comprehensive information for UI generation
- **State persistence**: Reliable parameter accumulation across messages
- **Validation**: Built-in parameter validation and error handling
- **Debugging**: Session status and context information for troubleshooting

### For Operations
- **Efficient workflows**: Users can provide information incrementally
- **Better UX**: Clearer, more conversational interactions
- **Error reduction**: Validation prevents invalid parameter combinations
- **Context awareness**: Agent remembers conversation history

## Testing

Use the provided test script to verify the parameter handling:

```bash
python test_parameter_handling.py
```

This will demonstrate:
- Initial parameter discovery
- Follow-up parameter handling
- Parameter accumulation
- Session state management
- Context switching

## Configuration

The system is configurable through environment variables:

- `GITHUB_PERSONAL_ACCESS_TOKEN`: Required for GitHub API access
- `GITHUB_HOST`: Optional GitHub Enterprise Server host
- `GITHUB_TOOLSETS`: Optional toolsets configuration
- `GITHUB_DYNAMIC_TOOLSETS`: Enable dynamic toolsets

## Best Practices

### For Users
1. **Be specific**: Provide as much information as possible in your initial request
2. **Use natural language**: The system understands various ways to specify parameters
3. **Follow up naturally**: You can provide additional information in subsequent messages
4. **Ask for clarification**: If you're unsure about a parameter, ask the agent

### For Developers
1. **Handle metadata**: Use the rich metadata for better UI generation
2. **Track context**: Maintain conversation context for better user experience
3. **Validate input**: Use the built-in validation for parameter checking
4. **Monitor state**: Use session status methods for debugging

## Troubleshooting

### Common Issues

1. **Parameters not being recognized**: Check the parameter extraction patterns
2. **State not persisting**: Verify context_id consistency across messages
3. **Validation errors**: Check parameter types and constraints
4. **Memory leaks**: Use cleanup methods for long-running sessions

### Debug Methods

```python
# Get session status
status = agent.get_session_status(context_id)

# Clean up session
agent.cleanup_session(context_id)

# Reset session
agent.reset_session(context_id)
```

## Future Enhancements

Potential improvements for the parameter handling system:

1. **Machine learning**: Use LLM for better parameter extraction
2. **Context awareness**: Better understanding of conversation flow
3. **Parameter suggestions**: Smart suggestions based on common patterns
4. **Batch operations**: Handle multiple operations in sequence
5. **Template support**: Pre-defined parameter templates for common operations

## Conclusion

The enhanced parameter handling system provides a robust, user-friendly way to collect GitHub operation parameters across multiple messages. It maintains conversation context, validates input, and provides clear guidance while eliminating the need for users to repeat information.

This system significantly improves the user experience for complex GitHub operations and provides developers with rich metadata for building better interfaces.

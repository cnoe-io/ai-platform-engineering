---
sidebar_position: 1
id: 036-user-input-metadata-format-architecture
sidebar_label: Architecture
---

# Architecture: User Input Metadata Format with Prefix Detection

**Date**: 2025-11-07

## Key Features

✅ **Explicit Prefix Detection**:
- `UserInputMetaData:` prefix for reliable parsing
- Clear separation from regular responses
- Graceful fallback to existing parsing

✅ **Structured JSON Format**:
- Consistent schema across all agents
- Validation support with field types
- Optional vs. required field marking

✅ **Rich Field Types**:
- `text` - Short text input (names, titles, identifiers)
- `textarea` - Long text input (descriptions, comments, code)
- `number` - Numeric input (IDs, counts, percentages)
- `select` - Dropdown with predefined options
- `boolean` - Yes/No toggle switches

✅ **Security-Conscious**:
- Excluded `email` and `password` field types
- Sensitive credentials should use proper auth flows

✅ **UI Improvements**:
- Execution Plan History now collapses with main plan
- "N updates" badge remains visible when collapsed
- Cleaner, more compact view


## Implementation Details

### 1. System Prompt Updates

**File:** `charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`

Added comprehensive section: **"🎨 USER INPUT METADATA FORMAT (When Input is Required)"**

**Response Format:**
```
UserInputMetaData: {
  "require_user_input": true,
  "content": "Clear explanation of what information is needed and why",
  "metadata": {
    "user_input": true,
    "input_fields": [
      {
        "name": "field_name",
        "description": "Clear description of what this field represents",
        "type": "text|number|textarea|select|boolean",
        "required": true,
        "options": ["option1", "option2"]
      }
    ]
  }
}
```

**Included Examples:**
1. GitHub PR Creation (branch_name, pr_title, pr_description, base_branch)
2. Jira Issue Creation (issue_title, issue_description, priority, assignee)
3. Configuration Update (config_key, config_value, apply_immediately)

### 2. Frontend Detection Logic

**File:** `community-plugins/workspaces/agent-forge/plugins/agent-forge/src/components/AgentForgePage.tsx`

**Updated Function:** `parseJsonResponseForMetadata()`

```typescript
const userInputMetaDataPrefix = 'UserInputMetaData:';
if (text.trim().startsWith(userInputMetaDataPrefix)) {
  console.log('🎨 UserInputMetaData prefix detected');
  try {
    // Extract JSON after prefix
    const jsonStr = text.trim().substring(userInputMetaDataPrefix.length).trim();
    const jsonResponse = JSON.parse(jsonStr);

    if (jsonResponse.metadata?.input_fields) {
      // Convert to MetadataField format and render form
      // ...
    }
  } catch (e) {
    console.error('❌ Failed to parse UserInputMetaData JSON:', e);
    // Fall through to regular parsing
  }
}
```

### 3. ChatMessage UI Enhancement

**File:** `community-plugins/workspaces/agent-forge/plugins/agent-forge/src/components/ChatMessage.tsx`

**Changes:**
- Moved "Execution Plan History" inside `Collapse` component
- History now collapses/expands together with main execution plan
- "N updates" badge remains visible in header for quick reference


## End-to-End Flow

1. **User Request** → Platform-engineer receives request requiring input
2. **Sub-agent Response** → Sub-agent indicates it needs more information
3. **Platform-engineer Format** → Formats response with `UserInputMetaData:` prefix
4. **Agent-Forge Parse** → Frontend detects prefix and parses JSON
5. **Form Render** → MetadataInputForm component renders interactive fields
6. **User Submit** → User fills form and submits
7. **Continue Workflow** → Platform-engineer continues with provided data


## Example Scenario: GitHub PR Creation

### Agent Response:
```
UserInputMetaData: {
  "require_user_input": true,
  "content": "To create a GitHub pull request, I need the following information:",
  "metadata": {
    "user_input": true,
    "input_fields": [
      {
        "name": "branch_name",
        "description": "The source branch for the pull request",
        "type": "text",
        "required": true
      },
      {
        "name": "pr_title",
        "description": "Title of the pull request",
        "type": "text",
        "required": true
      },
      {
        "name": "base_branch",
        "description": "Target branch",
        "type": "select",
        "required": true,
        "options": ["main", "develop", "staging"]
      }
    ]
  }
}
```

### Agent-Forge Renders:
- **Header:** "Input Required"
- **Description:** The content message
- **Three input fields:**
  - Text input for `branch_name`
  - Text input for `pr_title`
  - Dropdown for `base_branch` with options
- **Submit button**


## Implementation Architecture

### Custom Material-UI Components

**Current Implementation:**
- ✅ Custom MetadataInputForm component (`MetadataInputForm.tsx`)
- ✅ Lightweight and purpose-built for Agent-Forge
- ✅ Seamless Backstage theme integration
- ✅ Full control over UX and behavior
- ✅ No additional dependencies (no CopilotKit)

**Design Philosophy:**
- Uses standard Material-UI components (TextField, Select, Switch, Button)
- ReactMarkdown for description rendering
- Custom validation logic
- Standard React state management

**Future Consideration:**
- CopilotKit integration could be explored as a separate project
- Would provide advanced features like generative UI and complex state management
- Not needed for current use cases


## Security Considerations

- Excluded `email` and `password` field types from the prompt
- Sub-agents should not collect sensitive credentials through this mechanism
- All sensitive operations should use proper authentication flows
- Field validation prevents injection attacks


## Future Enhancements

- [ ] Add validation rules (min/max, patterns, etc.) to field definitions
- [ ] Support for multi-page forms (wizards)
- [ ] File upload field type
- [ ] Conditional fields (show field based on another field's value)
- [ ] CopilotKit integration for advanced generative UI
- [ ] Field dependencies and dynamic options
- [ ] Auto-complete suggestions for text fields
- [ ] Date/time picker field types


## Files Modified

1. **`charts/ai-platform-engineering/data/prompt_config.deep_agent.yaml`**
   - Added user input metadata format section (lines 634-790)
   - Added guidelines and three detailed examples
   - Defined 5 supported field types

2. **`community-plugins/workspaces/agent-forge/plugins/agent-forge/src/components/AgentForgePage.tsx`**
   - Updated `parseJsonResponseForMetadata` function (lines 1742-1807)
   - Added UserInputMetaData prefix detection and parsing
   - Graceful fallback to existing parsing

3. **`community-plugins/workspaces/agent-forge/plugins/agent-forge/src/components/ChatMessage.tsx`**
   - Moved execution plan history inside Collapse component
   - Improved collapsibility UX
   - Kept "N updates" badge visible


## Related

- Spec: [spec.md](./spec.md)

# CopilotKit-Style Metadata Input Implementation

**Status**: 🟡 Proposed (Superseded by 2025-11-07-user-input-metadata-format.md with UserInputMetaData prefix)
**Category**: Features & Enhancements
**Date**: October 31, 2025

## Overview

This implementation adds dynamic metadata input forms to the Agent Forge UI, similar to CopilotKit's interface. When the agent requires user input, a compact, interactive form is displayed with the appropriate input fields.

## Features

✅ **Dual Support**:
- Artifact metadata from `artifact-update` events
- JSON response parsing with `require_user_input` and `metadata.input_fields`

✅ **Dynamic Form Generation**:
- Text, number, email, password, textarea inputs
- Select dropdowns with predefined options
- Boolean toggles/switches
- Field validation (required, min/max, pattern, length)

✅ **Compact UI Design**:
- Reduced padding and margins
- Smaller font sizes
- Markdown rendering for descriptions
- Inline required badges

✅ **Markdown Support**:
- Full markdown rendering in description field
- Supports **bold**, lists, and other markdown syntax

## Implementation Details

### 1. New Component: `MetadataInputForm.tsx`

A reusable form component that renders dynamic input fields based on metadata schema.

**Props:**
- `title`: Form title (default: "Input Required")
- `description`: Markdown-enabled description
- `fields`: Array of field definitions
- `onSubmit`: Callback when form is submitted
- `isSubmitting`: Loading state flag
- `submitButtonText`: Custom button text

**Field Definition:**
```typescript
interface MetadataField {
  name: string;
  label?: string;
  type?: 'text' | 'number' | 'email' | 'password' | 'textarea' | 'select' | 'boolean';
  required?: boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: any;
  options?: Array<{ value: string; label: string }>;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}
```

### 2. Message Interface Update (`types.ts`)

Extended the `Message` interface to support metadata requests:

```typescript
interface Message {
  // ... existing fields
  metadataRequest?: MetadataRequest;
  metadataResponse?: Record<string, any>;
}

interface MetadataRequest {
  requestId?: string;
  title?: string;
  description?: string;
  fields: MetadataField[];
  artifactName?: string;
}
```

### 3. AgentForgePage Updates

#### A. Artifact Metadata Detection

Detects metadata in `artifact-update` events:

```typescript
if (event.artifact?.metadata && Object.keys(event.artifact.metadata).length > 0) {
  // Convert metadata to MetadataField format
  const metadataFields = Object.entries(event.artifact.metadata).map(...)

  // Add bot message with metadata request
  addMessageToSession({
    text: textPart.text,
    metadataRequest: { ... },
  });
}
```

#### B. JSON Response Parsing

Parses JSON responses with the following structure:

```json
{
  "content": "To create a GitHub issue, I need the following information...",
  "is_task_complete": false,
  "require_user_input": true,
  "metadata": {
    "user_input": true,
    "input_fields": [
      {
        "field_name": "repository_name",
        "field_description": "(e.g., org/repo)",
        "field_values": null
      },
      {
        "field_name": "issue_title",
        "field_description": "Please provide Issue title",
        "field_values": null
      }
    ]
  }
}
```

The parser extracts:
- `content` → displayed as markdown description
- `metadata.input_fields` → converted to form fields
- `field_values` → if present, creates a select dropdown

#### C. Metadata Submission Handler

```typescript
const handleMetadataSubmit = useCallback(
  async (messageId: string, data: Record<string, any>) => {
    // 1. Update message with response
    // 2. Add user message showing submitted data
    // 3. Send JSON data back to agent
    await handleMessageSubmit(JSON.stringify(data));
  },
  [currentSessionId, handleMessageSubmit, addMessageToSession],
);
```

### 4. ChatMessage Integration

Renders the metadata form when a message has a `metadataRequest` and no `metadataResponse`:

```typescript
{message.metadataRequest && !message.metadataResponse && (
  <Box mt={1}>
    <MetadataInputForm
      title={message.metadataRequest.title}
      description={message.metadataRequest.description}
      fields={message.metadataRequest.fields}
      onSubmit={(data) => onMetadataSubmit(message.messageId, data)}
    />
  </Box>
)}
```

### 5. ChatContainer Props Update

Added `onMetadataSubmit` callback to pass data up the component tree:

```typescript
interface ChatContainerProps {
  // ... existing props
  onMetadataSubmit?: (messageId: string, data: Record<string, any>) => void;
}
```

## Usage Examples

### Example 1: Artifact Metadata

Agent sends artifact with metadata:

```typescript
{
  kind: 'artifact-update',
  artifact: {
    name: 'input_request',
    metadata: {
      title: 'GitHub Repository Details',
      description: 'Please provide repository information',
      repository: {
        label: 'Repository URL',
        type: 'text',
        required: true,
        placeholder: 'https://github.com/org/repo'
      },
      branch: {
        label: 'Branch',
        type: 'text',
        defaultValue: 'main'
      }
    }
  }
}
```

### Example 2: JSON Response

Agent returns JSON with input fields:

```json
{
  "content": "To deploy the application:\n- **Cluster**: Target Kubernetes cluster\n- **Namespace**: Deployment namespace",
  "require_user_input": true,
  "metadata": {
    "input_fields": [
      { "field_name": "cluster", "field_description": "Target cluster" },
      { "field_name": "namespace", "field_description": "Deployment namespace" }
    ]
  }
}
```

## Styling

The form uses a compact design with:
- 1.5 spacing units padding
- Small icon sizes
- 0.9rem title font
- 0.85rem description font
- Reduced margins between fields
- Subtle borders and elevation

## Future Enhancements

Potential improvements:
- [ ] Multi-step forms for complex workflows
- [ ] Field dependencies (conditional fields)
- [ ] File upload support
- [ ] Date/time pickers
- [ ] Auto-save draft responses
- [ ] Field-level error messages from backend
- [ ] Custom validation rules

## Testing

To test the implementation:

1. Send a message that requires input
2. Agent should respond with JSON containing `require_user_input: true`
3. Verify the form renders with correct fields
4. Fill out the form and submit
5. Check that data is sent back to agent as JSON

## ArgoCD Version Information

The implementation was developed with:
- ArgoCD Version: v3.1.8+becb020
- Build Date: 2025-09-30T15:33:46Z
- Platform: linux/amd64


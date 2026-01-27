---
sidebar_position: 6
---

# A2UI Integration

## Overview

The CAIPE UI includes a custom implementation of the [A2UI (Agent-to-Agent UI) specification](https://a2ui.org/), enabling AI agents to generate rich, declarative user interfaces that render safely across the web interface without executing arbitrary code.

**Status**: The A2UI renderer is currently **dormant infrastructure** - fully implemented and tested, but not yet actively used in the main rendering pipeline. It's ready to be activated when agents need to generate declarative UIs beyond plain text responses.

## What is A2UI?

[A2UI](https://a2ui.org/) is a protocol developed by Google for agent-driven interfaces that solves the problem: **"How can AI agents safely send rich UIs across trust boundaries?"**

### Core Principles

From the [official A2UI specification](https://a2ui.org/):

1. **Secure by Design**: Declarative data format, not executable code. Agents can only use pre-approved components—no UI injection attacks.
2. **LLM-Friendly**: Flat, streaming JSON structure designed for easy generation by language models.
3. **Framework-Agnostic**: One agent response works everywhere (web, mobile, desktop).
4. **Progressive Rendering**: Stream UI updates as they're generated in real-time.

### How It Works

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│  Agent   │─────────│  A2UI    │─────────│  Client  │
│          │ Sends   │ Messages │ Renders │  (React) │
│  (LLM)   │─────────│  (JSON)  │─────────│   (UI)   │
└──────────┘         └──────────┘         └──────────┘
     │                     │                     │
     │  1. Generate A2UI   │                     │
     │     components      │                     │
     │─────────────────────>                     │
     │                     │                     │
     │                     │  2. Parse & map     │
     │                     │     to widgets      │
     │                     │─────────────────────>
     │                     │                     │
     │                     │  3. Render native   │
     │                     │     components      │
     │                     │                     │
```

## CAIPE's A2UI Implementation

### Architecture

The CAIPE UI implements a **custom React renderer** that follows the [A2UI v0.8 specification](https://a2ui.org/specification/v0.8-a2ui/):

```
ui/src/components/a2a/
├── A2UIRenderer.tsx          # Main renderer component
├── widgets/
│   ├── ButtonWidget.tsx      # Button component
│   ├── FormWidget.tsx        # Form component
│   ├── CardWidget.tsx        # Card component
│   ├── ListWidget.tsx        # List component
│   ├── TableWidget.tsx       # Table component
│   ├── ProgressWidget.tsx    # Progress bars
│   ├── SelectWidget.tsx      # Dropdowns
│   └── InputWidget.tsx       # Text inputs
└── WidgetCatalog.tsx         # Widget registry
```

### Protocol Types

The implementation defines A2UI protocol types that match the official specification:

```typescript
// A2UI Messages
interface A2UIMessage {
  surfaceUpdate?: A2UISurfaceUpdate;
  dataModelUpdate?: A2UIDataModelUpdate;
  beginRendering?: { surfaceId: string };
  deleteSurface?: { surfaceId: string };
}

// Surface: Container for UI components
interface A2UISurfaceUpdate {
  surfaceId: string;           // Unique surface identifier
  components: A2UIComponent[]; // Components to render
}

// Component: Individual UI element
interface A2UIComponent {
  id: string;                  // Component ID
  component: Record<string, unknown>; // Component spec
  position?: { x: number; y: number }; // Optional positioning
}

// Data Model: Reactive data binding
interface A2UIDataModelUpdate {
  contents: Record<string, unknown>; // Data updates
}
```

### Message Flow

```typescript
// Agent sends A2UI message
const a2uiMessage: A2UIMessage = {
  surfaceUpdate: {
    surfaceId: "main-surface",
    components: [
      {
        id: "deploy-button",
        component: {
          Button: {
            child: {
              Text: { text: { literalString: "Deploy to Production" } }
            },
            action: {
              name: "deploy",
              context: { app: "my-app", env: "prod" }
            }
          }
        }
      }
    ]
  }
};

// A2UIRenderer converts to CAIPE widgets
// Renders as React component with proper styling
```

## Supported Components

The A2UI renderer supports the standard A2UI component catalog:

### 1. Button

Interactive button with action handlers.

**A2UI Spec**:
```json
{
  "id": "action-btn",
  "component": {
    "Button": {
      "child": {
        "Text": { "text": { "literalString": "Execute" } }
      },
      "action": {
        "name": "execute_task",
        "context": { "taskId": "123" }
      }
    }
  }
}
```

**Rendered**: Material design button with click handler that sends action back to agent.

### 2. Text

Text display with optional usage hints (heading, paragraph, etc.).

**A2UI Spec**:
```json
{
  "id": "title",
  "component": {
    "Text": {
      "text": { "literalString": "Application Status" },
      "usageHint": "h1"
    }
  }
}
```

**Rendered**: Styled heading or text element based on `usageHint`.

### 3. Form

Input form with fields and submission.

**A2UI Spec**:
```json
{
  "id": "deploy-form",
  "component": {
    "Form": {
      "title": "Deployment Configuration",
      "fields": [
        {
          "name": "app_name",
          "label": "Application",
          "type": "text",
          "required": true
        },
        {
          "name": "environment",
          "label": "Environment",
          "type": "select",
          "options": ["dev", "staging", "prod"]
        }
      ],
      "submitAction": {
        "name": "deploy",
        "context": {}
      }
    }
  }
}
```

**Rendered**: Complete form with validation, styled inputs, and submit button.

### 4. List

Ordered or unordered list with optional status indicators.

**A2UI Spec**:
```json
{
  "id": "tasks",
  "component": {
    "List": {
      "title": "Deployment Steps",
      "ordered": true,
      "items": [
        { "id": "1", "text": "Build image", "status": "completed" },
        { "id": "2", "text": "Push to registry", "status": "in_progress" },
        { "id": "3", "text": "Deploy to cluster", "status": "pending" }
      ]
    }
  }
}
```

**Rendered**: Styled list with status icons (✓, ⏳, ⭕).

### 5. Table

Data table with headers and rows.

**A2UI Spec**:
```json
{
  "id": "apps-table",
  "component": {
    "Table": {
      "title": "ArgoCD Applications",
      "headers": ["Name", "Status", "Sync", "Health"],
      "rows": [
        ["app-1", "Active", "Synced", "Healthy"],
        ["app-2", "Active", "OutOfSync", "Degraded"]
      ]
    }
  }
}
```

**Rendered**: Responsive table with hover effects and proper spacing.

### 6. Progress

Progress bar or indicator.

**A2UI Spec**:
```json
{
  "id": "progress",
  "component": {
    "Progress": {
      "value": 75,
      "max": 100,
      "label": "Deployment Progress"
    }
  }
}
```

**Rendered**: Animated progress bar with percentage display.

### 7. Select

Dropdown selection menu.

**A2UI Spec**:
```json
{
  "id": "env-select",
  "component": {
    "Select": {
      "label": "Environment",
      "options": [
        { "value": "dev", "label": "Development" },
        { "value": "prod", "label": "Production" }
      ],
      "action": {
        "name": "environment_changed",
        "context": {}
      }
    }
  }
}
```

**Rendered**: Styled dropdown with change handler.

### 8. Input

Text input field.

**A2UI Spec**:
```json
{
  "id": "app-input",
  "component": {
    "Input": {
      "label": "Application Name",
      "placeholder": "my-app",
      "type": "text",
      "required": true,
      "action": {
        "name": "input_changed",
        "context": {}
      }
    }
  }
}
```

**Rendered**: Labeled input with validation indicators.

## Implementation Details

### Component Translation

The `a2uiToWidget` function maps A2UI components to CAIPE's widget system:

```typescript
function a2uiToWidget(component: A2UIComponent): Widget | null {
  const { id, component: spec } = component;

  // Detect component type from A2UI spec
  if ("Button" in spec) {
    const btn = spec.Button as {
      child?: { Text?: { text?: { literalString?: string } } };
      action?: { name: string; context?: Record<string, unknown> };
    };
    return {
      id,
      type: "button",
      props: {
        label: btn.child?.Text?.text?.literalString || "Button",
      },
      actions: btn.action ? [{ name: btn.action.name, context: btn.action.context }] : [],
    };
  }

  // ... similar mappings for other components

  return null; // Unknown component type
}
```

### Surface Management

Surfaces are containers that hold components:

```typescript
export function A2UIRenderer({ messages, onAction }: A2UIRendererProps) {
  const [surfaces, setSurfaces] = useState<Map<string, A2UIComponent[]>>(new Map());
  const [dataModel, setDataModel] = useState<Record<string, unknown>>({});
  const [activeSurface, setActiveSurface] = useState<string | null>(null);

  useEffect(() => {
    for (const msg of messages) {
      // Handle surface updates
      if (msg.surfaceUpdate) {
        const { surfaceId, components } = msg.surfaceUpdate;
        setSurfaces((prev) => {
          const updated = new Map(prev);
          const existing = updated.get(surfaceId) || [];
          // Merge components (update existing or add new)
          const merged = [...existing];
          for (const comp of components) {
            const idx = merged.findIndex((c) => c.id === comp.id);
            if (idx >= 0) {
              merged[idx] = comp; // Update
            } else {
              merged.push(comp); // Add
            }
          }
          updated.set(surfaceId, merged);
          return updated;
        });
        setActiveSurface(surfaceId);
      }

      // Handle data model updates
      if (msg.dataModelUpdate) {
        setDataModel((prev) => ({ ...prev, ...msg.dataModelUpdate!.contents }));
      }

      // Handle rendering lifecycle
      if (msg.beginRendering) {
        setActiveSurface(msg.beginRendering.surfaceId);
      }

      if (msg.deleteSurface) {
        setSurfaces((prev) => {
          const updated = new Map(prev);
          updated.delete(msg.deleteSurface!.surfaceId);
          return updated;
        });
      }
    }
  }, [messages]);

  // Render active surface
  // ...
}
```

### Progressive Rendering

Supports incremental updates as agents generate UI:

```typescript
// Agent sends initial surface
{
  surfaceUpdate: {
    surfaceId: "main",
    components: [{ id: "title", component: { Text: { ... } } }]
  }
}

// Agent adds more components (progressive rendering)
{
  surfaceUpdate: {
    surfaceId: "main",
    components: [{ id: "table", component: { Table: { ... } } }]
  }
}

// Agent updates existing component
{
  surfaceUpdate: {
    surfaceId: "main",
    components: [{ id: "table", component: { Table: { ...updated } } }]
  }
}
```

## Current Status

### Why Dormant?

The A2UI renderer is fully implemented but not currently active in the rendering pipeline for several reasons:

1. **A2A Protocol Artifacts**: CAIPE agents currently use A2A protocol artifacts (like `streaming_result`, `tool_notification_start`) which provide sufficient UI feedback for most use cases.

2. **Text-based Responses**: Most agent responses are text/markdown based, which render well with the existing markdown renderer.

3. **Widget System**: CAIPE has its own widget system for execution plans (TODO lists) and tool notifications that work well for the current use cases.

4. **Agent Implementation**: Agents would need to be updated to generate A2UI messages instead of plain text artifacts.

### Test Coverage

Current test coverage: **0%** (dormant code)

The implementation exists and was validated during development but is not covered by automated tests since it's not in the active code path.

### Ready for Activation

The A2UI renderer can be activated when:

1. **Agents generate A2UI messages**: Update agent prompts to emit A2UI components instead of plain text.
2. **Integration in message flow**: Add A2UI message detection in the main rendering pipeline.
3. **Use case demand**: Specific use cases that benefit from rich declarative UI (forms, tables, etc.).

## Activating A2UI

### Step 1: Update Agent Prompts

Modify agent system prompts to include A2UI generation instructions:

```python
AGENT_SYSTEM_PROMPT = """
You are an AI assistant that helps with platform engineering tasks.

When presenting structured data, you can generate A2UI components:

**Tables**: Use Table component for tabular data
{
  "artifact": {
    "name": "a2ui_update",
    "a2ui": {
      "surfaceUpdate": {
        "surfaceId": "main",
        "components": [{
          "id": "data-table",
          "component": {
            "Table": {
              "title": "Results",
              "headers": ["Column1", "Column2"],
              "rows": [["value1", "value2"]]
            }
          }
        }]
      }
    }
  }
}

**Forms**: Use Form component for user input
**Lists**: Use List component for task lists
...
"""
```

### Step 2: Integrate in Rendering Pipeline

Update `A2AStreamPanel.tsx` or `ChatPanel.tsx` to detect A2UI messages:

```typescript
import { A2UIRenderer } from './A2UIRenderer';

// In message rendering
function renderArtifact(artifact: Artifact) {
  // Check for A2UI artifact
  if (artifact.name === 'a2ui_update' && artifact.a2ui) {
    return (
      <A2UIRenderer
        messages={[artifact.a2ui]}
        onAction={(action) => {
          // Send action back to agent
          sendMessage({
            action: action.name,
            context: action.context
          });
        }}
      />
    );
  }

  // Existing rendering logic
  // ...
}
```

### Step 3: Test with Sample Use Case

Create a test agent that generates A2UI components:

```python
# Example: ArgoCD agent returns table instead of text
def list_applications(self):
    apps = self.get_applications()
    
    # Generate A2UI table
    a2ui_message = {
        "surfaceUpdate": {
            "surfaceId": "argocd-apps",
            "components": [{
                "id": "apps-table",
                "component": {
                    "Table": {
                        "title": "ArgoCD Applications",
                        "headers": ["Name", "Status", "Sync", "Health"],
                        "rows": [[app.name, app.status, app.sync, app.health] 
                                 for app in apps]
                    }
                }
            }]
        }
    }
    
    return {
        "artifact": {
            "name": "a2ui_update",
            "a2ui": a2ui_message
        }
    }
```

## Integration with A2A Protocol

A2UI messages can be embedded in A2A artifacts:

```json
{
  "jsonrpc": "2.0",
  "method": "task/artifact-update",
  "params": {
    "task_id": "task_123",
    "artifact": {
      "name": "a2ui_surface",
      "description": "Interactive deployment form",
      "a2ui": {
        "surfaceUpdate": {
          "surfaceId": "deploy-surface",
          "components": [
            {
              "id": "deploy-form",
              "component": {
                "Form": { ... }
              }
            }
          ]
        }
      }
    }
  }
}
```

## Comparison with A2A Artifacts

| Feature | A2A Artifacts | A2UI Components |
|---------|---------------|-----------------|
| **Format** | Text/markdown | Declarative UI JSON |
| **Use Case** | Progress updates, logs | Interactive forms, tables |
| **Streaming** | Append text chunks | Update components |
| **Interactivity** | Read-only | User actions (buttons, forms) |
| **Styling** | Markdown rendering | Native UI components |
| **Complexity** | Simple | Rich/structured |

**When to use each**:
- **A2A Artifacts**: Progress updates, tool notifications, streaming text responses
- **A2UI Components**: Data tables, input forms, interactive dashboards, multi-step wizards

## Benefits of A2UI

### Security

- **No Code Execution**: Only declarative data, not executable JavaScript
- **Sandboxed**: Agents can't inject malicious UI
- **Pre-approved Components**: Only allowed components render

### Developer Experience

- **Type-safe**: Full TypeScript types for all components
- **Consistent**: Same UI patterns across all agents
- **Testable**: Components can be unit tested

### User Experience

- **Rich Interactions**: Forms, tables, buttons vs plain text
- **Progressive**: UI builds incrementally as agent generates
- **Responsive**: Components adapt to screen size

## Relationship to Official A2UI

### Compliance with v0.8 Specification

CAIPE's A2UI implementation follows the [official v0.8 specification](https://a2ui.org/specification/v0.8-a2ui/):

✅ **Core Concepts**:
- Surfaces (UI containers)
- Components (declarative widgets)
- Data Model (reactive binding)
- Progressive rendering

✅ **Message Types**:
- `surfaceUpdate`
- `dataModelUpdate`
- `beginRendering`
- `deleteSurface`

✅ **Component Spec**:
- Standard components (Button, Text, Form, List, Table, Progress)
- Action handling
- Data binding

### Custom Implementation

CAIPE uses a **custom React renderer** rather than an official A2UI library because:

1. **Full Control**: Complete control over styling and behavior
2. **CAIPE Integration**: Seamless integration with existing widget system
3. **Performance**: No unnecessary abstractions
4. **Bundle Size**: Smaller production builds
5. **Flexibility**: Easy to extend with CAIPE-specific components

### Future Alignment

As the [A2UI specification evolves](https://a2ui.org/roadmap), CAIPE's implementation will:

- Track major version updates (v0.9, v1.0)
- Adopt new component types
- Maintain backward compatibility
- Contribute feedback to the A2UI community

## Resources

### Official A2UI

- **Website**: [https://a2ui.org/](https://a2ui.org/)
- **Specification**: [v0.8 Stable](https://a2ui.org/specification/v0.8-a2ui/)
- **GitHub**: [google/A2UI](https://github.com/google/A2UI)
- **Composer**: [Try A2UI Composer](https://a2ui.org/composer)

### CAIPE Implementation

- **Renderer**: `ui/src/components/a2a/A2UIRenderer.tsx`
- **Widget Catalog**: `ui/src/components/a2a/widgets/`
- **Types**: `ui/src/types/a2a.ts`
- **Constitution**: `ui/.specify/memory/constitution.md`

### Related Documentation

- [UI Features](features.md) - Overview of UI capabilities
- [A2A Protocol](../architecture/a2a-protocol.md) - A2A protocol details
- [Development Guide](development.md) - Contributing to the UI

## FAQ

### Why isn't A2UI active by default?

The current A2A artifact system (`streaming_result`, `tool_notification_start`, etc.) provides sufficient UI feedback for most use cases. A2UI will be activated when agents need richer interactive UIs (forms, complex tables, dashboards).

### How does A2UI differ from the widget system?

CAIPE's widget system is specific to execution plans (TODO lists) and tool notifications. A2UI is a general-purpose protocol for any UI component that agents want to render.

### Can I use A2UI with other protocols?

Yes! A2UI is transport-agnostic. While CAIPE embeds A2UI in A2A artifacts, you can use it with other message transports.

### Is this compatible with CopilotKit/AG-UI?

The implementation follows similar patterns but is custom-built for CAIPE. CopilotKit and AG-UI libraries are installed for reference but not actively used.

### What's next for A2UI in CAIPE?

Future plans include:
- Activating A2UI for specific use cases (deployment dashboards, incident forms)
- Adding more component types (charts, graphs)
- Agent prompt templates for A2UI generation
- Integration with multi-agent workflows

---

**Status**: Documentation current as of 2026-01-27 | A2UI v0.8 | CAIPE UI v0.1.0

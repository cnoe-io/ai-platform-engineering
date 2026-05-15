---
sidebar_position: 2
---

# Features and Components

The CAIPE UI provides a rich set of features designed to make interacting with AI agents intuitive, powerful, and efficient.

## Core Features

### 1. 3-Panel Layout

The UI features an innovative 3-panel design that provides simultaneous views of different aspects of agent interaction:

```
┌──────────────┬─────────────────────┬──────────────────┐
│   Sidebar    │    Chat Panel       │  Context Panel   │
│              │                     │                  │
│  Use Cases   │  Chat History       │  A2A Messages    │
│  Gallery     │  Message Input      │  Event Stream    │
│  Navigation  │  Final Output       │  Inspection      │
│              │                     │                  │
└──────────────┴─────────────────────┴──────────────────┘
```

**Benefits**:
- **Context Awareness**: See agent reasoning while chatting
- **Transparency**: Full visibility into A2A protocol events
- **Efficiency**: Quick access to use cases without leaving the conversation

### 2. Use Cases Gallery

A curated collection of pre-built scenarios for common platform engineering tasks.

#### Categories

**Deployment Management**
- Check ArgoCD application status
- Sync deployment across environments
- Rollback failed deployments
- Monitor deployment pipelines

**Incident Response**
- Investigate active incidents (PagerDuty)
- Root cause analysis (multi-agent)
- Post-incident reports
- On-call handoff automation

**Development Workflows**
- Review open pull requests (GitHub)
- Code review automation
- Security vulnerability scanning
- Sprint progress tracking (Jira)

**Cloud Operations**
- AWS cost analysis and optimization
- Cluster resource health checks
- Infrastructure drift detection
- Compliance auditing

**Knowledge Management**
- Documentation search (RAG)
- Technical knowledge queries
- Runbook automation
- Training material generation

#### Creating Custom Use Cases

```typescript
interface UseCase {
  id: string;
  title: string;
  description: string;
  category: 'deployment' | 'incident' | 'development' | 'cloud' | 'other';
  tags: string[];
  prompt: string;
  expectedAgents: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
```

**Example**:

```json
{
  "title": "Check Deployment Status",
  "description": "Quickly check the sync status and health of ArgoCD applications",
  "category": "deployment",
  "tags": ["argocd", "kubernetes", "deployment"],
  "prompt": "Check the status of all ArgoCD applications in the production namespace",
  "expectedAgents": ["argocd"],
  "difficulty": "beginner"
}
```

### 3. Interactive Chat Interface

The chat panel provides a natural language interface for communicating with AI agents.

#### Features

- **Markdown Rendering**: Rich text formatting for responses
- **Code Highlighting**: Syntax highlighting for code blocks
- **Message History**: Persistent conversation history
- **Copy to Clipboard**: Easy code/text copying
- **Message Reactions**: React to agent responses
- **Streaming Output**: Real-time response streaming

#### Message Types

| Type | Description | Icon |
|------|-------------|------|
| User Message | User input/queries | 👤 |
| Assistant Message | Agent responses | 🤖 |
| System Message | Status updates | ⚙️ |
| Error Message | Error notifications | ❌ |
| Tool Output | Tool execution results | 🔧 |

### 4. A2A Protocol Visualization

Real-time visualization of Agent-to-Agent protocol messages provides transparency into multi-agent workflows.

#### Event Types

**Task Events** (`event.kind: "task"`)
```json
{
  "kind": "task",
  "data": {
    "state": "running",
    "session_id": "...",
    "task_id": "..."
  }
}
```

**Artifact Updates** (`event.kind: "artifact-update"`)
```json
{
  "kind": "artifact-update",
  "data": {
    "artifact": {
      "name": "streaming_result",
      "text": "Checking ArgoCD applications...",
      "append": true
    }
  }
}
```

**Status Updates** (`event.kind: "status-update"`)
```json
{
  "kind": "status-update",
  "data": {
    "final": true,
    "state": "completed",
    "result": { ... }
  }
}
```

#### Artifact Types

| Artifact Name | Purpose | Visual Treatment |
|---------------|---------|------------------|
| `streaming_result` | Incremental text output | 📡 Radio icon, appends to existing |
| `partial_result` | Complete chunk | 📄 FileText icon, replaces content |
| `final_result` | Final response | ✅ CheckCircle icon, final output |
| `tool_notification_start` | Tool execution begins | 🔧 Wrench icon, blue highlight |
| `tool_notification_end` | Tool completes | ☑️ CheckSquare icon, green highlight |
| `execution_plan_update` | TODO plan changes | 📋 ListTodo icon, plan view |
| `execution_plan_status_update` | TODO status changes | 📊 Progress update |

### 5. A2UI Widget Support

The UI implements custom widgets following the [A2UI specification](https://a2ui.org/) for declarative UI components that agents can render. This is a custom implementation inspired by A2UI v0.8 standards, not using the AG-UI or CopilotKit libraries directly.

**Status**: The A2UI renderer is fully implemented but currently dormant. See [A2UI Integration Guide](a2ui-integration.md) for detailed documentation on implementation, activation, and usage.

#### Available Widgets

**Button Widget**
```json
{
  "type": "button",
  "text": "Deploy to Production",
  "variant": "primary",
  "action": {
    "type": "execute_agent",
    "agent": "argocd",
    "params": { "action": "sync", "app": "my-app" }
  }
}
```

**Form Widget**
```json
{
  "type": "form",
  "fields": [
    {
      "name": "app_name",
      "label": "Application Name",
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
  "submit": {
    "text": "Deploy",
    "action": { ... }
  }
}
```

**Card Widget**
```json
{
  "type": "card",
  "title": "Application Status",
  "variant": "outline",
  "content": {
    "status": "Healthy",
    "sync": "Synced",
    "health": "Progressing"
  }
}
```

**Table Widget**
```json
{
  "type": "table",
  "headers": ["Name", "Status", "Sync", "Health"],
  "rows": [
    ["app-1", "Active", "Synced", "Healthy"],
    ["app-2", "Active", "OutOfSync", "Degraded"]
  ]
}
```

**List Widget**
```json
{
  "type": "list",
  "style": "ordered",
  "items": [
    { "text": "Check application health", "status": "completed" },
    { "text": "Verify resource sync", "status": "in_progress" },
    { "text": "Generate report", "status": "pending" }
  ]
}
```

**Progress Widget**
```json
{
  "type": "progress",
  "value": 75,
  "max": 100,
  "label": "Deployment Progress"
}
```

### 6. Message Inspection

Deep-dive into any A2A message for debugging and understanding.

#### Inspection Features

- **JSON Pretty Print**: Formatted JSON with syntax highlighting
- **Expandable Sections**: Collapse/expand nested objects
- **Copy to Clipboard**: Copy individual fields or entire messages
- **Timestamp Display**: Precise timing information
- **Event Filtering**: Filter by event kind, artifact name, or agent
- **Search**: Search within message payloads

#### Inspection Panel

```
┌────────────────────────────────────────┐
│ Event Details                          │
├────────────────────────────────────────┤
│ Kind: artifact-update                  │
│ Timestamp: 2026-01-27T10:30:45.123Z   │
│ Session ID: abc123...                  │
│ Task ID: task_456...                   │
├────────────────────────────────────────┤
│ Artifact                               │
│ ├─ name: tool_notification_start       │
│ ├─ description: Calling ArgoCD API     │
│ └─ data: { ... }                       │
└────────────────────────────────────────┘
```

### 7. Real-time Streaming

Server-Sent Events (SSE) provide real-time updates without polling.

#### Stream Features

- **Auto-reconnect**: Automatically reconnects on connection loss
- **Buffering**: Handles rapid message bursts
- **Filtering**: Client-side filtering of event types
- **Performance**: Efficient rendering of high-frequency updates
- **Backpressure**: Graceful handling of slow consumers

#### Stream Status Indicators

| Status | Indicator | Meaning |
|--------|-----------|---------|
| Connected | 🟢 Green dot | Active stream connection |
| Connecting | 🟡 Yellow pulse | Attempting connection |
| Disconnected | 🔴 Red dot | No connection |
| Error | ⚠️ Warning | Stream error occurred |

### 8. Authentication and Authorization

Secure access control with OAuth 2.0 integration.

#### Authentication Flow

```
User → Login Page → OAuth Provider → Token Exchange → Authenticated Session
```

#### Features

- **OAuth 2.0**: Industry-standard authentication
- **Token Management**: Automatic refresh and rotation
- **Secure Storage**: HttpOnly cookies for tokens
- **Session Persistence**: Resume sessions across browser restarts
- **Role-based Access**: Fine-grained permissions (coming soon)

#### Development Mode

For local development without OAuth:

```bash
# Skip authentication
export SKIP_AUTH=true
npm run dev
```

### 9. Theme and Customization

Modern, customizable UI with dark mode support.

#### Themes

- **Light Mode**: Clean, professional light theme
- **Dark Mode**: Eye-friendly dark theme
- **System**: Automatically matches OS preference
- **Custom**: Define your own color schemes (coming soon)

#### Customization

```typescript
// Tailwind theme configuration
{
  colors: {
    primary: 'hsl(var(--primary))',
    secondary: 'hsl(var(--secondary))',
    accent: 'hsl(var(--accent))',
    // ...
  }
}
```

### 10. Performance Optimizations

Built for speed and efficiency.

#### Optimizations

- **Code Splitting**: Lazy-load components
- **Memoization**: React.memo for expensive components
- **Virtual Scrolling**: Efficient rendering of large message lists
- **Debouncing**: Throttle rapid user inputs
- **Caching**: Cache API responses and static assets
- **Bundle Size**: Optimized production builds

#### Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| First Contentful Paint | < 1.5s | ~1.2s |
| Time to Interactive | < 3.0s | ~2.5s |
| Largest Contentful Paint | < 2.5s | ~2.0s |
| Bundle Size | < 500kb | ~450kb |

## Component Library

### Shared UI Components

Built with Radix UI primitives and styled with Tailwind CSS.

- **Button**: Multiple variants (default, destructive, outline, ghost)
- **Card**: Content containers with header, body, footer
- **Dialog**: Modal dialogs and popups
- **Dropdown**: Context menus and dropdowns
- **Input**: Text inputs with validation
- **Select**: Dropdown selectors
- **Switch**: Toggle switches
- **Textarea**: Multi-line text inputs
- **Toast**: Notification toasts
- **Tooltip**: Hover tooltips

### Layout Components

- **Sidebar**: Collapsible navigation sidebar
- **Header**: Top navigation bar
- **Footer**: Page footer
- **Container**: Responsive content containers
- **Grid**: Responsive grid layouts

### Custom Components

- **ChatPanel**: Main chat interface
- **MessageList**: Scrollable message history
- **ChatInput**: Message input with send button
- **UseCasesGallery**: Grid of use case cards
- **A2AStreamPanel**: Real-time event stream
- **A2UIRenderer**: Widget renderer
- **ContextPanel**: Collapsible right panel
- **AgentStreamBox**: Agent-specific streaming display

## Keyboard Shortcuts

Power-user features for efficiency.

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + Enter` | Send message |
| `Ctrl/Cmd + K` | Open command palette |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Ctrl/Cmd + /` | Toggle context panel |
| `Ctrl/Cmd + T` | Toggle theme |
| `Escape` | Close dialogs/modals |
| `↑` / `↓` | Navigate message history |
| `Tab` | Cycle focus |

## Accessibility

WCAG 2.1 AA compliant features:

- **Keyboard Navigation**: Full keyboard support
- **Screen Reader**: ARIA labels and roles
- **Focus Indicators**: Visible focus states
- **Color Contrast**: Meets contrast requirements
- **Alt Text**: Descriptive image alternatives
- **Semantic HTML**: Proper heading hierarchy

## Technology Choices & Implementation

### Protocol Implementation Approach

The CAIPE UI follows an **implementation-over-library** approach for key protocols:

#### A2A Protocol
- **Specification**: Google's Agent-to-Agent protocol
- **Implementation**: Official `@a2a-js/sdk` (v0.3.9+) via `A2ASDKClient` wrapper
- **Why SDK**: Standards-compliant, maintained by A2A community, full protocol support
- **Wrapper Benefits**: Tailored for CAIPE's UI needs while maintaining SDK compatibility
- **Location**: `ui/src/lib/a2a-sdk-client.ts`

#### A2UI & AG-UI
- **Specifications**: [A2UI v0.8](https://a2ui.org/) declarative UI spec, AG-UI interaction patterns
- **Implementation**: Custom widget components in `components/a2a/widgets/`
- **Why Custom**: Full control over styling, behavior, and integration with CAIPE's design system
- **Not using**: `@copilotkit/react-ui` or `@ag-ui/client` libraries (installed for reference)
- **Documentation**: See [A2UI Integration Guide](a2ui-integration.md) for complete details

#### Benefits of Custom Implementation
1. **Performance**: No unnecessary abstractions or unused features
2. **Flexibility**: Easy to extend and customize for CAIPE-specific needs
3. **Maintainability**: Full understanding and control of the codebase
4. **Bundle Size**: Smaller production builds
5. **Standards Compliance**: Can still follow specifications without library lock-in

### Architecture Decisions

**State Management**: Zustand chosen over Redux/Context for:
- Simpler API with less boilerplate
- Better TypeScript support
- Smaller bundle size
- Easier testing

**Styling**: Tailwind CSS chosen for:
- Utility-first approach speeds development
- Consistent design system
- Excellent dark mode support
- Tree-shaking for production

**Components**: Radix UI primitives for:
- Accessibility out-of-the-box
- Unstyled (full control over appearance)
- Composable and flexible
- Well-maintained and documented

## Browser Support

- **Chrome**: 90+ ✅
- **Firefox**: 88+ ✅
- **Safari**: 14+ ✅
- **Edge**: 90+ ✅
- **Mobile**: iOS Safari 14+, Chrome Android 90+ ✅

## Next Steps

- [Configuration Guide](configuration.md)
- [Development Guide](development.md)
- [API Reference](api-reference.md)
- [Troubleshooting](troubleshooting.md)

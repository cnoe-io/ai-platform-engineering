# CAIPE UI Constitution

## Core Principles

### I. A2A Protocol Conformance
All agent communication follows the A2A (Agent-to-Agent) protocol specification:
- JSON-RPC 2.0 over SSE for streaming
- Proper contextId handling for conversation continuity
- Support for artifacts, status updates, and task management

### II. AG-UI & A2UI Integration
UI follows modern agent-user interaction patterns:
- Streaming output with real-time updates
- Execution plan visualization with task checkboxes
- Widget support for agent-rendered UI components
- Declarative A2UI specification support

### III. Component-Driven Architecture
React components are:
- Self-contained and reusable
- Use Tailwind CSS for styling
- Follow shadcn/ui patterns
- Support theming (light/dark/midnight/nord/tokyo)

### IV. State Management
Application state managed via:
- Zustand for global state (chat-store)
- localStorage persistence for conversations
- Per-conversation streaming state
- Proper hydration handling

### V. Authentication & Security
- OIDC SSO support via NextAuth
- Group-based authorization (configurable claim)
- JWT Bearer token for A2A requests
- Proper session management

## Technology Stack

- **Framework**: Next.js 16.x with App Router
- **UI Library**: React 19.x
- **Styling**: Tailwind CSS 4.x
- **State**: Zustand with persist middleware
- **Auth**: NextAuth.js with OIDC provider
- **Icons**: Lucide React + Custom SVG logos
- **Animation**: Framer Motion

## Feature Categories

### Chat System
- Multi-conversation support with history
- Message feedback (thumbs up/down)
- Copy buttons for messages
- Markdown rendering with syntax highlighting
- Agent selection via custom call buttons

### Execution Visualization
- Task list with interactive checkboxes
- Progress bar with completion percentage
- Official agent logos (ArgoCD, AWS, GitHub, etc.)
- Real-time status updates

### A2A Debug
- Full event stream inspection
- Raw JSON viewing
- Event filtering by type
- Auto-scroll during streaming

### Gallery
- Use case showcase
- Quick-start prompts
- Integration demonstrations

## Governance

Constitution supersedes all other practices. Amendments require:
1. Documentation in spec
2. Approval via PR review
3. Migration plan if breaking

All changes must be:
- Committed incrementally
- Spec Kit updated with each feature
- DCO signed

**Version**: 1.0.0 | **Ratified**: 2026-01-17 | **Last Amended**: 2026-01-17

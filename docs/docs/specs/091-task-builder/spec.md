---
sidebar_position: 2
sidebar_label: Specification
---

# Spec: Task Builder — Visual Workflow Editor with MongoDB Persistence

## Overview

Build a visual Task Builder UI for creating and managing `task_config.yaml`-style self-service workflows, persist them in MongoDB (`task_configs` collection), and modify the supervisor agent to read task configs from MongoDB instead of the YAML file. On first boot, the existing `task_config.yaml` seeds MongoDB; after that, MongoDB is the source of truth.

## Motivation

Currently there is a disconnect between the UI and the supervisor:

- The **UI** has an Agent Builder / Skills Builder that saves workflow configs to MongoDB (`agent_configs` collection), but the supervisor never reads from it.
- The **supervisor** (`deep_agent_single.py`) reads workflows exclusively from `task_config.yaml` on disk via `load_task_config()`.
- There is **no bridge** between them — workflows created in the UI are not available to `invoke_self_service_task`.

This means:
1. Adding or editing a workflow requires modifying `task_config.yaml`, rebuilding the Helm chart, and redeploying.
2. Non-developer users cannot create custom self-service workflows.
3. The UI and backend have divergent workflow inventories.

The Task Builder feature solves this by:
- Providing a visual flow editor for building multi-step workflows with `@xyflow/react`.
- Storing all task configs in a dedicated MongoDB collection (`task_configs`).
- Making the supervisor read from MongoDB (with YAML as fallback), so newly created workflows are immediately available without redeployment.

## Scope

### In Scope
- **MongoDB `task_configs` collection**: New collection with schema mirroring `task_config.yaml` structure plus metadata (owner, visibility, timestamps).
- **YAML seeding**: On first boot, seed MongoDB from the bundled `task_config.yaml` as `is_system: true` documents. Idempotent — skip if collection is non-empty.
- **Next.js API** (`/api/task-configs`): Full CRUD (GET, POST, PUT, DELETE) plus `/api/task-configs/seed` and YAML export (`?format=yaml`).
- **Zustand store** (`task-config-store.ts`): Client-side state management for task configs.
- **Visual Task Builder UI** (`/task-builder`): Flow-based editor using `@xyflow/react` with custom node types (UserInput, Generate, Output), sidebar property editor, save/export/import.
- **Navigation update**: Add "Task Builder" to the app sidebar/header.
- **Supervisor MongoDB integration**: Modify `load_task_config()` in `deep_agent_single.py` to read from MongoDB via pymongo (with in-memory TTL cache), falling back to YAML.
- **Shared pymongo client**: New `ai_platform_engineering/utils/mongodb_client.py` singleton.
- **Documentation**: Spec (this document) and ADR.

### Out of Scope
- Replacing or modifying the existing Agent Builder / Skills Builder (those remain as-is for skill/quick-start template management).
- Real-time collaboration / multi-user editing of the same workflow.
- Version history / diff for task configs (future).
- Workflow execution preview / dry-run from the builder UI (future).
- Migrating existing `agent_configs` data into `task_configs` (they serve different purposes).

## Design

### Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  First Boot                                                     │
│  task_config.yaml ──seed──▶ MongoDB (task_configs collection)   │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Next.js UI                                                     │
│  Task Builder (visual flow editor)                              │
│       │                                                         │
│       ▼                                                         │
│  /api/task-configs (CRUD) ──▶ MongoDB (task_configs)            │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  Python Supervisor                                              │
│  deep_agent_single.py                                           │
│       │                                                         │
│       ├──pymongo──▶ MongoDB (task_configs)  [primary]           │
│       └──fallback──▶ task_config.yaml       [if MongoDB down]   │
└────────────────────────────────────────────────────────────────┘
```

### Data Model

**MongoDB `task_configs` collection:**

```typescript
interface TaskConfig {
  id: string;                    // unique ID (e.g., "task-config-<timestamp>-<random>")
  name: string;                  // workflow name, unique (e.g., "Create GitHub Repo")
  category: string;              // e.g., "GitHub Operations", "AWS Operations"
  description?: string;
  tasks: TaskStep[];             // ordered list of workflow steps
  owner_id: string;              // "system" for YAML-seeded, user email for custom
  is_system: boolean;            // true for YAML-seeded configs
  visibility: "private" | "team" | "global";
  shared_with_teams?: string[];
  metadata?: {
    env_vars_required?: string[];
    estimated_duration?: string;
    tags?: string[];
  };
  created_at: Date;
  updated_at: Date;
}

interface TaskStep {
  display_text: string;          // UI label (e.g., "Collect repository details")
  llm_prompt: string;            // LLM instructions with ${VAR} substitution
  subagent: string;              // target subagent (caipe, github, backstage, etc.)
}
```

**Indexes:**
- `name`: unique
- `category`: non-unique
- `owner_id`: non-unique
- `is_system`: non-unique
- `created_at`: non-unique (descending)

### Task Builder UI Design

The Task Builder uses `@xyflow/react` (already a project dependency) for a visual flow canvas:

**Node types** (color-coded):
- **UserInput** (yellow): `subagent: "caipe"` — collects user input via forms
- **Generate** (purple): processing subagents (github, backstage, jira, aws, argocd, aigateway)
- **Output** (green): notification/completion steps (webex, jira close)

**Layout:**
- Left: Step Templates palette (searchable, categorized, 154 draggable tool templates) + flow canvas with connected task step nodes (S-curve layout, bezier edges)
- Right: sidebar property editor for the selected node (display_text, llm_prompt code editor or CAIPE Form Builder, subagent selector); Environment variable panel
- Top: two-row toolbar with workflow metadata (name, category, description), grouped Import/Preview/Download bar, save

**UX flow:**
1. User opens `/task-builder`, sees empty canvas with "Add Step" button (or picks a workflow template)
2. Add nodes via drag-and-drop from Step Templates palette or "Add Step"; each represents a task step with display_text, subagent badge
3. Connect nodes to define linear execution order (S-curve layout with bezier edges)
4. Click a node to edit its properties in the sidebar (or CAIPE Form Builder for `caipe` subagent steps)
5. Set workflow name, category, description in the toolbar
6. Save → POST `/api/task-configs` → MongoDB
7. Workflow is immediately available to the supervisor

**UX Enhancements (post-initial implementation):**

- **S-curve node layout**: Nodes alternate left-right in an S-curve pattern with bezier curved edges instead of a straight vertical line.
- **Step Templates palette**: Left sidebar with 154 draggable tool templates from all integrated agents (CAIPE, GitHub, Jira, Webex, ArgoCD, AWS, AI Gateway, Backstage, Slack, PagerDuty, Splunk, Komodor, Confluence), searchable, categorized, with drag-and-drop onto canvas.
- **CAIPE Form Builder**: Structured form editor for `caipe` subagent steps.
- **File I/O visualization**: Nodes show file read/write badges extracted from `llm_prompt`; edges between nodes sharing files are highlighted green.
- **Environment variable panel**: Shows env vars referenced in workflow with step locations.
- **Unsaved changes guard**: In-app styled dialog (not browser confirm) when navigating away with unsaved changes; works on Back button AND header tab navigation via Zustand global store + `GuardedLink` wrapper in AppHeader.
- **Import dialog**: Load saved configs from MongoDB, upload YAML file, or import from raw HTTP URL.
- **YAML preview dialog**: Syntax-highlighted YAML preview with copy/download, line numbers.
- **YAML export**: Download uses YAML format (js-yaml) instead of JSON.
- **Workflow templates**: Template picker dialog when creating new workflow.
- **Clone workflow**: Clone button on existing workflow cards.
- **Theme-aware nodes**: Nodes use dark vibrant colors in dark mode, pastel colors in light mode via `useTheme()` runtime detection.
- **Custom canvas controls**: Replaced React Flow default Controls with custom Panel-based controls using primary theme color.
- **Toolbar redesign**: Two-row layout with grouped Import/Preview/Download button bar to prevent overflow.
- **Scrollbar fix**: Transparent track with thin rounded thumb globally.

### Supervisor Integration

`load_task_config()` in `deep_agent_single.py` is modified to:
1. Check if `MONGODB_URI` is set
2. If yes, query MongoDB `task_configs` collection via pymongo, transform documents into the dict format expected by `invoke_self_service_task`
3. Cache results in-memory with configurable TTL (default 60s) to avoid per-request DB queries
4. If MongoDB is unavailable or returns empty, fall back to reading `task_config.yaml`

### Components Affected
- [ ] Multi-Agents (`ai_platform_engineering/multi_agents/`) — `deep_agent_single.py` (modify `load_task_config()`)
- [ ] Utils (`ai_platform_engineering/utils/`) — new `mongodb_client.py`
- [ ] UI (`ui/`) — new `/task-builder` page, components, Zustand store, API routes, types
- [ ] Documentation (`docs/`) — ADR
- [ ] Helm Charts (`charts/`) — no changes needed (YAML remains for seeding)

## Acceptance Criteria

### MongoDB & API
- [ ] `task_configs` collection created with proper indexes on first connection
- [ ] YAML seeding populates MongoDB with all existing workflows as `is_system: true` (idempotent)
- [ ] GET `/api/task-configs` returns all visible task configs (system + user's own + shared)
- [ ] POST `/api/task-configs` creates a new task config with validation
- [ ] PUT `/api/task-configs?id=<id>` updates (owner or admin only)
- [ ] DELETE `/api/task-configs?id=<id>` deletes (owner or admin, not system configs)
- [ ] GET `/api/task-configs?format=yaml` exports in `task_config.yaml` format
- [ ] Auth middleware enforced on all endpoints

### Task Builder UI
- [ ] `/task-builder` page renders a flow canvas with `@xyflow/react`
- [ ] Users can add, remove, and reorder task step nodes
- [ ] Each node displays display_text, subagent badge, and connection handles
- [ ] Clicking a node opens a sidebar editor with display_text input, llm_prompt code editor, subagent selector
- [ ] Workflow metadata (name, category, description) editable in toolbar
- [ ] Save persists to MongoDB via API
- [ ] Import from YAML parses `task_config.yaml` format into nodes
- [ ] Export to YAML generates valid `task_config.yaml` format
- [ ] "Task Builder" link appears in app navigation
- [ ] S-curve node layout with bezier curved edges
- [ ] Step Templates palette (left sidebar) with 154 draggable tool templates, searchable and categorized
- [ ] CAIPE Form Builder for structured editing of `caipe` subagent steps
- [ ] File I/O visualization: file read/write badges on nodes, green-highlighted edges for shared files
- [ ] Environment variable panel showing referenced env vars with step locations
- [ ] Unsaved changes guard: in-app styled dialog on Back button and header tab navigation
- [ ] Import dialog: load from MongoDB, upload YAML, or import from HTTP URL
- [ ] YAML preview dialog with syntax highlighting, copy/download, line numbers
- [ ] YAML export (js-yaml) instead of JSON
- [ ] Workflow templates picker when creating new workflow
- [ ] Clone workflow button on workflow cards
- [ ] Theme-aware nodes (dark vibrant / light pastel via useTheme)
- [ ] Custom canvas controls using primary theme color
- [ ] Two-row toolbar with grouped Import/Preview/Download bar
- [ ] Global scrollbar: transparent track, thin rounded thumb

### Supervisor Integration
- [ ] `load_task_config()` reads from MongoDB when `MONGODB_URI` is set
- [ ] Results are cached in-memory with configurable TTL
- [ ] Falls back to YAML when MongoDB is unavailable
- [ ] `invoke_self_service_task` works with MongoDB-sourced configs identically to YAML-sourced ones
- [ ] Environment variable substitution (`${VAR_NAME}`) still works

### Documentation
- [ ] Spec created (this document)
- [ ] ADR created with decision rationale

## Implementation Plan

### Phase 1: Types, MongoDB, and API
- [ ] Create `ui/src/types/task-config.ts` with TaskConfig, TaskStep interfaces
- [ ] Add `task_configs` collection indexes in `ui/src/lib/mongodb.ts`
- [ ] Create `ui/src/app/api/task-configs/route.ts` (CRUD)
- [ ] Create `ui/src/app/api/task-configs/seed/route.ts` (YAML seeding)
- [ ] Create `ui/src/store/task-config-store.ts` (Zustand store)

### Phase 2: Visual Task Builder UI
- [ ] Create `ui/src/app/(app)/task-builder/page.tsx` (main page)
- [ ] Create `ui/src/components/task-builder/TaskBuilderCanvas.tsx` (React Flow canvas)
- [ ] Create `ui/src/components/task-builder/TaskStepNode.tsx` (custom node)
- [ ] Create `ui/src/components/task-builder/TaskBuilderSidebar.tsx` (property editor)
- [ ] Create `ui/src/components/task-builder/TaskBuilderToolbar.tsx` (top bar)
- [ ] Create `ui/src/components/task-builder/SubagentSelector.tsx` (dropdown)
- [ ] Add "Task Builder" to navigation in `AppHeader.tsx`

### Phase 2.5: UX Enhancements
- [ ] Implement S-curve node layout with bezier edges
- [ ] Create `StepPalette.tsx` with 154 draggable tool templates, search, categories
- [ ] Create `step-templates.ts` data for all integrated agents
- [ ] Create `CaipeFormBuilder.tsx` for structured `caipe` subagent step editing
- [ ] Add file I/O badges to nodes, green-highlight edges for shared files
- [ ] Create `EnvVarsPanel.tsx` for env var references with step locations
- [ ] Create `unsaved-changes-store.ts` and `GuardedLink` wrapper
- [ ] Create `UnsavedChangesDialog.tsx` (in-app styled, not browser confirm)
- [ ] Create `ImportDialog.tsx` (MongoDB, YAML upload, HTTP URL)
- [ ] Create `YamlPreviewDialog.tsx` with syntax highlighting, copy/download
- [ ] Switch export to YAML (js-yaml) instead of JSON
- [ ] Create `WorkflowTemplateDialog.tsx` for template picker
- [ ] Add clone workflow button on workflow cards
- [ ] Theme-aware node colors via `useTheme()`
- [ ] Custom canvas controls (Panel-based, primary theme color)
- [ ] Two-row toolbar redesign with grouped Import/Preview/Download
- [ ] Global scrollbar styling (transparent track, thin rounded thumb)

### Phase 3: Supervisor MongoDB Integration
- [ ] Create `ai_platform_engineering/utils/mongodb_client.py` (shared pymongo singleton)
- [ ] Modify `load_task_config()` in `deep_agent_single.py` for MongoDB-first with YAML fallback
- [ ] Add in-memory TTL cache for task config reads

### Phase 4: Documentation
- [ ] Create ADR at [2026-03-03-task-builder-mongodb](../080-task-builder-mongodb/architecture.md)

## Testing Strategy

- **Unit tests**: API route handlers (CRUD validation, auth, seeding), Zustand store actions, pymongo client, modified `load_task_config()` with MongoDB/YAML fallback
- **Integration tests**: End-to-end flow from UI save → MongoDB → supervisor read
- **Manual verification**: Create a workflow in the Task Builder UI, verify it appears in the supervisor's available tasks, execute it via chat
- **UX verification**: Step palette drag-and-drop, CAIPE Form Builder, file I/O visualization, env vars panel, unsaved changes guard (Back + tab nav), import (MongoDB/YAML/URL), YAML preview/export, workflow templates, clone, theme-aware nodes, custom controls, toolbar layout, scrollbar styling

## Rollout Plan

1. Deploy with YAML seeding on first boot — existing workflows available immediately
2. Users can create new workflows via the Task Builder UI
3. System workflows (`is_system: true`) are protected from deletion
4. Future: version history, workflow templates gallery, dry-run preview

## Related

- ADR: [2026-03-03-task-builder-mongodb](../080-task-builder-mongodb/architecture.md)
- Existing task_config.yaml: `charts/ai-platform-engineering/data/task_config.yaml`
- Existing Agent Builder: `ui/src/components/agent-builder/`
- Supervisor entry point: `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py`

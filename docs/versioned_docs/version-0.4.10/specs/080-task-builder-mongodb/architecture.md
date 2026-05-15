---
sidebar_position: 1
id: 080-task-builder-mongodb-architecture
sidebar_label: Architecture
---

# Architecture: Task Builder — Visual Workflow Editor with MongoDB Persistence

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **New Task Builder UI + MongoDB collection (chosen)** | Clean separation from Agent Builder; visual flow editor; MongoDB as single source of truth; supervisor reads directly via pymongo | New collection and API routes to maintain | Selected |
| Extend Agent Builder to write task_config.yaml | Reuses existing UI | Conflates two different config models; file-based flow is fragile | Rejected |
| YAML editor in UI | Simple to build | Poor UX for non-developers; still requires understanding YAML syntax | Rejected |


## Solution Architecture

### Data Flow

```
First boot:
  task_config.yaml → /api/task-configs/seed → MongoDB (task_configs)

UI editing:
  Task Builder UI → /api/task-configs (CRUD) → MongoDB (task_configs)

Supervisor reads:
  load_task_config() → pymongo (primary, cached 60s) → YAML file (fallback)
```

### Components

- **MongoDB `task_configs` collection** — Stores workflow definitions with indexes on `id` (unique), `name` (unique), `category`, `owner_id`, `is_system`, and `created_at`.
- **Next.js API routes** — `/api/task-configs` (CRUD) and `/api/task-configs/seed` (YAML seeding). Auth-protected with ownership/admin checks.
- **Zustand store** — `task-config-store.ts` manages client-side state with auto-seeding on first load.
- **Task Builder UI** — `@xyflow/react`-based visual flow editor at `/task-builder` with custom TaskStepNode components, property sidebar, and toolbar.
- **Shared pymongo client** — `ai_platform_engineering/utils/mongodb_client.py` singleton with `get_task_configs_from_mongodb()` returning task_config.yaml-compatible dict format.
- **Modified `load_task_config()`** — Reads from MongoDB when `MONGODB_URI` is set (with 60s TTL cache), falls back to YAML file.

### UX Enhancements (post-initial implementation)

The following UX improvements were added after the initial Task Builder implementation:

1. **S-curve node layout** — Nodes alternate left-right in an S-curve pattern with bezier curved edges instead of a straight vertical line.
2. **Step Templates palette** — Left sidebar (`StepPalette.tsx`) with 154 draggable tool templates from all integrated agents (CAIPE, GitHub, Jira, Webex, ArgoCD, AWS, AI Gateway, Backstage, Slack, PagerDuty, Splunk, Komodor, Confluence), searchable, categorized, with drag-and-drop onto canvas. Data in `step-templates.ts`.
3. **CAIPE Form Builder** — Structured form editor (`CaipeFormBuilder.tsx`) for `caipe` subagent steps.
4. **File I/O visualization** — Nodes show file read/write badges extracted from `llm_prompt`; edges between nodes sharing files are highlighted green.
5. **Environment variable panel** — `EnvVarsPanel.tsx` shows env vars referenced in workflow with step locations.
6. **Unsaved changes guard** — In-app styled dialog (`UnsavedChangesDialog.tsx`) when navigating away with unsaved changes; works on Back button AND header tab navigation via Zustand global store (`unsaved-changes-store.ts`) + `GuardedLink` wrapper in AppHeader.
7. **Import dialog** — `ImportDialog.tsx` supports loading saved configs from MongoDB, uploading YAML file, or importing from raw HTTP URL.
8. **YAML preview dialog** — `YamlPreviewDialog.tsx` provides syntax-highlighted YAML preview with copy/download, line numbers.
9. **YAML export** — Download uses YAML format (js-yaml) instead of JSON.
10. **Workflow templates** — `WorkflowTemplateDialog.tsx` template picker when creating new workflow.
11. **Clone workflow** — Clone button on existing workflow cards.
12. **Theme-aware nodes** — Nodes use dark vibrant colors in dark mode, pastel colors in light mode via `useTheme()` runtime detection.
13. **Custom canvas controls** — Replaced React Flow default Controls with custom Panel-based controls using primary theme color.
14. **Toolbar redesign** — Two-row layout with grouped Import/Preview/Download button bar to prevent overflow.
15. **Scrollbar fix** — Transparent track with thin rounded thumb globally.

### Configuration

```bash
# MongoDB (required for Task Builder, existing env vars)
MONGODB_URI=mongodb://...
MONGODB_DATABASE=caipe

# YAML seed file path (optional, defaults to /app/task_config.yaml)
TASK_CONFIG_SEED_PATH=/app/task_config.yaml

# Cache TTL for supervisor MongoDB reads (seconds, default 60)
TASK_CONFIG_CACHE_TTL=60
```


## Components Changed

- `ui/src/types/task-config.ts` — TaskConfig, TaskStep types and YAML parsing utilities
- `ui/src/lib/mongodb.ts` — Added `task_configs` collection indexes
- `ui/src/app/api/task-configs/` — CRUD and seed API routes
- `ui/src/store/task-config-store.ts` — Zustand store
- `ui/src/store/unsaved-changes-store.ts` — Zustand store for unsaved changes guard
- `ui/src/components/task-builder/` — Visual flow editor components
- `ui/src/components/task-builder/StepPalette.tsx` — Step Templates palette (154 draggable tool templates)
- `ui/src/components/task-builder/CaipeFormBuilder.tsx` — CAIPE Form Builder for structured editing
- `ui/src/components/task-builder/EnvVarsPanel.tsx` — Environment variable panel
- `ui/src/components/task-builder/ImportDialog.tsx` — Import dialog (MongoDB, YAML upload, HTTP URL)
- `ui/src/components/task-builder/YamlPreviewDialog.tsx` — YAML preview dialog
- `ui/src/components/task-builder/UnsavedChangesDialog.tsx` — Unsaved changes dialog
- `ui/src/components/task-builder/WorkflowTemplateDialog.tsx` — Workflow template picker
- `ui/src/components/task-builder/step-templates.ts` — Step template data for all integrated agents
- `ui/src/app/(app)/task-builder/page.tsx` — Task Builder page
- `ui/src/components/layout/AppHeader.tsx` — Added Task Builder navigation tab, GuardedLink wrapper
- `ai_platform_engineering/utils/mongodb_client.py` — Shared pymongo client singleton
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` — Modified `load_task_config()` for MongoDB-first reads


## Related

- Spec: [spec.md](./spec.md)

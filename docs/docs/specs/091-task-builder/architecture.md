---
sidebar_position: 1
id: 091-task-builder-architecture
sidebar_label: Architecture
---

# Architecture: Task Builder -- Visual Workflow Editor with MongoDB Persistence

## Decision

| Alternative | Pros | Cons | Decision |
|---|---|---|---|
| **MongoDB as source of truth with YAML seeding (chosen)** | Dynamic CRUD, no redeploy needed, seeding preserves existing workflows | Requires MongoDB dependency | Selected |
| YAML file only | Simple, version-controlled | Requires rebuild/redeploy for changes, no multi-user | Rejected |
| Git-backed YAML with auto-sync | Version-controlled, familiar workflow | Complex sync logic, merge conflicts | Rejected |
| Repurpose existing agent_configs collection | Reuses existing infrastructure | Different schema/purpose, migration risk | Rejected |

## Solution Architecture

### Data Flow

```
First Boot:
  task_config.yaml ──seed──▶ MongoDB (task_configs collection)
    └── POST /api/task-configs/seed
    └── Idempotent: skips if collection is non-empty
    └── Marks as is_system: true, owner_id: "system"

UI Workflow:
  Task Builder ──▶ /api/task-configs (CRUD) ──▶ MongoDB
    └── POST: create new workflow
    └── PUT:  update (owner or admin only)
    └── DELETE: remove (owner or admin, not system configs)
    └── GET: list visible configs (system + own + shared)
    └── GET ?format=yaml: export in task_config.yaml format

Supervisor:
  deep_agent_single.py ──pymongo──▶ MongoDB (primary)
                        ──fallback──▶ task_config.yaml (if MongoDB down)
    └── In-memory TTL cache (default 60s)
    └── invoke_self_service_task works identically with both sources
```

### MongoDB Schema

Collection: `task_configs`

```typescript
interface TaskConfig {
  id: string;                    // "task-config-<timestamp>-<random>"
  name: string;                  // unique workflow name
  category: string;              // e.g., "GitHub Operations"
  description?: string;
  tasks: TaskStep[];             // ordered workflow steps
  owner_id: string;              // "system" or user email
  is_system: boolean;            // true for YAML-seeded
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
  display_text: string;          // UI label
  llm_prompt: string;            // LLM instructions with variable substitution
  subagent: string;              // target subagent (caipe, github, etc.)
}
```

Indexes: `name` (unique), `category`, `owner_id`, `is_system`, `created_at` (descending)

### Visual Flow Editor

Built with `@xyflow/react`, the Task Builder provides a visual canvas:

```
┌─────────────────────────────────────────────────────┐
│  Toolbar (two-row)                                   │
│  [Name] [Category] [Description]                     │
│  [Import ▾] [Preview] [Download] [Save]             │
├──────────┬──────────────────────┬───────────────────┤
│  Step    │                      │  Property Editor   │
│  Palette │   Flow Canvas        │  ┌──────────────┐ │
│  ───────── │                    │  │ display_text  │ │
│  Search    │  ┌──────┐          │  │ llm_prompt    │ │
│  ─────── │  │ Step1 │───┐      │  │ subagent      │ │
│  CAIPE   │  └──────┘   │      │  │ (dropdown)    │ │
│  GitHub  │       ┌──────┐      │  └──────────────┘ │
│  Jira    │       │ Step2 │──┐  │                    │
│  ArgoCD  │       └──────┘  │  │  Env Vars Panel    │
│  AWS     │  ┌──────┐      │  │  ┌──────────────┐  │
│  ...     │  │ Step3 │◀────┘  │  │ VAR1: step 1  │  │
│  (154    │  └──────┘         │  │ VAR2: step 2  │  │
│  tools)  │                    │  └──────────────┘  │
└──────────┴──────────────────────┴───────────────────┘
```

**Node types** (color-coded, theme-aware via `useTheme()`):
- **UserInput** (yellow): `subagent: "caipe"` -- collects user input
- **Generate** (purple): processing subagents (github, backstage, jira, etc.)
- **Output** (green): notification/completion steps

**Layout**: S-curve pattern with bezier edges; nodes alternate left-right.

### Key UX Features

| Feature | Implementation |
|---|---|
| Step Templates palette | 154 draggable tool templates, searchable, categorized by agent |
| CAIPE Form Builder | Structured form editor for `caipe` subagent steps |
| File I/O visualization | Nodes show file read/write badges; shared-file edges highlighted green |
| Unsaved changes guard | Zustand `unsaved-changes-store.ts` + `GuardedLink` wrapper; in-app dialog |
| Import dialog | Load from MongoDB, upload YAML, or import from HTTP URL |
| YAML preview/export | Syntax-highlighted preview with copy/download; js-yaml format |
| Workflow templates | Template picker dialog when creating new workflow |
| Clone workflow | Clone button on existing workflow cards |

### Supervisor Integration

```python
def load_task_config():
    if os.getenv("MONGODB_URI"):
        configs = _load_from_mongodb()  # pymongo query
        if configs:
            _CACHE[key] = (configs, time.time())  # TTL cache
            return configs
    return _load_from_yaml()  # fallback
```

The shared pymongo client (`mongodb_client.py`) provides a singleton connection.

## Components Changed

| File | Description |
|---|---|
| `ui/src/types/task-config.ts` | `TaskConfig` and `TaskStep` interfaces |
| `ui/src/app/api/task-configs/route.ts` | CRUD API with validation, auth, YAML export |
| `ui/src/app/api/task-configs/seed/route.ts` | Idempotent YAML seeding endpoint |
| `ui/src/store/task-config-store.ts` | Zustand store for client-side task config state |
| `ui/src/app/(app)/task-builder/page.tsx` | Main Task Builder page |
| `ui/src/components/task-builder/TaskBuilderCanvas.tsx` | React Flow canvas with S-curve layout |
| `ui/src/components/task-builder/TaskStepNode.tsx` | Custom node component with subagent badges |
| `ui/src/components/task-builder/TaskBuilderSidebar.tsx` | Property editor sidebar |
| `ui/src/components/task-builder/TaskBuilderToolbar.tsx` | Two-row toolbar with metadata and actions |
| `ui/src/components/task-builder/StepPalette.tsx` | 154 draggable tool templates |
| `ai_platform_engineering/utils/mongodb_client.py` | Shared pymongo client singleton |
| `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` | Modified `load_task_config()` for MongoDB-first with YAML fallback |

## Related

- Spec: [spec.md](./spec.md)

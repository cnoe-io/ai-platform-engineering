# Task Builder — Visual Workflow Editor with MongoDB Persistence

**Status**: 🟡 In-development
**Category**: Architecture & Design
**Date**: March 3, 2026

## Overview

Introduced a visual Task Builder UI for creating and managing self-service workflows, backed by a new `task_configs` MongoDB collection. The supervisor agent now reads task configs from MongoDB (with YAML fallback), closing the gap between the UI and the backend.

## Problem Statement

The supervisor agent reads workflows exclusively from `task_config.yaml` on disk. The UI has no way to create or edit these workflows — any change requires modifying YAML, rebuilding the Helm chart, and redeploying. Non-developer users cannot create custom self-service workflows, and workflows created in the existing Agent Builder are not consumed by the supervisor.

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
- `ui/src/components/task-builder/` — Visual flow editor components
- `ui/src/app/(app)/task-builder/page.tsx` — Task Builder page
- `ui/src/components/layout/AppHeader.tsx` — Added Task Builder navigation tab
- `ai_platform_engineering/utils/mongodb_client.py` — Shared pymongo client singleton
- `ai_platform_engineering/multi_agents/platform_engineer/deep_agent_single.py` — Modified `load_task_config()` for MongoDB-first reads

## Related

- Spec: `.specify/specs/task-builder.md`
- Task Config YAML: `charts/ai-platform-engineering/data/task_config.yaml`
- Existing Agent Builder: `ui/src/components/agent-builder/`

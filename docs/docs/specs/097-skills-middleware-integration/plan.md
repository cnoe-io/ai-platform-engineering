# Implementation Plan: Integrated Skills with Single Source, Chat Commands, and Skill Hubs

**Branch**: `097-skills-middleware-integration` | **Date**: 2026-03-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/097-skills-middleware-integration/spec.md`

## Summary

Deliver a single shared skill catalog consumed by both the chat UI and the CAIPE supervisor via a new **skills middleware** (Python). The supervisor uses the upstream `deepagents.middleware.skills.SkillsMiddleware` for system prompt injection (progressive disclosure); our custom catalog layer aggregates skills from MongoDB, agent_configs, filesystem, and GitHub hubs, then writes them into the `SkillsMiddleware`'s `StateBackend` (FR-015). Remove "run in chat" from the UI and direct users to the `/skills` command to see loaded skills. Support client-side `/skills` in chat (catalog API, no A2A). Allow authorized users to onboard GitHub repos as skill hubs via UI; supervisor must hot reload skills or support a UI-triggered catalog refresh so updates apply without restart. Support both Anthropic/agentskills.io and OpenClaw-style SKILL.md when loading from hubs; ClawHub as a hub source is out of scope for v1.

## Technical Context

**Language/Version**: Python 3.11+ (backend), TypeScript (Next.js 16, React 19 for UI)
**Primary Dependencies**: LangGraph, LangChain, FastAPI, pymongo/motor (MongoDB), Next.js App Router, A2A SDK, `deepagents>=0.3.8` (upstream `SkillsMiddleware`, `StateBackend`)
**Storage**: MongoDB (catalog sources: `skills`, `agent_configs`, `skill_hubs`); optional filesystem/ConfigMap for built-in SKILL.md
**Testing**: pytest (backend), Jest (UI); integration tests for catalog consistency and hub CRUD
**Target Platform**: Linux server (backend), browser (UI); Docker/Kubernetes deployment
**Project Type**: Web application (backend API + frontend); skills middleware is a backend component consumed by supervisor (via upstream `SkillsMiddleware` + custom catalog layer) and by UI via API
**Performance Goals**: Catalog list response &lt;500ms p95 under normal load; hub fetch non-blocking so catalog remains usable during hub refresh
**Constraints**: No supervisor restart for catalog updates (hot reload or UI trigger); no "run in chat" action; UI must direct users to `/skills` for discovery. Backend catalog endpoint (GET /skills or equivalent) must validate requests using JWT via JWKS or user_info, same pattern as RAG server (FR-014). Supervisor must use upstream `deepagents.middleware.skills.SkillsMiddleware` for system prompt injection; custom catalog layer feeds skills into its backend (FR-015).
**Scale/Scope**: Single shared catalog; tens of skills from default + agent_configs + a small number of registered hubs (e.g. &lt;20 hubs)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| **I. Specifications as source of truth** | Pass | Spec in `spec.md`; plan and contracts derive from it. |
| **II. Agent-first** | Pass | Supervisor consumes skills from middleware; skills are first-class for orchestration. |
| **III. MCP server pattern** | Pass | Skills middleware is in-process/library for supervisor; no new MCP server required for v1. |
| **IV. LangGraph-based agents** | Pass | Supervisor remains LangGraph; upstream `SkillsMiddleware` plugs into deepagents middleware chain alongside existing middlewares; catalog layer feeds skills at build/request time. |
| **V. A2A compliance** | Pass | `/skills` is client-side (no A2A for list); assistant execution unchanged. |
| **VI. Skills over ad-hoc prompts** | Pass | Shared catalog and agentskills.io/OpenClaw-style SKILL.md; upstream `SkillsMiddleware` handles progressive disclosure (skills read on demand); skills from hubs are versioned and auditable. |
| **VII. Test-first quality gates** | Pass | Acceptance scenarios and quickstart drive tests; `make lint`, `make test`, `make caipe-ui-tests` apply. |
| **VIII. Structured documentation** | Pass | Spec, plan, research, data-model, contracts, quickstart in `docs/docs/specs/097-skills-middleware-integration/`. |
| **IX. Security and compliance** | Pass | Hub credentials via env/secret refs; only authorized users manage hubs (FR-009); input validation on hub registration. |
| **X. Simplicity (YAGNI)** | Pass | Single hub type (GitHub) for v1; ClawHub out of scope; no extra MCP for skills in v1. |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/097-skills-middleware-integration/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 decisions
├── data-model.md        # Entities and storage
├── quickstart.md        # Validation scenarios
├── contracts/           # API and client contracts
│   ├── catalog-api.md
│   ├── skill-hubs-api.md
│   └── chat-command-skills.md
├── checklists/
└── tasks.md             # From /speckit.tasks (not from /speckit.plan)
```

### Source Code (repository root)

```text
ai_platform_engineering/          # Python backend
├── multi_agents/                 # Supervisor; integrates with skills middleware
│   └── platform_engineer/
│       └── deep_agent_single.py  # Add SkillsMiddleware to middleware list; write skills to StateBackend
├── agents/                       # Domain agents (unchanged by this feature)
├── skills_middleware/            # NEW: catalog aggregation, hub fetch, get_merged_skills()
│   ├── __init__.py
│   ├── catalog.py                # Load from MongoDB + filesystem + hubs; write to StateBackend
│   ├── loaders/                  # Default loader, agent_config projection, hub fetchers
│   ├── precedence.py             # Deterministic merge and precedence rules
│   └── backend_sync.py           # Write normalized skills to StateBackend for SkillsMiddleware
├── utils/
└── ...

ui/                               # Next.js frontend
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── skills/           # GET /api/skills (calls backend or merges locally)
│   │   │   └── skill-hubs/       # CRUD for hubs (admin)
│   │   └── ...
│   └── components/               # Chat: /skills detection, placeholder "Type /skills to see available skills"
└── ...
```

**Structure decision**: Backend adds a `skills_middleware` package under `ai_platform_engineering/` for catalog aggregation, and uses the upstream `deepagents.middleware.skills.SkillsMiddleware` for system prompt injection. The catalog layer's `get_merged_skills()` produces the skill list; a sync function writes them as SKILL.md files into `StateBackend` paths (e.g. `/skills/default/`, `/skills/hub-<id>/`). The supervisor's `deep_agent_single.py` adds `SkillsMiddleware(backend=lambda rt: StateBackend(rt), sources=[...])` to its middleware list. UI adds/updates API routes and chat UX (remove run-in-chat, add `/skills` handling and placeholder/tooltip directing users to `/skills`). No new top-level service; middleware is in-process for supervisor and exposed to UI via existing API layer.

## Complexity Tracking

No constitution violations requiring justification. Single new package, upstream `SkillsMiddleware` integration, and API routes only.

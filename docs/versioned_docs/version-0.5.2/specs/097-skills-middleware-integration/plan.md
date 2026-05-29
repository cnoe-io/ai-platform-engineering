# Implementation Plan: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Branch**: `097-skills-middleware-integration` | **Date**: 2026-03-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/docs/specs/097-skills-middleware-integration/spec.md`

## Summary

Unify the skill catalog for the Next.js UI, Try skills gateway (JWT + catalog API keys), and the CAIPE platform engineer supervisor: aggregate default filesystem/Mongo skills, **`agent_skills`** projection (`source: agent_skills`), and GitHub hubs into `skills_middleware`, feed upstream **`deepagents.middleware.skills.SkillsMiddleware`** via `StateBackend`, remove “run skills” / “Run in Chat” from chat, implement **`/skills`** client-side against the same catalog API, support hub **crawl/preview**, **visibility** (global / team / personal), **search/pagination**, **[Skill Scanner](https://github.com/cisco-ai-defense/skill-scanner)** from **Cisco AI Defense** with **documented third-party attribution** in docs, NOTICE, and admin UI (**FR-023**, **SC-009**), configurable gates, bounded prompt summaries (**FR-024**), **supervisor refresh + observability** (**FR-012**, **FR-016**), **gateway–supervisor sync** (**FR-026**), with catalog **`source: agent_skills`** and **`agent_skills` loader** naming aligned across UI and middleware (**FR-025**, completed).

## Technical Context

**Language/Version**: Python 3.11+ (supervisor, `skills_middleware`); TypeScript / Node 20+ (Next.js UI)

**Primary Dependencies**: LangGraph, LangChain, `deepagents` (≥0.3.8, `SkillsMiddleware`), FastAPI, A2A protocol; Next.js 16, React 19, Tailwind; optional **`cisco-ai-skill-scanner`** CLI/package for hub/CI scans per [skill-scanner](https://github.com/cisco-ai-defense/skill-scanner)

**Storage**: MongoDB (`agent_skills`, optional `skills`, `skill_hubs`, `catalog_api_keys`, `skill_scan_findings`); filesystem `SKILLS_DIR` for packaged defaults; in-process catalog cache with explicit generation counters

**Testing**: `pytest` / `make test`, `make lint` (Ruff); UI `npm run lint`, `npm test` / `make caipe-ui-tests`; integration smoke per Constitution VII (`docker compose -f docker-compose.dev.yaml` minimal profiles)

**Target Platform**: Linux containers (supervisor + UI); local dev via docker-compose

**Project Type**: Multi-part — Python backend (`ai_platform_engineering/`) + Next.js app (`ui/`)

**Performance Goals**: Catalog list **GET** **p95 ~500 ms** under typical catalog sizes; hub fetch bounded; scanner runs off hot path where possible

**Constraints**: No secrets in source; API keys hashed; JWT JWKS validation aligned with RAG; progressive disclosure for skills in prompt; **no restart** for catalog refresh (**FR-012**); per-invoke entitled **`files`** (**FR-020**); scanner **attribution** visible wherever product names the tool (**FR-023**)

**Scale/Scope**: Thousands of skills stored OK; prompt summaries capped (**FR-024**); paginated catalog API (**FR-019**)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| I. Specs as source of truth | **Pass** | `spec.md` authoritative |
| II. Agent-first | **Pass** | Supervisor + `skills_middleware` |
| III. MCP pattern | **N/A** | Not a new MCP server |
| IV. LangGraph | **Pass** | Deep agent rebuild semantics in spec |
| V. A2A | **Pass** | Invoke-time `files` / entitlement |
| VI. Skills / agentskills.io | **Pass** | Dual format; Cisco AI Defense **Skill Scanner** per FR-023 with attribution |
| VII. Test-first | **Pass** | Gates: `make lint`, `make test`, `make caipe-ui-tests` |
| VIII. Documentation | **Pass** | Specs + contracts + NOTICE attribution |
| IX. Security | **Pass** | AuthN, visibility, scanner disclaimer (no findings ≠ safe) |
| X. Simplicity | **Pass** | FR-025 consolidation / `source: agent_skills` alignment (delivered) |

**Post-design**: `research.md` §18, `contracts/skill-scanner-pipeline.md`, and `data-model.md` reflect attribution — **Pass**.

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/097-skills-middleware-integration/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── catalog-api.md
│   ├── gateway-api.md
│   ├── skill-hubs-api.md
│   ├── chat-command-skills.md
│   ├── supervisor-skills-status.md
│   └── skill-scanner-pipeline.md
├── tasks.md
└── spec.md
```

### Source Code (repository root)

```text
ai_platform_engineering/
├── skills_middleware/
├── multi_agents/platform_engineer/
│   ├── deep_agent.py
│   └── protocol_bindings/a2a/agent.py, fastapi/main.py
ui/
├── src/app/api/skills/, skill-hubs/
├── src/components/skills/, chat/
└── src/lib/

scripts/
└── scan-packaged-skills.sh
```

**Structure Decision**: Python catalog and supervisor under `ai_platform_engineering/`; UI under `ui/`; feature design artifacts under `docs/docs/specs/097-skills-middleware-integration/`.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Phase 0 & 1 Outputs (this run)

| Artifact | Path |
|----------|------|
| Research | [research.md](./research.md) |
| Data model | [data-model.md](./data-model.md) |
| Contracts | [contracts/](./contracts/catalog-api.md) |
| Quickstart | [quickstart.md](./quickstart.md) |

## Next steps

- **`/speckit.tasks`** — ensure tasks cover FR-023 attribution (NOTICE, admin UI copy) and FR-025/FR-026 if not already listed.
- Implement; verify with `quickstart.md` scenarios.

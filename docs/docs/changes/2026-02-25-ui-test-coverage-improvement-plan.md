---
title: "2026-02-25: CAIPE UI Test Coverage Improvement Plan"
---

# CAIPE UI Test Coverage Improvement Plan

**Status**: Planned
**Category**: Testing / Quality
**Date**: February 25, 2026
**Estimated Effort**: 12–18 working days (2.5–3.5 weeks)

## Overview

Comprehensive plan to improve CAIPE UI unit test coverage from ~31% file coverage (~55 of ~175 source files) to near-complete coverage. This ADR captures the current state analysis, identified gaps, and a phased implementation plan.

## Current State

| Metric | Value |
|--------|-------|
| Test suites | 72 |
| Total tests | 1,804 |
| Source files (ts/tsx, excluding types/tests) | ~175 |
| Files with tests | ~55 (~31%) |
| Files without tests | ~120 (~69%) |

### What's Well-Covered

- **All 3 store files** — `chat-store.ts`, `agent-config-store.ts`, `workflow-run-store.ts`
- **All 9 hooks** — `use-a2a-streaming`, `use-admin-role`, `use-caipe-health`, `use-prometheus`, `use-rag-health`, `useRagPermissions`, `use-service-health`, `use-user-init`, `use-version`
- **15 of 16 lib files** — API clients, auth, config, MongoDB, streaming, storage, utils
- **Core chat components** — `ChatPanel` (2 test files), `AuthGuard`, `FeedbackButton`, `AgentStreamBox`, `SubAgentCard`
- **~23 API route handlers** — admin, chat conversations/messages, auth, settings, RAG RBAC, skill templates

## Gap Analysis

### Phase 1 — Quick Wins (1–2 days)

Simple files with repeatable patterns. Good for building momentum.

| File | Type | Notes |
|------|------|-------|
| `app/api/health/route.ts` | API route | Trivial GET handler |
| `app/api/version/route.ts` | API route | Trivial GET handler |
| `app/api/chat/conversations/[id]/share/route.ts` | API route | Authorization-sensitive sharing |
| `app/api/chat/conversations/[id]/pin/route.ts` | API route | State mutation |
| `app/api/chat/conversations/[id]/archive/route.ts` | API route | State mutation |
| `lib/markdown-components.tsx` | Library | Custom renderers used across the app |

### Phase 2 — High-Value Components (3–4 days)

User-facing components with significant logic. Priority based on user impact and bug history.

| File | Priority | Notes |
|------|----------|-------|
| `components/layout/Sidebar.tsx` | **Critical** | Core navigation; involved in race condition bug (conversation wipe during concurrent fetch). Needs regression tests. |
| `components/chat/ShareDialog.tsx` | High | Sharing authorization flow |
| `components/chat/ShareButton.tsx` | High | Entry point for sharing |
| `components/chat/MetadataInputForm.tsx` | High | User input form with validation |
| `components/chat/CustomCallButtons.tsx` | Medium | Agent selection UX |
| `components/a2a/A2AStreamPanel.tsx` | Medium | Streaming display logic |
| `components/a2a/A2UIRenderer.tsx` | Medium | Widget rendering |

### Phase 3 — RAG Components (3–5 days)

Entire RAG subsystem has 0% test coverage. `IngestView.tsx` is the largest untested file at ~2,067 lines.

| File | ~Lines | Priority |
|------|--------|----------|
| `components/rag/IngestView.tsx` | 2,067 | **High** — document ingestion workflows |
| `components/rag/SearchView.tsx` | medium | High — core RAG search UX |
| `components/rag/GraphView.tsx` | 238 | Medium — knowledge graph visualization |
| `components/rag/KnowledgePanel.tsx` | medium | Medium — RAG panel orchestrator |
| `components/rag/KnowledgeSidebar.tsx` | medium | Medium — KB navigation |
| `components/rag/api/index.ts` | — | Medium — RAG API client functions |
| `components/rag/graph/*` | — | Low — Sigma.js graph controllers (heavy mocking needed) |
| `components/rag/RagAuthBanner.tsx` | small | Low — simple auth banner |
| `components/rag/Models.ts` | — | Low — type models |
| `components/rag/typeConfig.ts` | — | Low — config constants |

### Phase 4 — Remaining API Routes (2–3 days)

16 untested route handlers. Follow the same mock-MongoDB + mock-auth + assert-response pattern as existing route tests.

| Route | Priority | Notes |
|-------|----------|-------|
| `chat/messages/[id]/route.ts` | High | Single message CRUD |
| `chat/search/route.ts` | High | Query/search with input validation |
| `chat/bookmarks/route.ts` | Medium | User bookmarks |
| `workflow-runs/route.ts` | Medium | Workflow execution tracking |
| `agent-configs/seed/route.ts` | Medium | Seed agent configurations |
| `admin/metrics/route.ts` | Medium | Admin-only metrics |
| `admin/stats/skills/route.ts` | Medium | Admin-only stats |
| `users/me/route.ts` | Medium | Current user profile |
| `users/me/favorites/route.ts` | Medium | User favorites |
| `users/me/stats/route.ts` | Medium | User analytics |
| `users/me/insights/skills/route.ts` | Low | Skills insights |
| `users/search/route.ts` | Low | User search |
| `users/debug/route.ts` | Low | Debug endpoint |
| `debug/auth-status/route.ts` | Low | Debug auth |
| `debug/session/route.ts` | Low | Debug session |
| `feedback/route.ts` | Low | Feedback submission |

### Phase 5 — Admin, Skills & Pages (3–4 days)

Admin dashboard components, the large SkillsEditor, and remaining app pages.

#### Admin Components

| File | Priority | Notes |
|------|----------|-------|
| `components/admin/HealthTab.tsx` | Medium | Health monitoring dashboard |
| `components/admin/MetricsTab.tsx` | Medium | Metrics display |
| `components/admin/PrometheusCharts.tsx` | Medium | Chart rendering |
| `components/admin/SkillMetricsCards.tsx` | Low | Metrics summary cards |
| `components/admin/TeamDetailsDialog.tsx` | Low | Team management dialog |
| `components/admin/CreateTeamDialog.tsx` | Low | Team creation dialog |

#### Skills Components

| File | ~Lines | Priority |
|------|--------|----------|
| `components/skills/SkillsEditor.tsx` | 998 | Medium — complex editor component |
| `components/skills/WorkflowHistoryView.tsx` | medium | Low |

#### Gallery Components

| File | Priority |
|------|----------|
| `components/gallery/IntegrationOrbit.tsx` | Low |
| `components/gallery/UseCaseBuilder.tsx` | Low |

#### App Pages

| Page | Priority | Notes |
|------|----------|-------|
| `(app)/knowledge-bases/page.tsx` | Medium | KB entry point |
| `(app)/knowledge-bases/ingest/page.tsx` | Medium | Ingestion page |
| `(app)/knowledge-bases/search/page.tsx` | Medium | Search page |
| `(app)/knowledge-bases/graph/page.tsx` | Low | Graph page |
| `(app)/skills/page.tsx` | Low | Skills list |
| `(app)/skills/editor/page.tsx` | Low | Editor page |
| `(app)/skills/history/page.tsx` | Low | History page |
| `unauthorized/page.tsx` | Low | Simple error page |
| `logout/page.tsx` | Low | Logout redirect |

#### Misc Components

| File | Priority |
|------|----------|
| `components/theme-provider.tsx` | Low |
| `components/tech-stack.tsx` | Low |

### Not Recommended for Unit Testing

| File | Reason |
|------|--------|
| `components/ui/*` (shadcn primitives) | Third-party UI primitives — tested upstream |
| `types/*.ts` | Pure type definitions — no runtime behavior |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth handler — tested via integration |
| `app/layout.tsx`, `(app)/layout.tsx` | Layout wrappers — minimal logic |

## Projected Outcome

| Metric | Before | After |
|--------|--------|-------|
| Test suites | 72 | ~130 |
| Total tests | 1,804 | ~2,400–2,600 |
| File coverage | ~55/175 (31%) | ~155/175 (89%) |
| API route coverage | 23/45 (51%) | 43/45 (96%) |
| Component coverage | ~25/70 (36%) | ~60/70 (86%) |

## Test Fixture Utilities

A reusable test fixture generator was created during the spinner/loading work and is available for use across new tests:

- **`ui/src/__test-utils__/conversation-fixtures.ts`** — generates realistic conversation objects with configurable turn counts and message sizes (small/medium/large), inspired by the MongoDB seed scripts used for manual stress testing.

## Implementation Notes

- API route tests follow a consistent pattern: mock `getServerSession`, mock MongoDB collections, call the route handler, assert status codes and response bodies.
- Component tests use the existing jest mock infrastructure for `next/navigation`, `next-auth/react`, `@/store/chat-store`, `@/lib/config`, and `framer-motion`.
- RAG components will need mocks for Sigma.js graph library and fetch calls to the RAG API.
- The `Sidebar.tsx` test should specifically include a regression test for the race condition where `loadConversationsFromServer` wiped messages from the active conversation during concurrent fetch.

## References

- Test suite output: `make caipe-ui-tests` (72 suites, 1,804 tests as of Feb 25, 2026)
- Existing test patterns: `ui/src/app/api/__tests__/`, `ui/src/components/__tests__/`, `ui/src/hooks/__tests__/`
- Conversation fixture generator: `ui/src/__test-utils__/conversation-fixtures.ts`
- Related work: Spinner/loading fix and auth redirect `callbackUrl` preservation tests added Feb 24, 2026

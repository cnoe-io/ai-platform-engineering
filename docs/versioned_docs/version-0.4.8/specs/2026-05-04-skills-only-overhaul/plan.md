# Implementation Plan: Skills-Only Installer Overhaul

**Branch**: `fix/skills-ai-generate-use-dynamic-agents` (continuing) | **Date**: 2026-05-04 | **Spec**: [spec.md](./spec.md)

## Summary

Collapse the multi-layout / multi-format CAIPE skill installer down to a single canonical layout: every supported coding agent reads the same `agentskills.io`-standard `SKILL.md` from the same two universal directories (`~/.claude/skills/<name>/SKILL.md` and `~/.agents/skills/<name>/SKILL.md` — plus their project-scope equivalents). The technical approach is a coordinated rewrite of three TS modules (`agents.ts`, `_lib/template-route.ts`, `install.sh/route.ts`), a UI simplification (`TrySkillsGateway.tsx`), two helper-template frontmatter updates, and a synchronized rewrite of the four affected Jest test files. No new dependencies, no new infrastructure, no schema changes (manifest shape widens but is read-compatible with the legacy form).

**Phase 6 extension (added 2026-05-04)**: Once Phases 1-5 land, the same branch picks up FR-016..FR-022 — bring GitLab to parity with GitHub on the per-skill ad-hoc importer, add an `include_paths: string[]` filter to the hub crawler (`hub-crawl.ts` + `skill_hubs` schema), widen the per-skill import body to accept multiple `paths[]`, and fix the long-standing GitLab subgroup truncation bug in the URL normalizer. Same constraints (no new deps, no new infrastructure); the only schema change is one optional field on `skill_hubs`, read-compatible with existing docs.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 20+, Next.js App Router (16), React 19
**Primary Dependencies**: Next.js route handlers, existing in-repo helpers (`shellQuote`, `ensureUid`, etc.); no new deps
**Storage**: Filesystem only (`~/.config/caipe/installed.json`, `./.caipe/installed.json`) for Phases 1-5. Phase 6 adds one optional `include_paths: string[]` field to the existing `skill_hubs` MongoDB collection (read-compatible with existing docs; no migration needed).
**Testing**: Jest + `@testing-library/react` (UI workspace) — `make caipe-ui-tests`
**Target Platform**: Browser (UI) + Node serverless route handlers (API) + emitted bash script executed in user shells (macOS, Linux, WSL)
**Project Type**: Web (Next.js UI workspace under `ui/`)
**Performance Goals**: Install script latency unchanged (network-bound on catalog fetch); generated script size reduced by ~30% (legacy renderers removed)
**Constraints**: Backward-compatible with copy-pasted one-liners that still pass `?layout=...`; backward-compatible with legacy manifest entries that have `path:` instead of `paths:`
**Scale/Scope**: ~1500 lines deleted, ~600 lines added across 6 source files + 4 test files; one branch, one PR

## Constitution Check

*Workspace constitution lives in `.specify/memory/constitution.md` and project-level rules in `CLAUDE.md` / `AGENTS.md` / `.cursorrules`.*

| Gate | Status | Notes |
|------|--------|-------|
| Conventional Commits | PASS | All commits use `feat(skills)`, `refactor(skills)`, `test(skills)` |
| DCO sign-off | PASS | `git commit -s` for every commit |
| Spec-first | PASS | This spec lives at `docs/docs/specs/2026-05-04-skills-only-overhaul/` |
| Tests required for non-trivial change | PASS | Four Jest test files rewritten + extended |
| Backward compatibility | PASS | Legacy `?layout=` query and legacy manifest `path:` shape both handled gracefully |
| ADR required? | NO | This is consolidation/cleanup, not a new architectural decision. The original "skills layout vs commands layout" decision was implicit; this overhaul retires the dead leg. No multi-team impact, no future "why did we do it this way" question to answer permanently. Spec is sufficient per the `.cursorrules` decision tree. |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/2026-05-04-skills-only-overhaul/
├── spec.md      # User stories, FR-001..FR-015, success criteria
├── plan.md      # This file
└── tasks.md     # Phase-by-phase task breakdown (next file written)
```

No `research.md`, `data-model.md`, `contracts/`, or `quickstart.md` — this is a refactor of existing surfaces, not new capability. The spec's Functional Requirements section serves as the contract.

### Source Code (repository root)

```text
ui/
├── src/
│   ├── app/api/skills/
│   │   ├── live-skills/
│   │   │   ├── agents.ts                          # REWRITE: agent registry collapsed (P1)
│   │   │   ├── route.ts                           # MINOR: drop layout/ from forwarded params
│   │   │   └── __tests__/agents.test.ts           # REWRITE: new spec shape (P3)
│   │   ├── update-skills/
│   │   │   └── route.ts                           # MINOR: drop layout/ from forwarded params
│   │   ├── _lib/
│   │   │   └── template-route.ts                  # REWRITE: new RenderResult shape (P1)
│   │   └── install.sh/
│   │       ├── route.ts                           # REWRITE: drop layout switch, multi-target write,
│   │       │                                      #   helper migration, settings.json patch trim,
│   │       │                                      #   uninstall-walks-both, --upgrade extension (P1)
│   │       └── __tests__/
│   │           ├── route.test.ts                  # REWRITE: drop layout, assert multi-target (P3)
│   │           ├── route.uninstall.test.ts        # REWRITE: paths[] shape, walk both (P3)
│   │           └── route.uninstall.smoke.test.ts  # REWRITE: bash syntax for new uninstall (P3)
│   └── components/skills/
│       ├── TrySkillsGateway.tsx                   # UPDATE: drop layout toggle, advanced disclosure (P1)
│       └── __tests__/
│           └── TrySkillsGateway.uninstall.test.tsx # UPDATE: drop layout assertions (P3)

charts/ai-platform-engineering/data/skills/
├── live-skills.md                                 # FRONTMATTER: add disable-model-invocation,
│                                                  #   allowed-tools (P1)
└── update-skills.md                               # FRONTMATTER: same (P1)
```

### Phase 6 — Multi-source crawl + path filtering (FR-016..FR-022)

```text
ui/
├── src/
│   ├── app/api/skills/
│   │   ├── import/                                # NEW: source-agnostic ad-hoc importer
│   │   │   ├── route.ts                           # NEW (P6): { source, repo, paths[], credentials_ref? }
│   │   │   └── __tests__/route.test.ts            # NEW (P6): GitHub + GitLab branches, multi-path,
│   │   │                                          #           conflict resolution, deprecation proxy
│   │   └── import-github/
│   │       └── route.ts                           # UPDATE (P6): proxy to /api/skills/import w/ source=github;
│   │                                              #              accepts legacy single-`path` body
│   ├── app/api/skill-hubs/
│   │   ├── route.ts                               # UPDATE (P6): accept + normalize include_paths[];
│   │   │                                          #              widen GitLab URL normalizer (subgroups)
│   │   ├── [id]/route.ts                          # UPDATE (P6): same include_paths + normalizer in PATCH
│   │   └── __tests__/url-validation.test.ts       # UPDATE (P6): add subgroup + include_paths cases
│   ├── lib/
│   │   ├── hub-crawl.ts                           # UPDATE (P6): crawlGitHubRepo + crawlGitLabRepo
│   │   │                                          #              accept includePaths?: readonly string[];
│   │   │                                          #              SkillHubDoc gains include_paths field;
│   │   │                                          #              _crawlAndCache forwards from hub doc
│   │   └── __tests__/hub-crawl-include-paths.test.ts  # NEW (P6): both crawlers + nested-skill invariant
│   └── components/skills/workspace/
│       ├── RepoImportPanel.tsx                    # NEW (P6): replaces GithubImportPanel; source toggle,
│       │                                          #           multi-path inputs, credentials hint switch
│       ├── GithubImportPanel.tsx                  # KEEP as a one-line shim that re-exports
│       │                                          #   RepoImportPanel for back-compat with existing imports
│       └── __tests__/import-panels.test.tsx       # UPDATE (P6): test source toggle, multi-path,
│                                                  #              and the conflict toast
└── (admin UI)
    └── src/components/admin/SkillHubsSection.tsx  # UPDATE (P6): add an "Include paths (optional)"
                                                   #              textarea/list to the hub form
```

**Structure Decision**: Continue on `fix/skills-ai-generate-use-dynamic-agents` (already has all the prerequisite work — uninstall mode, bulk install, helper rename, OTel scrubber, security gating). The overhaul is a delta on top of that branch, not a new feature line.

## Database migrations

*N/A — no `db-migration.md`.* This feature touches filesystem state only. The on-disk manifest format (`installed.json`) widens from `path: string` to `paths: string[]`, but the read path handles both shapes transparently (legacy entries are migrated on first uninstall write).

## Complexity Tracking

No constitution gates violated. Single-branch, single-PR refactor of a single subsystem. The only "complexity" worth flagging is the size — ~2100 lines net diff across 10 files — but it's all in one cohesive subsystem that already shares a single import root (`ui/src/app/api/skills/`). Splitting it across PRs would introduce a temporary inconsistent state where the registry says one thing and the install script does another. Single PR is the simpler option here.

## Implementation Phases (preview)

The full task breakdown lives in `tasks.md`. At a glance:

1. **Phase 1 — Registry & rendering core** (US1, US2)
   - Rewrite `agents.ts`, `template-route.ts`
   - Rewrite `install.sh/route.ts` (the bulk + uninstall + --upgrade machinery)
2. **Phase 2 — Helper templates & frontmatter** (US2)
   - Update the two `.md` helper templates with `disable-model-invocation` + `allowed-tools`
3. **Phase 3 — UI simplification** (US1, US3)
   - Drop the layout toggle from `TrySkillsGateway`, add the Advanced project-scope disclosure, expand path preview, add `.gitignore` reminder
4. **Phase 4 — Test rewrites** (US1, US2, US3)
   - Rewrite the four Jest test files in lockstep with the source changes
5. **Phase 5 — Verification & commit**
   - `make caipe-ui-tests`
   - Conventional Commits + DCO sign-off, one logical commit per phase
6. **Phase 6 — Multi-source crawl + path filtering** (US4, FR-016..FR-022) — added 2026-05-04
   - New `POST /api/skills/import` (source-agnostic); legacy `import-github` becomes a one-line proxy
   - GitHub + GitLab branches in the new importer share the path-filter + multi-path-merge logic
   - `hub-crawl.ts`: both crawlers accept optional `includePaths`; `_crawlAndCache` forwards it from the hub doc
   - `skill_hubs` schema gains optional `include_paths: string[]`; `POST` + `PATCH` validate + normalize
   - GitLab subgroup URL normalizer fixed in both `POST /api/skill-hubs` and `PATCH /api/skill-hubs/[id]`
   - `RepoImportPanel.tsx` replaces `GithubImportPanel.tsx` (kept as a re-export shim)
   - `SkillHubsSection.tsx` admin form gets an "Include paths (optional)" input
   - New + updated tests: `lib/__tests__/hub-crawl-include-paths.test.ts`, `app/api/skills/import/__tests__/route.test.ts`, `app/api/skill-hubs/__tests__/url-validation.test.ts` (subgroup + include_paths), `components/skills/workspace/__tests__/import-panels.test.tsx`

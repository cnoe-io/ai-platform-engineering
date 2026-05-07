---
sidebar_label: Tasks
sidebar_position: 6
---

# Tasks: Helm Chart Documentation Generator

**Input**: Design documents from `docs/docs/specs/092-helm-docs-generator/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Integration testing via `make docs-helm-charts && make docs-build` and grep for RC patterns (per FR-019, FR-020, US-6).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Create the generator script skeleton and Makefile target

- [x] T001 Create generator script skeleton at `scripts/generate-helm-chart-docs.sh` with argument parsing (`CHART_VERSION` env var), error handling, and `set -euo pipefail`
- [x] T002 Add `docs-helm-charts` target to `Makefile` that invokes `scripts/generate-helm-chart-docs.sh` with `CHART_VERSION` passthrough
- [x] T003 Add `check-yq` prerequisite target to `Makefile` (mirrors existing `check-helm-docs` pattern)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Version resolution and chart discovery — MUST complete before any user story

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement version resolution function in `scripts/generate-helm-chart-docs.sh`: (1) check `CHART_VERSION` env var, (2) query `helm show chart oci://ghcr.io/cnoe-io/charts/ai-platform-engineering` for latest published version, (3) fall back to local `appVersion` from `charts/ai-platform-engineering/Chart.yaml` with stderr warning
- [x] T005 Implement RC version stripping function in `scripts/generate-helm-chart-docs.sh`: `strip_rc_version()` that removes `-rc.*`, `-alpha.*`, `-beta.*`, `-pre.*` suffixes from version strings
- [x] T006 Implement chart discovery function in `scripts/generate-helm-chart-docs.sh`: auto-discover all chart directories under `charts/ai-platform-engineering/charts/*/` and `charts/rag-stack/charts/*/`, plus the two parent chart directories, by checking for `Chart.yaml` existence
- [x] T007 Implement `Chart.yaml` parsing function in `scripts/generate-helm-chart-docs.sh`: extract name, description (default: "A Helm chart for Kubernetes"), version, appVersion, type, sources, dependencies using `yq`

**Checkpoint**: Script can resolve version, discover charts, and parse metadata — ready for content generation

---

## Phase 3: User Story 1 + 2 — Core Doc Generation + ArtifactHub-Style Content (Priority: P1) MVP

**Goal**: Generate enriched README and Docusaurus pages for all charts with usage examples and values guidance

**Independent Test**: Run `make docs-helm-charts` and verify both source READMEs and Docusaurus pages exist for all charts with correct content sections

### Implementation

- [x] T008 [US1] Implement `generate_source_readme()` function in `scripts/generate-helm-chart-docs.sh`: writes enriched `README.md` to the source chart directory. Content order: auto-generated marker, chart title + description + version, Quick Start section, Customizing Values section, Reading the Values Table section, values table (from existing `helm-docs` output or raw `values.yaml`)
- [x] T009 [US2] Write the "Quick Start" template section in `scripts/generate-helm-chart-docs.sh`: `helm install` and `helm upgrade` commands using the chart's actual name, OCI registry URL, and resolved published version
- [x] T010 [US2] Write the "Customizing Values" template section in `scripts/generate-helm-chart-docs.sh`: examples of `--set key=value`, `-f custom-values.yaml`, and `helm show values` for discovering defaults
- [x] T011 [US2] Write the "Reading the Values Table" template section in `scripts/generate-helm-chart-docs.sh`: explains Key (dot-path into values.yaml), Type (Go/Helm type), Default (value in backticks), Description columns — matching ArtifactHub's presentation
- [x] T012 [US1] Implement `generate_docusaurus_page()` function in `scripts/generate-helm-chart-docs.sh`: writes Docusaurus-compatible `.md` to `docs/docs/installation/helm-charts/<parent>/<chart>.md` (or `index.md` for parent charts). Includes frontmatter (`id: <name>-chart`, `sidebar_label: <name>`), Docusaurus admonition marker, and same enriched content as source README
- [x] T013 [US1] Implement MDX escaping in `generate_docusaurus_page()`: replace `<URL>` patterns with `[URL](URL)` markdown links; escape stray angle brackets outside code spans
- [x] T014 [US1] Implement `helm-docs` integration: run `helm-docs --chart-search-root charts/` before content generation to ensure values tables are current; extract the values table section from the `helm-docs` output for embedding in enriched content
- [x] T015 [US1] Wire main loop in `scripts/generate-helm-chart-docs.sh`: iterate over all discovered charts, call `generate_source_readme()` and `generate_docusaurus_page()` for each, print summary of generated files

**Checkpoint**: `make docs-helm-charts` generates all READMEs and Docusaurus pages with usage examples and values guidance

---

## Phase 4: User Story 3 — Auto-Generated Marker (Priority: P2)

**Goal**: All generated files include machine-detectable and human-visible auto-generated markers

**Independent Test**: Open any generated file and confirm the marker is present; run `make docs-helm-charts` twice and confirm markers are preserved

### Implementation

- [x] T016 [US3] Add HTML comment marker at the top of source READMEs in `generate_source_readme()`: `<!-- AUTO-GENERATED by scripts/generate-helm-chart-docs.sh — DO NOT EDIT -->` with source file references and regeneration command
- [x] T017 [US3] Add Docusaurus `:::caution` admonition after frontmatter in `generate_docusaurus_page()`: visible warning with regeneration command

**Checkpoint**: All generated files have both machine-detectable and human-visible markers

---

## Phase 5: User Story 4 — Chart Dependencies Table (Priority: P2)

**Goal**: Parent chart docs include a dependency table from `Chart.yaml`

**Independent Test**: Read the generated `ai-platform-engineering` and `rag-stack` parent docs and confirm dependency tables list all subcharts with published versions and conditions

### Implementation

- [x] T018 [US4] Implement `generate_dependencies_section()` function in `scripts/generate-helm-chart-docs.sh`: parse `.dependencies[]` from parent `Chart.yaml`, render markdown table with Name, Version (RC-stripped), Condition/Tags columns; skip for subcharts (no dependencies array)
- [x] T019 [US4] Integrate dependencies section into `generate_source_readme()` and `generate_docusaurus_page()`: include after values table, only for parent charts

**Checkpoint**: Parent chart docs show complete dependency tables with published versions

---

## Phase 6: User Story 5 — Registry Version Fetch (Priority: P1)

**Goal**: Make target fetches latest published version from OCI registry

**Independent Test**: Run `make docs-helm-charts` on a branch with RC versions and confirm output shows the registry's latest stable version; run with `CHART_VERSION=0.2.37` and confirm override works; disconnect network and confirm fallback warning

### Implementation

- [x] T020 [US5] Add network timeout and error handling to version resolution in `scripts/generate-helm-chart-docs.sh`: timeout of 10 seconds on `helm show chart`, capture stderr, emit warning on failure
- [x] T021 [US5] Add `CHART_VERSION` passthrough in `Makefile` `docs-helm-charts` target: `CHART_VERSION=$(CHART_VERSION) scripts/generate-helm-chart-docs.sh`

**Checkpoint**: Version resolution works with registry, override, and offline fallback

---

## Phase 7: User Story 6 — Build Validation (Priority: P1)

**Goal**: `make docs-build` passes after `make docs-helm-charts` with zero errors and zero RC versions

**Independent Test**: Run `make docs-helm-charts && make docs-build` — exit code 0, zero broken links, zero MDX errors; grep all generated files for `-rc` patterns — zero matches

### Implementation

- [x] T022 [US6] Add validation step at end of `scripts/generate-helm-chart-docs.sh`: grep all generated files for RC version patterns (`-rc\b`, `-alpha\b`, `-beta\b`, `-pre\b`); exit with error if any found
- [x] T023 [US6] Update `Makefile` to add `docs-helm-validate` target: runs `make docs-helm-charts` then `make docs-build` then RC pattern grep as end-to-end validation
- [x] T024 [US6] Run `make docs-helm-validate` and fix any issues in generated output

**Checkpoint**: Full pipeline passes — `docs-helm-charts` + `docs-build` + RC grep = clean

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup and documentation

- [x] T025 [P] Update `docs/docs/installation/helm.md` to reference `make docs-helm-charts` as the regeneration command
- [x] T026 [P] Update `docs/docs/specs/092-helm-docs-generator/quickstart.md` with final command examples after implementation
- [x] T027 Remove any manually-created Docusaurus chart pages that are now auto-generated (verify `docs/docs/installation/helm-charts/` is fully generated)
- [x] T028 Run `make docs-helm-validate` as final end-to-end acceptance test

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1+US2 (Phase 3)**: Depends on Foundational — core MVP
- **US3 (Phase 4)**: Can start after Phase 2, but logically follows Phase 3 (markers added to generation functions)
- **US4 (Phase 5)**: Can start after Phase 2, independent of Phase 3
- **US5 (Phase 6)**: Version resolution is in Phase 2; this phase adds robustness
- **US6 (Phase 7)**: Depends on all other phases — validation of complete output
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 + US2 (P1)**: Combined in Phase 3 since they share the same generation functions — MVP
- **US3 (P2)**: Adds markers to US1/US2 generation functions — depends on Phase 3
- **US4 (P2)**: Adds dependency tables — can parallel with US3 after Phase 3
- **US5 (P1)**: Refines version resolution from Phase 2 — can parallel with US3/US4
- **US6 (P1)**: End-to-end validation — depends on all other stories

### Parallel Opportunities

- T002 and T003 can run in parallel (different files)
- T009, T010, T011 can run in parallel (template sections in same file but independent functions)
- T016 and T017 can run in parallel (different output types)
- T018 and T020 can run in parallel (different functions)
- T025 and T026 can run in parallel (different files)

---

## Implementation Strategy

### MVP First (Phase 1 + 2 + 3)

1. Complete Phase 1: Script skeleton + Makefile target
2. Complete Phase 2: Version resolution + chart discovery + YAML parsing
3. Complete Phase 3: Core doc generation with usage examples
4. **STOP and VALIDATE**: Run `make docs-helm-charts && make docs-build`
5. At this point, all 13+ charts have enriched READMEs and Docusaurus pages

### Incremental Delivery

1. Setup + Foundational → Script can discover and parse charts
2. Add US1+US2 → Full docs generated → `make docs-build` passes (MVP!)
3. Add US3 → Auto-generated markers in all files
4. Add US4 → Parent charts show dependency tables
5. Add US5 → Version fetched from registry automatically
6. Add US6 → End-to-end validation target
7. Polish → Docs updated, old manual files cleaned up

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- US1 and US2 are combined in Phase 3 because they produce the same output files
- The spec does not request TDD — test tasks are limited to US6 build validation
- Commit after each phase checkpoint
- Total tasks: 28

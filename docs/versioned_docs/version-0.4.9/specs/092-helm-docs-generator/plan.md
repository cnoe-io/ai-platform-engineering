---
sidebar_label: Plan
sidebar_position: 1
---

# Implementation Plan: Helm Chart Documentation Generator

**Branch**: `092-helm-docs-generator` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/092-helm-docs-generator/spec.md`

## Summary

Build a Bash script (`scripts/generate-helm-chart-docs.sh`) invoked by `make docs-helm-charts` that:

1. Fetches the latest published chart version from the OCI registry (`oci://ghcr.io/cnoe-io/charts/ai-platform-engineering`), with `CHART_VERSION` override and local `appVersion` fallback
2. Runs `helm-docs` to regenerate the values tables from `values.yaml` comments
3. Enriches each chart's source `README.md` with usage examples, "Reading the Values Table" guidance, dependency tables, and an auto-generated marker
4. Generates Docusaurus-compatible pages in `docs/docs/installation/helm-charts/<parent>/<chart>.md` with correct frontmatter and MDX-safe content
5. Validates output via `make docs-build`

## Technical Context

**Language/Version**: Bash (POSIX-compatible, uses `helm`, `yq`, and `helm-docs` CLI tools)
**Primary Dependencies**: `helm` (v3+), `helm-docs` (v1.14+), `yq` (v4+) for YAML parsing
**Storage**: N/A (file generation only)
**Testing**: `make docs-helm-charts && make docs-build` as integration test; grep for RC patterns as unit validation
**Target Platform**: macOS/Linux developer workstations, GitHub Actions CI
**Project Type**: CLI script + Makefile target
**Performance Goals**: Under 10 seconds for all 13+ charts
**Constraints**: Must work offline (fallback to local `appVersion`); must not require Python or Node.js
**Scale/Scope**: 2 parent charts, 11 subcharts, ~13 README + 13 Docusaurus pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Specs as Source of Truth | PASS | Spec at `docs/docs/specs/092-helm-docs-generator/spec.md` |
| II. Agent-First Architecture | PASS | Script is agent-invocable via make target |
| VII. Test-First Quality Gates | PASS | `make docs-build` + grep for RC patterns serve as automated tests |
| VIII. Structured Documentation | PASS | Generated output lives in `docs/docs/installation/helm-charts/` |
| IX. Security by Default | PASS | No secrets handled; OCI registry access is read-only public |
| X. Simplicity / YAGNI | PASS | Single Bash script, no new frameworks; reuses existing `helm-docs` |

## Project Structure

### Documentation (this feature)

```text
docs/docs/specs/092-helm-docs-generator/
├── spec.md
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
scripts/
└── generate-helm-chart-docs.sh    # Main generator script

Makefile                            # New target: docs-helm-charts

docs/docs/installation/helm-charts/
├── ai-platform-engineering/        # Generated Docusaurus pages
│   ├── index.md                    # Parent chart (ai-platform-engineering)
│   ├── supervisor-agent.md
│   ├── agent.md
│   ├── caipe-ui.md
│   ├── caipe-ui-mongodb.md
│   ├── dynamic-agents.md
│   ├── langgraph-redis.md
│   └── slack-bot.md
└── rag-stack/                      # Generated Docusaurus pages
    ├── index.md                    # Parent chart (rag-stack)
    ├── rag-server.md
    ├── rag-redis.md
    ├── rag-ingestors.md
    └── agent-ontology.md

charts/                             # Source READMEs (updated in-place)
├── ai-platform-engineering/
│   ├── README.md                   # Enriched by generator
│   └── charts/*/README.md          # Enriched by generator
└── rag-stack/
    ├── README.md                   # Enriched by generator
    └── charts/*/README.md          # Enriched by generator
```

**Structure Decision**: Single script in `scripts/` with a Makefile target. No new directories created; output goes to existing `docs/docs/installation/helm-charts/` and `charts/` directories.

## Complexity Tracking

No constitution violations. No complexity justification needed.

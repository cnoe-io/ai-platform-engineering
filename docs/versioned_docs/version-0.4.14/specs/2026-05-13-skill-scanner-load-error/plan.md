# Implementation Plan: Skill Scanner Validation Errors

**Branch**: `prebuild/fix/skill-scanner-load-error` | **Date**: 2026-05-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `docs/docs/specs/2026-05-13-skill-scanner-load-error/spec.md`

## Summary

Malformed `SKILL.md` uploads currently surface as generic internal scanner failures when upstream skill loading raises a known validation exception. Fix the standalone skill-scanner image path so caller-correctable skill loading failures are returned as validation failures with actionable details, while preserving generic internal-failure handling for unexpected service faults and preserving successful scans.

Technical approach: update the packaged scanner behavior used by `build/Dockerfile.skill-scanner` so the scanner API catches known skill loading exceptions around scan execution and returns an HTTP validation response. Prefer a fixed upstream `cisco-ai-skill-scanner` version when available; otherwise carry a minimal image-local patch with a focused regression test and remove it once the upstream package includes the fix.

## Technical Context

**Language/Version**: Python 3.13 runtime in the scanner image; TypeScript client behavior only for verification if needed
**Primary Dependencies**: `cisco-ai-skill-scanner`, FastAPI scanner API, Docker/Helm scanner packaging, Next.js server-side scanner client
**Storage**: N/A - no persisted storage change
**Testing**: pytest for scanner behavior or patch tests; existing UI Jest tests for scanner client contract if client handling changes; Docker build sanity check for scanner image
**Target Platform**: Linux container running the standalone internal skill-scanner service
**Project Type**: Containerized internal web service dependency for the CAIPE UI
**Performance Goals**: Validation failures return immediately with no full analyzer execution; valid scan latency remains unchanged for equivalent inputs
**Constraints**: Scanner remains internal-only and unauthenticated inside the trusted network; user-facing validation responses must not expose stack traces, credentials, tokens, or unnecessary filesystem details
**Scale/Scope**: One scanner API failure mode for malformed skill submissions; no new endpoints, storage, UI flow, or scan policy behavior

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Worse is Better**: PASS - fix is a targeted error classification change at the scanner boundary, not a broader scanner redesign.
- **YAGNI**: PASS - no new validation framework, UI workflow, storage, or policy model is introduced.
- **Rule of Three**: PASS - no abstraction is required for a single known exception family.
- **Composition over Inheritance**: PASS - changes stay at API packaging/error handling boundaries and do not introduce class hierarchy changes.
- **Specs as Source of Truth**: PASS - this plan follows `spec.md` and generated artifacts in the feature spec directory.
- **CI Gates Are Non-Negotiable**: PASS - plan includes targeted tests plus relevant existing scanner/UI checks.
- **Security by Default**: PASS - validation details are surfaced only after sanitization; scanner remains internal-only and no secrets are added.

## Project Structure

### Documentation (this feature)

```text
specs/<YYYY-MM-DD-feature>/
|-- plan.md              # This file (/speckit.plan command output)
|-- research.md          # Phase 0 output (/speckit.plan command)
|-- data-model.md        # Phase 1 output (/speckit.plan command)
|-- quickstart.md        # Phase 1 output (/speckit.plan command)
|-- contracts/           # Phase 1 output (/speckit.plan command)
`-- tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
build/
`-- Dockerfile.skill-scanner          # Scanner package version or image-local patch wiring

ui/src/lib/
|-- skill-scan.ts                     # Server-side client for /scan-upload; verify non-2xx contract handling
`-- __tests__/
    `-- skill-scan-ancillary.test.ts  # Existing scanner client tests; extend only if client parsing changes

charts/ai-platform-engineering/charts/skill-scanner/
|-- Chart.yaml
|-- README.md
`-- values.yaml                       # Verify image/deployment docs remain accurate if version changes

docker-compose.dev.yaml               # Local scanner service wiring
```

**Structure Decision**: Treat this as a standalone scanner packaging/API contract fix. There is no first-party scanner source tree in this repository; `build/Dockerfile.skill-scanner` installs `cisco-ai-skill-scanner` from PyPI and exposes the upstream `skill-scanner-api` to the UI.

## Database migrations

N/A - no `db-migration.md`. The feature changes scanner API error handling only and does not add or alter persisted collections, documents, indexes, or retention rules.

## Phase 0 Research

See [research.md](./research.md). All technical unknowns are resolved:

- Upstream scanner source is packaged as `cisco-ai-skill-scanner`; this repo controls the image pin and deployment, not the package source.
- Known skill loading failures should map to a validation response, not generic internal failure.
- A package bump is preferred; an image-local patch is acceptable only as a narrow temporary fallback if no fixed upstream release exists.

## Phase 1 Design

See [data-model.md](./data-model.md), [contracts/scan-upload-validation-error.md](./contracts/scan-upload-validation-error.md), and [quickstart.md](./quickstart.md).

**Post-Design Constitution Check**:

- **Simplicity/YAGNI**: PASS - design changes one error path and does not add new workflows.
- **Security by Default**: PASS - contract requires sanitized validation messages and no stack trace disclosure.
- **CI Gates**: PASS - quickstart defines targeted regression checks and existing package/image validation.
- **Specs as Source of Truth**: PASS - artifacts remain scoped to the generated spec directory.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| None | N/A | N/A |

# Specification Quality Checklist: Service Accounts

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-05
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- RESOLVED: owning-team deletion behavior — team deletion is blocked while the team owns any service
  accounts (FR-025, SC-008). No [NEEDS CLARIFICATION] markers remain.
- Implementation choices (reuse `service_account` OpenFGA type, dynamic Keycloak client per SA, BFF
  validation, tuple shapes) were intentionally kept OUT of the spec and live in the working notes at
  `.claude/tickets/service-accounts-1677/` (DECISIONS.md, PLAN.md, DISCREPANCY-tool-authz.md). They
  belong in `plan.md`, not the spec.
- Caller-keyed tool authorization is NOW IN SCOPE for this work (was previously framed as an external
  dependency). Confirmed by platform owner Sri in the RBAC Slack thread (2026-06-05) as a real gap
  affecting all human users — "we need to fix it, should be a quick fix." Captured as FR-012a/FR-012b
  + SC-010 + the "In-Scope Platform Change" section.
- Clarifications session 2026-06-05 resolved: auditing (FR-026/FR-027/SC-009), name uniqueness
  (FR-002a), revocation semantics (FR-018a), and the caller-keyed gap being in-scope (FR-012a/012b,
  superseding the earlier flag/preview-gating answer).

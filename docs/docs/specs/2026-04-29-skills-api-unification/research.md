# Research: Unified Skills API & Gateway

**Spec**: [spec.md](./spec.md)  
**Date**: 2026-04-29

All items below were resolved from the ratified spec, [implementation-plan.md](./implementation-plan.md), and existing codebase patterns. No `[NEEDS CLARIFICATION]` remained at plan time.

---

## 1. URL namespace

**Decision**: Consolidate under `/api/skills/*`; retire `/api/agent-skills/*` for CRUD, seed, generate, import-github.

**Rationale**: Single family for documentation, client code, and gateway scripts (FR-001, SC-001).

**Alternatives considered**: Keep legacy path as alias — rejected (permanent dual surface increases drift).

---

## 2. Catalog vs config

**Decision**: `GET /api/skills` remains **catalog-only** merged view; persisted documents use **`/api/skills/configs`** (same semantics as current agent-skills CRUD).

**Rationale**: FR-002; avoids conflating browse and CRUD responses.

**Alternatives considered**: Single endpoint with `?mode=` — rejected as error-prone for clients.

---

## 3. MongoDB storage

**Decision**: Continue using collection name **`agent_skills`**; no rename in this feature.

**Rationale**: FR-003, spec assumptions.

**Alternatives considered**: New collection for imports — rejected (stakeholder lock).

**Operations**: See [mongodb-migration.md](./mongodb-migration.md) — no mandatory migration script for this release; optional compound index if dedupe queries need it; future `renameCollection` documented as out-of-scope reference only.

---

## 4. Template import IDs

**Decision**: `id = skill-{slug}-{suffix}` where `suffix` = first **6** hex chars of `SHA-256(utf8(template_source_id + ':' + 'system'))`.

**Rationale**: FR-005, FR-006; stable across runs; dedupe key `metadata.template_source_id` + `is_system: true`.

**Alternatives considered**: UUID per insert — rejected (breaks idempotency).

---

## 5. List templates for import UI

**Decision**: Reuse existing **skill-templates** listing used by the app today (e.g. `GET /api/skill-templates` or internal loader parity) rather than adding a redundant public route unless a gap is found during implementation.

**Rationale**: YAGNI; implementation-plan Phase B allows either path.

**Alternatives considered**: New `GET /api/skills/templates` — optional follow-up if the existing endpoint is insufficient.

---

## 6. Auto-seed

**Decision**: At most **one** example in shared storage, driven by default template id (e.g. env `SKILLS_AUTO_SEED_TEMPLATE_ID` defaulting to `incident-postmortem-report`).

**Rationale**: FR-007; avoids silent full `seedTemplatesFromDisk()`.

---

## 7. Gateway narrative

**Decision**: Primary docs and `TrySkillsGateway` emphasize **authenticated catalog GET** and on-demand skill body fetch; **bulk install.sh** / copy-all positioned as **advanced**.

**Rationale**: FR-009.

**Alternatives considered**: Filesystem-first — rejected by spec.

---

## 8. Hash algorithm

**Decision**: SHA-256 via Node `crypto` (same as implementation-plan).

**Rationale**: Spec assumptions; ubiquitous and sufficient for short suffix.

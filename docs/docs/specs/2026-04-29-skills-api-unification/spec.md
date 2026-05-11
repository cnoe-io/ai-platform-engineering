# Feature Specification: Unified Skills API, Gateway, and Template Import

**Spec directory**: `docs/docs/specs/2026-04-29-skills-api-unification/` (date prefix per Speckit; see PR #1318)  
**Feature Branch**: Use existing branch (no new worktree required; e.g. `fix/skills-ai-generate-use-dynamic-agents`)  
**Created**: 2026-04-29  
**Status**: Validated (checklist passed; see `checklists/requirements.md`)  
**Input**: User description: Unify all skill-related HTTP access under a single skills gateway; retire the separate agent-skills API path; reuse the existing persisted skill store (no new database collection); offer explicit, system-scoped import of packaged template skills with deterministic short identifiers (6 hex characters derived from a secure hash); auto-seed at most one example skill; align the Skills API Gateway so coding agents discover the live catalog and fetch skill content on demand rather than treating bulk copy-to-disk as the default; ship at least one real default skill (incident post-mortem writing) for supervisor and catalog. Operational note: SHA suffix length agreed to 6 characters.

**Related**: Extends and aligns with [097-skills-middleware-integration](../097-skills-middleware-integration/spec.md) (catalog, supervisor, hubs). Technical execution: [implementation-plan.md](./implementation-plan.md). MongoDB: [mongodb-migration.md](./mongodb-migration.md) (no collection rename for this feature).

## Overview

Operators and developers struggle when skill configuration, catalog browsing, seeding, AI-assisted authoring, and IDE hook installation are spread across multiple URL families and behaviors. This feature delivers a **coherent skills experience**: one predictable surface for HTTP operations, **optional** import of chart-packaged templates into shared storage without duplicates, a **single** automatic example for first-time clarity, and gateway guidance that prioritizes **live catalog access** over copying every skill onto the user’s machine.

## Clarifications

### Session 2026-04-29

- Q: For long-running hub or bulk skill-scanner operations, how should **dedicated scan progress** be modeled? → A: **Job record** — start returns a **job id**; the UI polls a **status API** until the job reaches a terminal state (Option A).
- Q: Should skills with **critical** scanner findings be **excluded / quarantined** from API access, and who configures the bar? → A: **Yes** — skills that exceed an **admin-configurable quarantine threshold** (mapped to scanner severities / findings per 097) are **quarantined**; **only administrators** may change the threshold or policy (not end users). **Quarantined skills MUST remain visible in the in-product UI** (with clear status) for remediation; the **Skills API Gateway** and other **agent-facing** catalog paths **MUST NOT** allow discovery or use of quarantined skills.
- Q: Who may **trigger** a skill-scanner **re-scan** (single skill vs hub/collection)? → A: **Hub/collection re-scan: administrators only.** **Single skill (`is_system`): administrators only.** **Single skill (non-system):** the **creating owner**, any user who is a **member of an existing Team** already used elsewhere (Admin UI + MongoDB) **and** that team is **linked to the skill** via the same team/visibility fields the product already stores on persisted skills, or an **administrator** — **no** separate “delegate” role and **no** new team abstraction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover and use skills from one place (Priority: P1)

As a **platform user**, I want **all skill-related actions I perform in the product** (browse catalog, manage my team’s skills, use the API gateway) to follow **one naming pattern** so that **documentation, scripts, and training stay consistent**.

**Why this priority**: Reduces support burden and integration errors for every downstream consumer.

**Independent Test**: With credentials, a user can complete catalog browse and skill configuration workflows without using a second, legacy base path.

**Acceptance Scenarios**:

1. **Given** I am authenticated, **When** I open skill management and the gateway documentation, **Then** I only see references to the unified skills entry points (no parallel “agent-skills” URL family).
2. **Given** an external automation script was written for the old path, **Then** the release notes describe the removal and migration expectation (breaking change acknowledged).

---

### User Story 2 - Import packaged templates on purpose (Priority: P2)

As an **administrator**, I want to **choose when** packaged template skills from the product distribution are copied into shared storage **as system skills**, so that **I avoid accidental bulk load** and **no duplicate** system imports occur when I run the action twice.

**Why this priority**: Prevents database clutter and clarifies ownership (system vs user-created).

**Independent Test**: Run import twice with the same selection; second run adds zero new duplicates. Imports are visible as system-scoped skills.

**Acceptance Scenarios**:

1. **Given** templates are available from the distribution, **When** I open the import flow and confirm, **Then** selected templates appear as shared system skills with stable, non-colliding identifiers.
2. **Given** I already imported a template, **When** I import again, **Then** the system skips or updates without creating a second row for the same logical template.

---

### User Story 3 - First-time clarity without silent bulk seed (Priority: P2)

As a **new tenant admin**, I want the environment to **automatically surface at most one example skill** so that **the catalog is not empty and confusing**, without loading every packaged template silently.

**Why this priority**: Onboarding clarity without overriding explicit import control.

**Independent Test**: Fresh environment receives at most one auto-provisioned example; full template set requires explicit import (Story 2).

**Acceptance Scenarios**:

1. **Given** a new deployment with empty shared skill storage, **When** the app completes first-time skill initialization, **Then** at most one designated example skill exists in shared storage.
2. **Given** I have not used template import, **When** I view the catalog, **Then** I still see default distribution skills where the product mounts them (filesystem catalog) plus the single example if applicable.

---

### User Story 4 - Gateway favors live catalog over bulk install (Priority: P3)

As a **developer using Claude Code / Grid**, I want the **gateway instructions** to **point my hook at the live skill catalog** and **fetch skill content when needed**, so that **I am not pushed to copy the entire catalog into my project by default**.

**Why this priority**: Matches modern “catalog as source of truth” expectations and reduces drift.

**Independent Test**: Primary gateway copy describes listing and on-demand fetch; any “install everything locally” path is labeled advanced or secondary.

**Acceptance Scenarios**:

1. **Given** I follow the primary gateway setup, **When** I read the steps, **Then** I understand how to authenticate and query the live catalog before any optional bulk file install.
2. **Given** I need offline or bulk materialization, **When** I seek that option, **Then** I find it explicitly as an advanced path.

---

### User Story 5 - Skill scanner status, re-run, and job progress (Priority: P2)

As a **skill author or admin**, I want to **see whether the skill-scanner ran** on a skill, **whether it passed**, **re-run** the scanner on a **single skill** or on a **skill hub collection**, and **follow a dedicated progress state** for long scans so that **I trust catalog quality and can recover from stale or failed scans**.

**Why this priority**: Aligns operator and author mental models with [097 FR-027](../097-skills-middleware-integration/spec.md) (`scan_status`, findings) and avoids blind reliance on background-only behavior.

**Independent Test**: A visible pass/fail/unscanned (or equivalent) indicator exists for a persisted skill; starting a hub or bulk re-scan returns a **job id** and the UI can poll until completion; single-skill re-scan updates persisted scan fields when done.

**Acceptance Scenarios**:

1. **Given** a persisted skill document, **When** I view it in the skills UI, **Then** I can see whether a scan **ran** and the **outcome** (e.g. passed / flagged / unscanned per existing model).
2. **Given** I am the **creating owner**, a member of a **MongoDB-backed Team** already linked to the skill (same model as Admin **Teams**), or an **admin**, **When** I trigger a **single-skill** re-scan on a **non-system** skill, **Then** the system runs the scanner and the indicator reflects the **new** result when finished; only **admins** may re-scan **system** skills.
3. **Given** I am an **administrator**, **When** I start a **hub/collection** re-scan, **Then** I receive a **job identifier** and can observe **progress** via polling until the job completes or fails; **non-admins** cannot start hub-wide re-scan.
4. **Given** an **administrator** has set a **quarantine threshold**, **When** a skill’s scan findings meet or exceed that threshold, **Then** that skill **still appears** in **in-product UI** with quarantine status, but the **Skills API Gateway** does **not** expose it for agent discovery or use until remediated or policy changes (see FR-015–FR-016).

---

### Edge Cases

- MongoDB unavailable: skill configuration and import behave according to existing product rules (graceful degradation or clear errors).
- Partial template import failure: user sees which items succeeded vs failed.
- User-created skill IDs that resemble system prefixes: deduplication keys must not overwrite user content.
- **Scan job** abandoned or worker restart: polling surfaces **terminal failure** or **stale job** state with a clear message; job records do not imply liveness forever without bounds.
- **Concurrent re-scan**: second request while a job is **in progress** for the same scope returns **conflict** or **same job id** (implementation choice documented in plan)—user never sees two contradictory “in progress” UIs without resolution.
- **Unauthorized re-scan**: callers without the required role receive **403** (or product-standard denial) and **no** scanner job is created—e.g. non-admin attempting **hub** re-scan; non-admin/non-owner/non-team-member (per **existing** Team linkage on the skill) attempting **single-skill** re-scan; non-admin attempting re-scan on a **system** skill.
- **Quarantine policy change**: when an **admin** tightens the threshold, additional skills may become quarantined **without** a new scan (re-evaluate from stored findings where possible); when loosened, skills may re-enter consumer APIs after eligibility is recomputed (exact mechanics in plan, bounded eventual consistency acceptable).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The product MUST expose **one consolidated family** of HTTP entry points for skill catalog access, persisted skill configuration, seeding, AI-assisted skill authoring, GitHub ancillary import, and gateway/bootstrap artifacts, so operators and integrators do not rely on a second parallel URL family for the same capabilities.
- **FR-002**: The merged **skill catalog** (browse/search) MUST remain a **distinct** capability from **CRUD on persisted skill documents**; both MUST remain available without conflating list-catalog and list-config responses.
- **FR-003**: Persisted skill documents MUST continue to use the **existing** shared storage collection already used for agent skills (no requirement to introduce a new collection name for this feature).
- **FR-004**: Template import MUST create **system-scoped** skill records only (shared defaults, not private user copies).
- **FR-005**: Template import MUST assign each imported row a **stable identifier** comprising a readable prefix and a **six-character** deterministic suffix derived from a cryptographic hash of fixed inputs (template source key and system scope), so repeat imports do not mint new random IDs.
- **FR-006**: Template import MUST **deduplicate** using a stored logical template source key so the same packaged template is not inserted twice.
- **FR-007**: Automatic first-time seeding MUST create **at most one** example skill in shared storage (designated example), not the full template set.
- **FR-008**: The distribution MUST include **at least one** real, production-grade default skill suitable for supervisor and catalog (e.g. writing an incident post-mortem report), delivered as part of packaged skill data—not a placeholder string.
- **FR-009**: Skills API Gateway **primary** documentation and installer flow MUST emphasize **querying the live catalog** with credentials; **bulk copy of all catalog content to the user’s filesystem** MUST NOT be presented as the default happy path.
- **FR-010**: Release documentation MUST record the **retirement** of the legacy skill configuration URL family as a **breaking** change for external scripts.
- **FR-011**: The product MUST surface a **skill-scanner status** for persisted skills (whether a scan **ran** and the **outcome**: at minimum consistent with existing **`scan_status`** semantics in 097—`passed` / `flagged` / `unscanned`).
- **FR-012**: **Single-skill** scan/re-scan MUST be allowed only when the caller is **authorized**: for **`is_system`** skills, **administrators only**; for **non-system** skills, the **creating owner**, any user who belongs to a **Team** from the **existing** Admin + MongoDB team model **and** that skill is associated with that team via **existing** persisted fields (same as current **team visibility** / selected teams on the skill document), or an **administrator**. There is **no** separate “delegate” role and **no** parallel team store. The UI MUST reflect updated status after completion. Unauthorized requests MUST be denied server-side (**403** or product equivalent). Field-level mapping (e.g. `selectedTeamIds`, `visibility`) is documented in **implementation-plan** by reference to current Skills Builder / Admin behavior.
- **FR-013**: **Hub/collection** re-scan MUST be allowed **only for administrators**. The server MUST return a **scan job identifier** and expose **pollable job status** (progress or phased states) until the job reaches a **terminal** state. Non-admin callers MUST receive **403** (or equivalent).
- **FR-014**: The UI MUST show **dedicated scan progress** for in-flight jobs (e.g. job state + percent or step label from polled status), distinct from generic page spinners where feasible.
- **FR-015**: The product MUST **quarantine** skills for **Skills API Gateway** and **agent-facing** catalog/query paths when persisted scanner findings (per 097) meet or exceed an **admin-configurable threshold** (e.g. **critical** severity band and/or named rule class—exact mapping is implementation detail aligned with [097 skill_scan_findings](../097-skills-middleware-integration/data-model.md)). Quarantine is **evaluated server-side**; the gateway **MUST NOT** expose quarantined skills for discovery or use. In-product UI still **shows** those skills per FR-016.
- **FR-016**: **Quarantine** MUST **exclude** affected skills from **Skills API Gateway** and other **agent-facing** catalog/query paths (including supervisor registration / runtime skill load for those consumers)—agents **MUST NOT** discover or execute quarantined skills via those paths. The **in-product UI** (e.g. skills gallery, builder, admin) MUST **show** quarantined skills with an explicit **quarantined** (or equivalent) indicator so **owners, team members with access, and admins** can remediate or re-scan. The precise route matrix (UI vs gateway) MUST be listed in **implementation-plan** and release notes if any public path changes.

### Key Entities

- **Catalog skill entry**: A discoverable skill (name, description, source classification, optional body) returned from the merged catalog browse operation.
- **Persisted skill config**: A document in shared storage representing a configurable skill (tasks, visibility, content, metadata) including system vs user ownership.
- **Packaged template**: A skill definition shipped with the product (e.g. under chart data) used as input to template import.
- **Template import record**: Links a persisted system skill to its packaged template source for deduplication.
- **Scan job**: A server-side record for **hub/bulk** re-scan work, identified by **job id**, with **pollable** lifecycle suitable for UI progress (ties to FR-013); not required for every synchronous single-skill path if implementation returns immediately from an inline scan (plan may still unify on jobs—see implementation-plan).
- **Quarantine policy**: **Administrator-only** settings that define which scanner **severity / finding** levels trigger **FR-015** exclusion from the **gateway** and agent paths; may be stored as env, database document, or admin UI—**implementation-plan** decides.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After release, **100%** of in-product links and documented entry points for skill CRUD, seeding, AI generate, GitHub import, and gateway bootstrap use the **unified** skills URL family (audit via search).
- **SC-002**: Re-running **template import** for the same template selection results in **zero** additional persisted rows for templates already imported (duplicate rate **0** for deduped keys).
- **SC-003**: In a fresh environment, automatic initialization creates **no more than one** example skill in shared storage (count ≤ 1).
- **SC-004**: **90%** of gateway users (survey or support ticket sampling within 60 days) report they understand **live catalog** usage without requiring bulk local install for their primary workflow.
- **SC-005**: The designated real default skill (post-mortem) appears in the **default** catalog source where packaged skills are mounted, verified by a smoke checklist in release QA.
- **SC-006**: For a **hub re-scan** started from the UI, users observe a **non-empty progress signal** (polled job state) in **≥90%** of manual QA runs before terminal completion (no silent hang without timeout messaging).
- **SC-007**: With a quarantine threshold set to a **non-trivial** level in staging, **100%** of skills that exceed that threshold in test data are **absent** from **Skills API Gateway / agent catalog** smoke checks, **visible** in **in-product UI** with quarantine indication, and **not** invokable through gateway flows, verified by automated or scripted QA.

## Assumptions

- Existing supervisor and dynamic-agent behavior continues to merge filesystem defaults, shared-storage skills, and hubs per 097.
- Cryptographic hash used for the six-character suffix is industry-standard (e.g. SHA-256 truncated); collision risk is acceptable for the bounded set of system template imports, with deduplication by template source key as the source of truth.
- No new MongoDB collection is required **for persisted skill documents**; `agent_skills` remains the store unless a future rename is decided outside this spec. **Scan job** persistence MAY use a new collection or an existing operational store—decision belongs in **implementation-plan** (FR-013 does not mandate storage shape).
- Skill-scanner invocation semantics (CLI, thresholds, `SKILL_SCANNER_GATE`) remain governed by **097**; this spec adds **product-visible** status, re-run entry points, **job+polling** UX for bulk/hub scans, and **admin-configurable quarantine** layered on top of findings (FR-015 may **narrow or align** with strict gate behavior but is **not** a duplicate of env-only 097 gates—product policy is **admin-visible**).
- **End-user** (non-admin) configuration of quarantine thresholds is **out of scope**; only **administrators** adjust policy (see Clarifications session).
- **Teams** for authorization are the **same** entities already managed in **Admin** and stored in **MongoDB**; scanner re-scan MUST **reuse** that membership and skill–team linkage—**not** introduce a second team concept.

## Out of Scope

- Renaming the MongoDB collection or migrating data to a differently named collection (optional future work).
- Changing the catalog JSON `source` discriminator values (e.g. `agent_skills`) for merged skills—would be a separate breaking API decision.
- Per-user copies of template imports (explicitly system-only per stakeholder decision).

## Dependencies

- 097 skills middleware integration (catalog merge, supervisor refresh, scanner).
- Chart-packaged skill directories and optional `BUILTIN_SKILL_IDS` behavior for seeding subsets.

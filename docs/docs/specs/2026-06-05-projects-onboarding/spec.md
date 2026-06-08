# Feature Specification: Projects & Onboarding Wizard

**Feature Branch**: `2026-06-05-projects-onboarding`  
**Created**: 2026-06-05  
**Status**: In Progress  
**Input**: Introduce Projects as a team-scoped CAIPE UI resource with a **configuration-driven** onboarding wizard and **Backstage sync** (super-admin) for importing `kind: System` entities. OSS defaults ship with no internal integration steps; operators mount `config/projects-onboarding.yaml` for custom provisioning.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and onboard a project (Priority: P1)

A team member opens Projects, starts the onboarding wizard, enters project name and members, selects their team, and completes any **configured** provisioning steps (empty by default in OSS).

**Why this priority**: Core flow; delivers project creation without leaking org-specific integrations.

**Independent Test**: Complete wizard end-to-end; project appears in list. With empty config, wizard goes create → complete.

**Acceptance Scenarios**:

1. **Given** an authenticated user with team membership, **When** they submit the wizard, **Then** a project document is created linked to the selected team.
2. **Given** a completed onboarding (or no configured steps), **When** the user views project detail, **Then** Backstage-compatible `catalog-info.yaml` is shown.

---

### User Story 2 - Browse team projects (Priority: P2)

A user visits `/projects` and sees cards for projects belonging to their teams, with status badges and quick links to wiki/Webex when provisioned.

**Why this priority**: Establishes Projects as a durable resource beyond the wizard.

**Independent Test**: List API returns only projects for teams the user belongs to (admins see all).

**Acceptance Scenarios**:

1. **Given** multiple projects across teams, **When** a non-admin lists projects, **Then** only projects for their teams are returned.

---

### User Story 4 - Sync projects from Backstage (Priority: P1)

An org super-admin opens **Sync from Backstage**, selects Systems to import, previews conflicts with local projects, resolves field differences, and applies the sync using server-side Backstage credentials.

**Why this priority**: Primary path for bringing existing catalogue data into CAIPE without manual YAML entry.

**Independent Test**: With `BACKSTAGE_URL` + `BACKSTAGE_API_TOKEN`, discover returns systems; sync creates/updates MongoDB projects; conflicts show resolution options.

**Acceptance Scenarios**:

1. **Given** org admin credentials, **When** they call discover, **Then** Backstage Systems are listed with `already_imported` flags.
2. **Given** a slug that exists locally with differing title/description, **When** preview sync runs, **Then** conflicts are surfaced and resolve via `keep_local` | `use_backstage` | `merge`.

---

### User Story 3 - Inspect Backstage catalogue representation (Priority: P2)

Platform engineers view generated YAML matching [outshift-platform-backstage-data](https://github.com/cisco-eti/outshift-platform-backstage-data) conventions (`kind: System`, `spec.domain`, `spec.outshift.rbac.tools`).

**Why this priority**: Aligns CAIPE with org-wide Backstage source of truth.

**Independent Test**: Generated YAML validates against pyramid project shape (apiVersion, kind, metadata, spec.owner, spec.outshift).

---

### Edge Cases

- Duplicate project slug within a team → 409 with clear message.
- MongoDB unavailable → 503 with existing CAIPE pattern.
- Onboarding partial failure → project stays `onboarding`, failed step recorded, user can retry.
- Team not found or user not member → 403.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist projects in MongoDB with `team_id`, `slug`, Backstage catalog document, and onboarding step status.
- **FR-002**: System MUST expose REST APIs: list/create projects, get by slug, run onboarding (mock external providers).
- **FR-003**: UI MUST provide `/projects` hub and `/projects/[slug]` detail with YAML viewer.
- **FR-004**: Onboarding wizard steps MUST be loaded from `config/projects-onboarding.yaml` (or `PROJECTS_ONBOARDING_CONFIG_PATH`); OSS default has zero steps.
- **FR-005**: Generated catalog MUST use `backstage.io/v1alpha1`, `kind: System`, and optional org extensions.
- **FR-006**: Org admins MUST be able to discover and sync Backstage Systems via `/api/projects/backstage/*` using server credentials.
- **FR-007**: Sync MUST detect field conflicts and support explicit resolution before apply.

### Key Entities

- **Project**: Named initiative under a Team; maps to Backstage `System`.
- **ProjectComponent**: Optional child entities (service, website) linked to the System.
- **OnboardingStep**: Per-integration status (`pending` | `running` | `completed` | `failed`).

## Success Criteria

- Demo user completes onboarding in under 3 minutes with visible step animations.
- Project list and detail pages render without errors when MongoDB is configured.
- Generated YAML matches structure of reference pyramid `catalog-info.yaml`.

## Assumptions

- External integrations are mocked per configured step (`provider: mock`); no hardcoded Outshift services in OSS UI.
- Example internal step config lives in `config/projects-onboarding.outshift.example.yaml` (not loaded by default).
- Projects use `kind: System` per existing Backstage folder layout (projects folder under domain).
- Demo prioritizes visual polish over RBAC hardening; list filtering uses team membership like dynamic-agents teams API.

## Out of Scope (demo)

- Writing to outshift-platform-backstage-data Git repo.
- Real Webex/Pam provisioning.
- OpenFGA tuples for project resources.

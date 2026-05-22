# Feature Specification: OpenFGA Relationship Backfill

**Feature Branch**: `release/0.5.1`  
**Created**: 2026-05-16  
**Status**: Draft  
**Input**: User description: "Create a real migration script that reads MongoDB data, seeds production-safe OpenFGA relationships for visualization and enforcement, records a first-time migration flag in MongoDB, and gives every user access to the configured default agent."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Backfill Real Team Relationships (Priority: P1)

As a platform administrator, I need existing teams, memberships, and resource assignments to be converted into authorization relationships, so the relationship graph reflects the actual access model instead of demo-only seed data.

**Why this priority**: This is the core migration outcome. Without real team-derived relationships, OpenFGA visualization and enforcement cannot be trusted for existing installations.

**Independent Test**: Prepare teams with members and assigned resources, run the migration in apply mode, and verify the resulting authorization graph contains the expected team membership and resource access relationships.

**Acceptance Scenarios**:

1. **Given** active teams with members and assigned agents, **When** the migration runs in apply mode, **Then** the graph contains team membership relationships and team-based agent-use relationships.
2. **Given** active teams with admin assignments, **When** the migration runs in apply mode, **Then** the graph contains team-based management relationships for those admin assignments.
3. **Given** active teams with tools, knowledge bases, skills, or tasks assigned, **When** the migration runs in apply mode, **Then** the graph contains the corresponding team-based resource relationships.
4. **Given** inactive or malformed team data, **When** the migration runs, **Then** invalid relationships are skipped and reported without corrupting existing authorization data.

---

### User Story 2 - Grant Default Agent Access to Everyone (Priority: P1)

As a platform operator, I need every authenticated user to be able to use the configured default agent, so the default chat experience remains available after per-agent authorization is enforced.

**Why this priority**: Dynamic Agent invocation now depends on per-agent authorization. The default agent must remain usable for all authenticated users to avoid breaking the primary new-chat path.

**Independent Test**: Configure a default agent, run the migration, and verify an authenticated user without team membership is allowed to use the default agent while unrelated agents remain governed by their specific relationships.

**Acceptance Scenarios**:

1. **Given** a persisted default agent is configured, **When** the migration runs in apply mode, **Then** all authenticated users are granted use access to that default agent.
2. **Given** no persisted default is configured but a deployment default exists, **When** the migration runs in apply mode, **Then** all authenticated users are granted use access to the deployment default agent.
3. **Given** no dynamic default agent is configured and the system falls back to the supervisor, **When** the migration runs, **Then** no default dynamic-agent grant is created and the run reports that the default-agent grant was skipped.
4. **Given** an authenticated user is not assigned to any team, **When** the user starts a chat with the configured default agent after migration, **Then** the authorization check allows the request.

---

### User Story 3 - Run Safely and Idempotently (Priority: P2)

As an operator running a production migration, I need dry-run previews, repeat protection, and durable migration status, so I can apply the backfill once without duplicating relationships or accidentally changing access during validation.

**Why this priority**: The migration changes authorization state. Operators need confidence before applying it and clear protection against accidental re-runs.

**Independent Test**: Run the migration first in dry-run mode, then in apply mode, then run it again without force and verify the second apply exits without rewriting data.

**Acceptance Scenarios**:

1. **Given** the migration runs in dry-run mode, **When** relationships are derived, **Then** the run reports the planned changes without writing authorization relationships or a completed migration flag.
2. **Given** the migration runs successfully in apply mode, **When** it completes, **Then** a durable migration record is written with status, counts, timestamp, and default-agent grant outcome.
3. **Given** the migration has already completed, **When** it is run again without force, **Then** it exits cleanly without rewriting relationships.
4. **Given** the migration has already completed, **When** it is run with force, **Then** it can re-check and reconcile relationships while preserving idempotent results.

---

### User Story 4 - Preserve Auditability and Visualization (Priority: P3)

As a security reviewer, I need migrated relationships to have provenance and stable identifiers, so I can distinguish migration-created access from manually managed access and inspect the graph in the admin UI.

**Why this priority**: The migration is only trustworthy if operators can explain where relationships came from and validate the graph after the run.

**Independent Test**: After applying the migration, inspect the relationship provenance records and the admin graph view to verify migrated edges are visible with consistent source metadata.

**Acceptance Scenarios**:

1. **Given** the migration writes a relationship, **When** the relationship is inspected later, **Then** its provenance identifies the migration as the source.
2. **Given** a relationship already exists from another source, **When** the migration runs, **Then** the migration does not remove or downgrade that existing relationship.
3. **Given** the admin graph visualization reads relationship data, **When** the migration has completed, **Then** migrated team and default-agent relationships are visible or discoverable in the graph.

---

### Edge Cases

- The default agent id points to a deleted or unavailable dynamic agent; the migration must fail or report a clear skipped/default-invalid outcome rather than granting access to an ambiguous target.
- Existing relationships may already exist in the authorization store; the migration must treat duplicate writes as successful idempotent state.
- MongoDB may contain team members identified only by email; the migration must use only identities that can be mapped to stable authorization subjects and must report unmapped users.
- Authorization model support for granting all users may be missing; the migration must fail closed before writing the default-agent grant.
- The authorization service may be unavailable during apply mode; the migration must not mark the migration completed unless required relationships were written or intentionally skipped.
- A partial failure may occur after some relationships are written; the migration record must show failure status and enough counts/errors for safe operator follow-up.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST derive authorization relationships from existing persisted team memberships and resource assignments.
- **FR-002**: The system MUST write production authorization relationships for team membership, agent use, agent management, tool call, knowledge-base read/use, skill use, and task use where the source data contains those assignments.
- **FR-003**: The system MUST write relationship provenance for migration-created relationships so operators can distinguish migrated access from other sources.
- **FR-004**: The system MUST support dry-run mode that derives and reports planned relationships without changing authorization state or marking the migration complete.
- **FR-005**: The system MUST write a durable first-time migration record after a successful apply run.
- **FR-006**: The system MUST skip re-application when a completed migration record already exists unless the operator explicitly requests a forced reconciliation.
- **FR-007**: The system MUST grant every authenticated user use access to the configured default dynamic agent when a default dynamic agent is configured.
- **FR-008**: The system MUST resolve the configured default dynamic agent using the existing platform precedence: persisted platform setting first, deployment default second, supervisor fallback last.
- **FR-009**: The system MUST treat supervisor fallback as "no default dynamic agent" for this migration and must not create a dynamic-agent default grant in that case.
- **FR-010**: The system MUST support an authorization model state where all authenticated users can be represented as a valid grant subject for the default-agent relationship.
- **FR-011**: The system MUST fail closed and report a clear error when the default-agent grant cannot be represented safely by the active authorization model.
- **FR-012**: The system MUST validate relationship identifiers before writing them to prevent malformed users, teams, or resources from entering authorization state.
- **FR-013**: The system MUST report counts for planned, written, skipped, duplicate, unmapped, and failed relationships.
- **FR-014**: The system MUST avoid deleting or weakening existing authorization relationships that were not created by this migration.
- **FR-015**: The system MUST include automated tests for relationship derivation, dry-run behavior, idempotent apply behavior, migration flag handling, default-agent resolution, and every-user default-agent access.
- **FR-016**: The system MUST update canonical RBAC documentation to explain the backfill, default-agent universal grant, migration flag, and verification steps.

### Key Entities *(include if feature involves data)*

- **Team**: A collaboration group with members, admins, and assigned resources that should become relationship graph edges.
- **User Subject**: A stable authenticated identity used in authorization relationships.
- **Resource Assignment**: A team-to-resource grant such as agent use, agent management, tool call, knowledge-base access, skill use, or task use.
- **Default Agent**: The configured dynamic agent used for new chats when a deployment or persisted platform setting selects one.
- **Universal Default-Agent Grant**: The relationship that allows every authenticated user to use the configured default dynamic agent.
- **Migration Record**: Durable state proving whether this backfill has run, what it wrote or skipped, and whether it completed successfully.
- **Relationship Provenance**: Metadata that identifies a relationship as migration-created and supports later auditing and visualization.

### Assumptions

- The merged default-agent configuration feature is the source of truth for default-agent resolution.
- A supervisor fallback is not a dynamic-agent grant target and does not require an OpenFGA default-agent relationship.
- The desired "every user" behavior is represented as a global authenticated-user grant in the authorization model, not as one tuple per existing user.
- Existing team/resource source data remains the source of truth for team-scoped relationships.
- The migration is intended for controlled operator execution and should be safe to run in dry-run mode before apply mode.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid team memberships and supported resource assignments in the migration fixture produce the expected planned relationships.
- **SC-002**: 100% of apply-mode runs that complete successfully write a completed migration record with counts and default-agent grant status.
- **SC-003**: 100% of repeat apply attempts without force exit without duplicating relationships after a completed migration record exists.
- **SC-004**: 100% of dry-run executions produce no authorization-store writes and no completed migration record.
- **SC-005**: 100% of configured dynamic default-agent cases produce an authorization decision that allows an authenticated user without team membership to use the default agent.
- **SC-006**: 100% of supervisor-fallback cases skip the default dynamic-agent grant and report that outcome.
- **SC-007**: Automated tests cover valid backfill, invalid source data, dry-run, completed migration skip, forced reconciliation, default-agent resolution, missing model support, and authorization-service failure cases.
- **SC-008**: Operators can inspect migrated relationships and provenance in under 5 minutes using documented verification steps.

# Feature Specification: Self-Service Team Resource RBAC

**Feature Branch**: `prebuild/self-service-team-resource-rbac`
**Created**: 2026-05-20
**Status**: Implemented
**Input**: User description: "Allow non-admin users to create and own agents, MCP servers, and team-scoped datasources; move Slack and Webex channel management to a team ownership model."

## User Scenarios & Testing

### User Story 1 - Private Resource Creation (Priority: P1)

A signed-in non-admin user creates a private Dynamic Agent, MCP server, or RAG datasource and can manage the resource they created without platform-admin grants.

**Why this priority**: This removes the platform-admin bottleneck for personal productivity resources.

**Independent Test**: Create each private resource through the BFF routes and verify the route writes an OpenFGA owner relationship for `user:<sub>`.

**Acceptance Scenarios**:

1. **Given** an authenticated non-admin user, **When** they create a private Dynamic Agent, **Then** the resource is persisted and `user:<sub> owner agent:<id>` is reconciled.
2. **Given** an authenticated non-admin user, **When** they create a private MCP server, **Then** the resource is persisted and `user:<sub> owner mcp_server:<id>` is reconciled.
3. **Given** an authenticated non-admin user, **When** they create a private datasource, **Then** the RAG create request succeeds and `user:<sub> owner knowledge_base:<id>` is reconciled.

---

### User Story 2 - Team Resource Creation (Priority: P1)

A signed-in user can create resources for a team only when the PDP allows them to use that team. Team members can use/read the resource, while team admins manage it.

**Why this priority**: Team-scoped resources need self-service onboarding without letting all team members administer shared assets.

**Independent Test**: Create a team-scoped Dynamic Agent, MCP server, or datasource and verify the BFF checks `user:<sub> can_use team:<slug>` before writing team member/admin resource tuples.

**Acceptance Scenarios**:

1. **Given** a user with `can_use team:<slug>`, **When** they create a team Dynamic Agent, **Then** team member use and team admin manager tuples are reconciled.
2. **Given** a user without `can_use team:<slug>`, **When** they try to create a team-scoped resource for that team, **Then** the BFF denies the request.

---

### User Story 3 - Team-Owned Messaging Surfaces (Priority: P2)

Slack channels and Webex spaces are assigned to one owning team, and per-channel/per-space resource management is authorized by OpenFGA channel/space relationships instead of a global admin gate.

**Why this priority**: Messaging integrations are operational team assets; platform admins should not be required for routine team channel/space routing changes.

**Independent Test**: Assign a Slack channel or Webex space to a team and verify `team:<slug>#admin can_manage` on the channel/space gates resources and route updates.

**Acceptance Scenarios**:

1. **Given** a team-owned Slack channel, **When** a team admin updates channel-agent grants, **Then** the BFF checks `can_manage slack_channel:<workspace>--<channel>` and writes channel-agent tuples.
2. **Given** a team-owned Webex space, **When** a non-manager attempts to update grants, **Then** the BFF denies before writing OpenFGA or Mongo route state.

## Edge Cases

- Team-scoped resource creation fails closed when the caller cannot use the requested team.
- Existing platform admins retain bypass only where explicitly marked as legacy/admin-bypass behavior.
- MongoDB channel/space mapping rows cannot override OpenFGA denial decisions.
- RAG datasource creation writes ownership only after the upstream create call succeeds.

## Requirements

### Functional Requirements

- **FR-001**: The OpenFGA model MUST include derived team `can_read`, `can_use`, and `can_manage` relations.
- **FR-002**: MCP servers MUST support direct `owner` relationships and derive read/use/invoke/manage/delete permissions from owner or manager relationships.
- **FR-003**: Slack channels and Webex spaces MUST support owner/manager-derived management checks.
- **FR-004**: Dynamic Agent creation MUST allow private resources without an owner team and team resources when `team#use` is allowed.
- **FR-005**: MCP server creation MUST be available to authenticated users and MUST reconcile owner/team OpenFGA tuples.
- **FR-006**: RAG datasource creation MUST be available through query-scope RAG access and MUST reconcile owner/team OpenFGA tuples after upstream success.
- **FR-007**: Slack channel and Webex space grant/route management MUST check the concrete channel/space PDP decision when a channel/space id is present.
- **FR-008**: Team channel/space assignment APIs MUST write team member user and team admin manager tuples for the assigned messaging resource.

### Key Entities

- **Dynamic Agent**: User-created AI agent configuration with optional owner team metadata and OpenFGA owner/team relationships.
- **MCP Server**: User-onboarded server metadata with OpenFGA owner/team relationships.
- **Knowledge Base / Datasource**: RAG datasource keyed by `datasource_id`, authorized as `knowledge_base:<id>`.
- **Slack Channel / Webex Space**: Messaging surface mapped to one owning team and authorized by OpenFGA concrete resource checks.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Targeted Jest coverage proves non-admin private resource creation succeeds for agents, MCP servers, and datasources.
- **SC-002**: Targeted Jest coverage proves team-scoped resource creation performs a `team#use` PDP check.
- **SC-003**: Targeted Jest coverage proves Slack/Webex per-resource management checks happen before grant tuple writes.
- **SC-004**: Packaged OpenFGA JSON models contain the same ownership relations as the canonical FGA model.

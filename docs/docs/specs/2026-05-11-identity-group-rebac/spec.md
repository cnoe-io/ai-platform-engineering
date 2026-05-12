# Feature Specification: Enterprise Identity Group Sync and Universal ReBAC

**Feature Branch**: `2026-05-11-identity-group-rebac`  
**Created**: 2026-05-11  
**Status**: Draft  
**Input**: User description: "Create a very detailed specification for comprehensive ReBAC authorization expansion, including Okta/AD group synchronization to create teams and memberships, manual team management, automatic ReBAC based on rules, Keycloak realm roles, representation of every atomic resource in ReBAC, UI-based policy creation and updating, graph visualization, policy access checking, and Slack channel access to multiple agents, tools, and knowledge bases."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sync Enterprise Groups Into CAIPE Teams (Priority: P1)

An identity administrator wants CAIPE to mirror enterprise group membership from Okta or Active Directory into CAIPE teams. When a group name matches an approved mapping rule, CAIPE should create the corresponding team if it does not already exist, assign users to the appropriate team relationship, and keep the relationship current as upstream group membership changes.

**Why this priority**: Enterprise groups are the primary source of organizational truth. Without group synchronization, team membership must be maintained manually and ReBAC policy will drift from enterprise identity.

**Independent Test**: Can be fully tested by configuring group mapping rules, running a dry run against representative groups, approving the sync, and confirming that expected CAIPE teams and user-team relationships are created, updated, and removed without granting unrelated resource access.

**Acceptance Scenarios**:

1. **Given** an enterprise group named `CAIPE-Platform-Engineering-Members` and no CAIPE team named `platform-engineering`, **When** an administrator runs group sync with a rule that captures the team name and member role, **Then** CAIPE creates the team and records each group member as a team member.
2. **Given** an enterprise group named `CAIPE-Platform-Engineering-Admins`, **When** group sync evaluates the rule set, **Then** CAIPE records matching users as scoped administrators for the `platform-engineering` team.
3. **Given** a user is removed from an upstream managed group, **When** the next sync runs, **Then** the managed membership is removed from CAIPE unless the user also has a manual or separately managed membership source that still grants access.
4. **Given** a group mapping rule is configured in dry-run mode, **When** an administrator previews the sync, **Then** CAIPE shows teams to create, memberships to add, memberships to remove, conflicts, skipped users, and ReBAC relationship changes before any state is changed.

---

### User Story 2 - Manage Teams and Members Manually (Priority: P1)

A platform administrator or scoped team administrator wants to create teams manually, add or remove members, assign team administrators, and preserve those manual assignments even when automated enterprise group sync also exists.

**Why this priority**: Not all access comes from upstream identity groups. CAIPE must support bootstrap teams, temporary access, exceptions, and early adoption before enterprise group naming is fully standardized.

**Independent Test**: Can be fully tested by creating a team in the admin UI, adding users manually, running group sync, and confirming manual members remain intact unless explicitly removed by an authorized administrator.

**Acceptance Scenarios**:

1. **Given** a platform administrator manually creates a CAIPE team, **When** the team is saved, **Then** the team is available as a ReBAC subject and can receive resource grants.
2. **Given** a manually added member is not present in any matching enterprise group, **When** automated group sync runs, **Then** CAIPE preserves the manual membership and clearly labels it as manually managed.
3. **Given** a scoped team administrator has management rights for one team, **When** they edit membership, **Then** they can manage only that team and cannot view or modify unrelated teams.

---

### User Story 3 - Represent Every Protected Resource in ReBAC (Priority: P1)

A security administrator wants every meaningful CAIPE resource to be represented in ReBAC so access decisions are consistent across the UI, Slack, AgentGateway, agent execution, tools, knowledge bases, skills, tasks, conversations, policies, and admin pages.

**Why this priority**: The end goal is that every resource is gated. Incomplete resource modeling creates bypasses, inconsistent admin behavior, and policies that cannot be visualized or audited end-to-end.

**Independent Test**: Can be fully tested by selecting representative resources of each type, creating allow relationships, running policy checks for each action, and confirming unauthorized users are denied by default.

**Acceptance Scenarios**:

1. **Given** an agent, tool, knowledge base, skill, task, Slack channel, conversation, admin page, policy, and audit view exist, **When** the ReBAC graph is loaded, **Then** each appears as a distinct resource node with its supported relationships.
2. **Given** no relationship grants a user access to a resource, **When** the user attempts to use, read, update, manage, or audit that resource, **Then** the action is denied.
3. **Given** a team has a grant to use an agent but no grant to manage it, **When** a team member invokes the agent and then attempts to edit its configuration, **Then** invocation is allowed and configuration is denied.

---

### User Story 4 - Create and Update ReBAC Policies in the UI (Priority: P2)

A platform administrator wants a rich policy-authoring UI that can create, review, update, and revoke relationships without hand-writing tuple data. The UI should support guided forms, graph editing, staged diffs, validation, and safe review before saving.

**Why this priority**: ReBAC is powerful but easy to misuse if administrators must type raw relationships. A guided UI improves correctness and makes policy changes auditable.

**Independent Test**: Can be fully tested by creating policies through the UI, previewing the change set, saving the policy, verifying the graph changes, and checking effective access before and after the update.

**Acceptance Scenarios**:

1. **Given** an administrator selects a team and a resource, **When** they choose a supported action such as read, use, write, manage, or audit, **Then** CAIPE stages a valid ReBAC relationship for review.
2. **Given** an administrator drags a resource node onto the graph and connects it to a team or user node, **When** the relationship is valid for the resource type, **Then** CAIPE stages the corresponding policy update.
3. **Given** an administrator attempts to create an unsupported relationship, **When** they preview or save the policy, **Then** CAIPE blocks the change and explains which part is invalid.
4. **Given** a staged policy diff contains grants and revocations, **When** the administrator saves it, **Then** CAIPE applies the diff atomically from the user's perspective and records an audit event for each relationship change.

---

### User Story 5 - Visualize All Relationships and Explain Access (Priority: P2)

A platform administrator, auditor, or scoped administrator wants to see the complete authorization graph, filter it by team, user, resource, Slack channel, or provider group, and understand why a user can or cannot access a resource.

**Why this priority**: A universal ReBAC model is only operable if administrators can inspect it. Visualization and explainability are required for troubleshooting, audits, and security reviews.

**Independent Test**: Can be fully tested by creating a known set of teams, groups, resources, and relationships, loading the graph, filtering it, and comparing the graph and policy checker results to expected access paths.

**Acceptance Scenarios**:

1. **Given** multiple teams, Slack channels, agents, tools, knowledge bases, skills, and tasks have relationships, **When** an administrator opens the all-relationships graph, **Then** CAIPE displays the system-wide graph and allows filtering to a smaller scope.
2. **Given** a user is a member of a synced enterprise group that maps to a CAIPE team, **When** the administrator asks why the user can access an agent, **Then** CAIPE shows the access path from enterprise group to team to resource.
3. **Given** access is denied, **When** the administrator uses the policy checker, **Then** CAIPE identifies the missing relationship or conflicting prerequisite rather than returning only a generic denial.

---

### User Story 6 - Gate Slack Channels to Multiple Agents, Tools, and Knowledge Bases (Priority: P2)

A team administrator wants one Slack channel to provide access to several agents, tools, and knowledge bases. The channel should no longer be limited to a single bound agent. Channel access should be governed by ReBAC relationships and should require both channel permission and resource permission.

**Why this priority**: Slack channels are collaboration spaces, not one-agent endpoints. The current one-to-one channel-agent mapping cannot represent real team workflows.

**Independent Test**: Can be fully tested by granting one Slack channel access to several agents and knowledge bases, invoking each from Slack as an authorized and unauthorized user, and confirming that access follows the configured relationships.

**Acceptance Scenarios**:

1. **Given** a Slack channel is associated with a CAIPE team, **When** a team administrator grants the channel access to three agents, **Then** users in that team can choose from those agents in that channel subject to their resource permissions.
2. **Given** an agent is not allowed in a Slack channel, **When** a user attempts to invoke that agent from the channel, **Then** CAIPE denies the request even if the user can use the agent elsewhere.
3. **Given** a Slack channel has access to a knowledge base but not an ingestion permission, **When** a user asks a question from the channel and later attempts ingestion, **Then** reading is allowed and ingestion is denied.

---

### User Story 7 - Maintain Keycloak Realm Roles During the Transition (Priority: P3)

A platform administrator needs the system to continue working while authorization transitions from role-heavy checks to ReBAC-first checks. Keycloak realm roles must remain understandable, bounded, and compatible with existing JWT-based paths until ReBAC is authoritative for each resource.

**Why this priority**: Existing clients and services depend on Keycloak realm roles. A safe migration requires clear role semantics and a way to compare current role-based decisions with the target ReBAC decisions.

**Independent Test**: Can be fully tested by reviewing a user's roles and ReBAC relationships side by side, then confirming the system applies the expected decision during the migration period.

**Acceptance Scenarios**:

1. **Given** a user has legacy realm roles and new ReBAC relationships, **When** an administrator opens an access explanation, **Then** CAIPE shows which decision source allowed or denied the action.
2. **Given** a resource type has been migrated to ReBAC enforcement, **When** a stale resource-specific realm role exists, **Then** it no longer grants access by itself.
3. **Given** the system still relies on realm roles for a not-yet-migrated resource type, **When** an administrator checks access, **Then** CAIPE clearly marks the resource as using transitional role-based enforcement.

### Edge Cases

- Upstream enterprise group names match multiple regex clusters; CAIPE must select a deterministic winner by priority and report the ambiguity.
- Two different upstream groups normalize to the same CAIPE team slug; CAIPE must prevent accidental merges unless an administrator explicitly maps them to the same team.
- A synced group contains users who do not have linked CAIPE identities; CAIPE must skip them, report them, and avoid creating orphan access relationships.
- A user is granted membership by multiple sources, such as Okta group, AD group, and manual assignment; CAIPE must remove access only when all granting sources are gone.
- A manually managed team has the same name as a newly discovered enterprise group; CAIPE must link or reject based on administrator-approved mapping rules, not silently overwrite ownership.
- An enterprise group is deleted or renamed upstream; CAIPE must show the missing source, avoid deleting manually managed teams automatically, and apply configured pruning rules only to managed memberships.
- A scoped administrator attempts to manage policies outside their scope; CAIPE must deny the action and record the denial.
- A Slack channel has multiple agents and tools but a user has access to only some of them; CAIPE must show only allowed choices and deny direct attempts to invoke disallowed resources.
- Anonymous users request public resources; CAIPE must allow only resources explicitly marked as public or anonymous-readable and deny all other actions.
- A policy change would remove the last administrator for a team, channel, or critical resource; CAIPE must warn and require an authorized override or prevent the change.
- The all-relationships graph is very large; CAIPE must provide filtering, pagination, or scope controls so administrators can still investigate access paths.
- Sync runs partially fail; CAIPE must report which groups, users, teams, and relationships succeeded or failed and avoid presenting an incomplete run as successful.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CAIPE MUST support configurable identity group synchronization from enterprise identity sources including Okta groups, Active Directory groups, and OIDC group claims where available.
- **FR-002**: CAIPE MUST support multiple ordered regex mapping clusters for enterprise groups, including include patterns, exclude patterns, priority, captured team names, captured roles, and deterministic team slug normalization.
- **FR-003**: CAIPE MUST provide a dry-run mode for identity group sync that shows matched groups, ignored groups, teams to create, existing teams to link, memberships to add, memberships to remove, conflicts, skipped users, and ReBAC relationship changes before any changes are applied.
- **FR-004**: CAIPE MUST create a CAIPE team automatically when an approved identity group mapping resolves to a team that does not exist and no conflict is detected.
- **FR-005**: CAIPE MUST allow administrators to manually create teams, add members, remove members, assign team administrators, and manage membership independently of enterprise group sync.
- **FR-006**: CAIPE MUST track membership source information for each team membership, including whether the membership is manual, synced, managed, inherited, active, stale, or pending user linkage.
- **FR-007**: CAIPE MUST preserve manually managed memberships during automated sync unless an authorized administrator explicitly removes them.
- **FR-008**: CAIPE MUST reconcile enterprise group membership into ReBAC user-team relationships for member and team-admin roles.
- **FR-009**: CAIPE MUST treat absence of an allow relationship as deny for every protected action.
- **FR-010**: CAIPE MUST support explicit anonymous or public access only through intentionally configured relationships; anonymous access MUST NOT be inferred from missing authentication.
- **FR-011**: CAIPE MUST define a standard action vocabulary for resources: discover, read, use, write, create, delete, manage, administer, audit, approve, and share.
- **FR-012**: CAIPE MUST represent every atomic protected resource as a ReBAC resource, including users, teams, enterprise groups, Slack workspaces, Slack channels, agents, MCP servers, tools, knowledge bases, documents, skills, tasks, conversations, admin surfaces, policies, audit views, secrets references, and system-level configuration scopes.
- **FR-013**: CAIPE MUST support scoped administrators for each eligible resource type, including teams, Slack channels, agents, tools, knowledge bases, skills, tasks, policies, audit views, and admin pages.
- **FR-014**: CAIPE MUST support admin page access as ReBAC-managed resources so that page visibility, read access, write access, and management actions can be scoped by team or resource ownership.
- **FR-015**: CAIPE MUST provide a UI for creating, updating, previewing, saving, and revoking ReBAC policies without requiring administrators to type raw relationship data.
- **FR-016**: CAIPE MUST validate policy changes before saving and reject unsupported relationships, malformed resource identifiers, unsupported actions, and privilege escalation attempts.
- **FR-017**: CAIPE MUST provide a staged policy diff experience that clearly separates grants, revocations, unchanged relationships, and relationships blocked by validation.
- **FR-018**: CAIPE MUST provide a policy access checker that answers whether a subject can perform an action on a resource and explains the access path or missing prerequisite.
- **FR-019**: CAIPE MUST provide a graph visualization for all ReBAC relationships and allow administrators to filter by subject, team, enterprise group, Slack channel, resource type, resource identifier, action, source, and enforcement status.
- **FR-020**: CAIPE MUST support Slack channels as first-class ReBAC resources.
- **FR-021**: CAIPE MUST support one Slack channel having access to multiple agents, tools, and knowledge bases.
- **FR-022**: CAIPE MUST require Slack invocations to satisfy channel access, selected-agent access, selected-tool access, and selected-knowledge-base access as applicable.
- **FR-023**: CAIPE MUST support channel-scoped administrators who can manage only allowed channel relationships and cannot grant resources they do not control.
- **FR-024**: CAIPE MUST support resource templates or policy rules that automatically create baseline ReBAC relationships for newly synced teams, while requiring administrators to preview and approve any rule that grants access beyond team membership.
- **FR-025**: CAIPE MUST keep Keycloak realm roles documented and bounded during migration, distinguishing bootstrap roles, transitional compatibility roles, and resource-specific roles planned for replacement by ReBAC checks.
- **FR-026**: CAIPE MUST ensure Keycloak realm roles do not become the long-term source of resource authorization once the equivalent ReBAC enforcement is active.
- **FR-027**: CAIPE MUST record audit events for identity sync runs, team creation, membership changes, policy changes, access checks, denials, and administrative overrides.
- **FR-028**: CAIPE MUST provide drift detection between enterprise identity groups, CAIPE teams, Keycloak realm roles, and ReBAC relationships.
- **FR-029**: CAIPE MUST clearly label each resource type's enforcement status as not gated, role-gated, ReBAC-shadowed, ReBAC-enforced, or deprecated.
- **FR-030**: CAIPE MUST provide safe migration visibility so administrators can compare legacy role decisions against ReBAC decisions before switching a resource type to ReBAC enforcement.
- **FR-031**: CAIPE MUST prevent policy updates that would leave critical resources without any administrator unless an explicit break-glass workflow is used.
- **FR-032**: CAIPE MUST support importing or discovering enterprise groups without automatically granting access until mapping rules are enabled.
- **FR-033**: CAIPE MUST provide clear remediation for skipped or unresolved users, including missing identity links, duplicate identities, disabled accounts, and inactive upstream users.
- **FR-034**: CAIPE MUST support revocation propagation so removed group membership, removed team membership, disabled users, and deleted resources no longer authorize access after reconciliation.
- **FR-035**: CAIPE MUST expose relationship ownership metadata so administrators can distinguish relationships created manually, by identity sync, by default rules, by migration, or by system bootstrap.
- **FR-036**: CAIPE MUST support three identity sync operating modes: dry run preview, scheduled reconciliation, and login-time user refresh from trusted group claims when available.
- **FR-037**: CAIPE MUST provide an Identity Group Sync admin surface for provider selection, mapping cluster management, dry-run preview, matched group review, generated team review, membership diffs, sync status, errors, and skipped-user remediation.
- **FR-038**: CAIPE MUST support mapping rule outputs that create team membership and team administrator relationships without granting agents, tools, knowledge bases, skills, or tasks unless a separate approved policy rule explicitly grants those resources.
- **FR-039**: CAIPE MUST use immutable upstream group identifiers when available and MUST treat display names as mutable labels for matching, display, and administrator review.
- **FR-040**: CAIPE MUST require administrator review before enabling a new group mapping cluster that can create teams or managed memberships.

### Resource Authorization Matrix

| Resource Type | Examples | Minimum Supported Actions | Admin Scope Examples |
|---------------|----------|---------------------------|----------------------|
| Organization | `organization:default` | discover, read, manage, audit | Platform administrators manage global defaults and integrations |
| User | `user:<subject>` | read, manage, audit | User self-service for own profile; platform administrators for identity links |
| Enterprise group | `external_group:<provider>:<id>` | discover, read, map, audit | Identity administrators manage group-to-team mappings |
| Team | `team:<slug>` | discover, read, write, manage, audit | Team administrators manage members and team-owned grants |
| Slack workspace | `slack_workspace:<id>` | discover, read, manage, audit | Platform or Slack administrators manage workspace-level settings |
| Slack channel | `slack_channel:<id>` | discover, read, use, write, manage, audit | Channel administrators manage allowed agents, tools, and knowledge bases |
| Agent | `agent:<id>` | discover, read, use, write, manage, audit | Agent administrators manage configuration and grants |
| MCP server | `mcp_server:<id>` | discover, read, use, manage, audit | Platform administrators manage server-level registration |
| Tool | `tool:<id-or-prefix>` | discover, read, use, manage, audit | Tool administrators manage tool grants and availability |
| Knowledge base | `knowledge_base:<id>` | discover, read, use, write, ingest, administer, audit | KB administrators manage content and ingestion rights |
| Document | `document:<id>` | discover, read, write, delete, share, audit | Document owners or KB administrators manage document access |
| Skill | `skill:<id>` | discover, read, use, write, manage, audit | Skill administrators manage execution and configuration |
| Task | `task:<id>` | discover, read, use, write, manage, audit | Task administrators manage task templates and execution rights |
| Conversation | `conversation:<id>` | discover, read, write, share, delete, audit | Conversation owner or delegated team administrators manage sharing |
| Admin surface | `admin_surface:<area>` | discover, read, write, manage, audit | Scoped administrators see and edit only authorized admin areas |
| Policy | `policy:<id>` | discover, read, write, approve, manage, audit | Policy administrators author and approve relationship changes |
| Audit view | `audit_log:<scope>` | discover, read, audit | Auditors and scoped administrators view permitted audit data |
| Secret reference | `secret_ref:<id>` | discover, read-metadata, use, manage, audit | Secret administrators manage references without exposing values |
| System configuration | `system_config:<area>` | discover, read, write, manage, audit | Platform administrators manage global settings |

### Keycloak Realm Role Policy

- **KR-001**: Keycloak realm roles SHOULD be limited to identity bootstrap, platform-wide break-glass access, migration compatibility, and coarse authenticated-user classification.
- **KR-002**: Existing resource-specific realm roles such as team, agent, tool, task, and skill roles MAY remain during migration but MUST be documented as transitional when an equivalent ReBAC policy exists.
- **KR-003**: ReBAC MUST become the source of truth for resource authorization once a resource type is marked ReBAC-enforced.
- **KR-004**: The system MUST provide visibility into which roles are still active, which relationships supersede them, and which users depend on transitional roles.
- **KR-005**: Realm-role drift MUST be detectable when roles disagree with the intended ReBAC state.

### ReBAC Relationship Concepts

- **RC-001**: Users can have direct relationships to resources, but team-based relationships SHOULD be preferred for maintainability.
- **RC-002**: Enterprise groups can map to teams and membership roles, but enterprise group existence alone MUST NOT grant access to agents, tools, knowledge bases, skills, or tasks unless a policy rule explicitly grants it.
- **RC-003**: Teams can have member and admin relationships. Team administrators can receive scoped rights to manage team-owned resources.
- **RC-004**: Slack channels can have allowed agents, allowed tools, allowed knowledge bases, allowed teams, and channel administrators.
- **RC-005**: Resource administrators can grant relationships only within their authorized scope and only for actions they are authorized to delegate.
- **RC-006**: Policy rules can create automatic baseline relationships, but the system MUST show generated relationships and their source.

### Identity Group Sync Model

The target group-sync flow is:

```text
Okta / AD / OIDC group
  -> ordered regex mapping cluster
  -> CAIPE team
  -> ReBAC team membership or team admin relationship
  -> resource access through existing team-to-resource ReBAC relationships
```

Representative mappings:

```text
Enterprise group: CAIPE-Platform-Engineering-Members
  -> team:platform-engineering
  -> user:<subject> member team:platform-engineering

Enterprise group: CAIPE-Platform-Engineering-Admins
  -> team:platform-engineering
  -> user:<subject> admin team:platform-engineering
```

Mapping clusters MUST support:

- Multiple group naming conventions across providers.
- Ordered priority so the same group cannot be resolved differently by accident.
- Include patterns and exclude patterns.
- Captured fields for team name, team slug, and role.
- Role maps that translate upstream naming such as `Members`, `Admins`, `RO`, `RW`, or `Admin` into CAIPE relationships.
- Deterministic slug normalization and collision detection.
- Provider-specific behavior for Okta, Active Directory, and OIDC group claims.
- Team auto-creation when a mapping is approved and no conflicting team exists.

The sync modes are:

- **Dry run**: Shows matched groups, teams to create, memberships to add, memberships to remove, skipped users, conflicts, warnings, and ReBAC relationship diffs without writing changes.
- **Scheduled reconciliation**: Periodically reconciles trusted upstream groups into CAIPE teams and ReBAC relationships according to enabled mapping clusters.
- **Login-time refresh**: Uses trusted group claims available during login to refresh that user's managed memberships quickly, while scheduled reconciliation remains the source for full group cleanup and drift detection.

CAIPE MUST record these logical data records for explainability and audit:

- **Identity group sync rule**: Defines provider, priority, matching rules, role mapping, target team naming, enablement status, and review status.
- **Identity group sync run**: Records dry-run or applied run inputs, matched groups, generated changes, results, warnings, errors, and actor.
- **External group team link**: Records which upstream group maps to which CAIPE team and whether the link is active, stale, or conflicted.
- **Team membership source**: Records why a user has a membership or admin relationship, including manual source, synced source, upstream group, mapping rule, managed status, and last-seen status.

Manual membership sources remain valid alongside synced sources. Removing a user from an upstream group removes only the relationship source managed by that upstream group. The user keeps access if another active source still grants the same team relationship.

External groups MAY be represented as graph resources for explanation and audit paths, but external group existence alone MUST NOT authorize access to application resources. The authoritative access relationship remains the resolved user-to-team and team-to-resource ReBAC path.

### Identity Group Sync Admin Surface

CAIPE MUST provide an admin surface for identity group sync with:

- Provider configuration status for Okta, Active Directory, and OIDC group claims.
- Regex mapping cluster editor with examples, validation, priority ordering, includes, excludes, capture previews, and role-map previews.
- Dry-run preview that lists matched groups, ignored groups, generated teams, linked teams, membership adds, membership removals, tuple changes, skipped users, and conflicts.
- Matched group table showing provider, external group identifier, display name, matched cluster, generated team, generated role, and last sync status.
- Team creation review for teams that do not already exist.
- Membership diff review separating manual memberships from managed memberships.
- Last sync status, run history, warnings, errors, skipped-user remediation, and drift findings.
- Access checks showing whether a user received access from manual membership, Okta group, AD group, OIDC group claim, or policy rule.

Access to the Identity Group Sync admin surface itself MUST be ReBAC-gated. Platform administrators can manage global sync rules. Scoped administrators can view only group-to-team mappings and sync findings for teams or resources they are allowed to administer.

### Key Entities *(include if feature involves data)*

- **Identity Provider**: An upstream authority such as Okta, Active Directory, or OIDC group claims that provides user and group membership information.
- **Identity Group Mapping Cluster**: An ordered set of matching rules that transforms upstream group names or identifiers into CAIPE teams, membership roles, and optional default ReBAC relationships.
- **Identity Group**: An external group with provider identity, display name, immutable external identifier where available, membership list, and mapping status.
- **CAIPE Team**: A local collaboration and authorization grouping with slug, display name, administrators, members, source metadata, and related resources.
- **Team Membership Source**: A record explaining why a user is a team member or team administrator, including manual, synced, inherited, default, or bootstrap source.
- **Keycloak Realm Role**: A token-visible role used for bootstrap, global privileges, or transitional compatibility during migration to ReBAC.
- **ReBAC Subject**: A user, team, team member set, team admin set, enterprise group, service account, or anonymous subject that can be granted relationships.
- **ReBAC Resource**: Any protected object that can be discovered, read, used, changed, managed, audited, shared, or administered.
- **ReBAC Relationship**: A typed authorization fact connecting a subject to an action on a resource.
- **Policy Rule**: A reusable rule that generates or validates ReBAC relationships, such as default team membership, Slack channel access, or baseline team-owned resource access.
- **Policy Change Set**: A staged set of grants and revocations awaiting validation, review, approval, or save.
- **Policy Access Check**: A request to evaluate whether a subject can perform an action on a resource, including an explanation of allow or deny.
- **Authorization Graph**: A visual representation of subjects, resources, relationships, inheritance paths, sync sources, and enforcement status.
- **Slack Channel Grant**: A relationship that allows a Slack channel to use one or more agents, tools, and knowledge bases, subject to user and team permissions.
- **Sync Run**: A dry-run or applied reconciliation attempt with matched groups, generated changes, results, errors, warnings, and audit metadata.
- **Drift Finding**: A detected mismatch between upstream identity groups, CAIPE teams, Keycloak roles, and ReBAC relationships.

### Assumptions

- Okta and Active Directory group names are the initial source for automatic team creation and membership; other providers can follow the same group mapping model later.
- When an upstream group has a stable external identifier, CAIPE treats that identifier as authoritative and uses display names only for matching and readability.
- Manual memberships and manually created teams are valid first-class state and are not overwritten by sync unless explicitly configured.
- ReBAC is the desired long-term authorization source for all resource decisions, while Keycloak continues to provide authentication, token issuance, and limited bootstrap roles.
- Anonymous access is supported only for explicitly public resources and is modeled as a deliberate relationship.
- Policy authoring requires auditability and validation before save; direct low-level relationship editing is reserved for appropriately authorized administrators.
- Slack channel access is many-to-many: one channel can use many agents, tools, and knowledge bases, and one resource can be available in many channels.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An administrator can configure a group mapping cluster and complete a dry-run preview for at least 500 enterprise groups in under 5 minutes.
- **SC-002**: For a representative sync run of 100 groups and 5,000 users, CAIPE reports teams to create, memberships to add, memberships to remove, skipped users, and policy changes with 100% traceability to source groups.
- **SC-003**: At least 95% of common team onboarding cases require no manual membership edits after group sync rules are enabled.
- **SC-004**: 100% of protected resource types listed in the Resource Authorization Matrix can be represented as ReBAC resources with at least read and manage decision checks.
- **SC-005**: 100% of denied access checks identify either no matching allow relationship, a missing prerequisite relationship, an inactive subject, an inactive resource, or a scope boundary violation.
- **SC-006**: A scoped administrator can complete a policy grant or revocation in the UI in under 3 minutes without typing raw relationship data.
- **SC-007**: The all-relationships graph can load a filtered view for a selected team, user, Slack channel, or resource in under 5 seconds for typical administrative datasets.
- **SC-008**: Slack channels can be configured with at least 10 allowed agents, 20 allowed tools, and 20 allowed knowledge bases without changing the authorization model.
- **SC-009**: Manual team memberships survive automated sync in 100% of cases unless explicitly removed by an authorized administrator.
- **SC-010**: Drift detection identifies mismatches between identity group membership and CAIPE team membership within one sync cycle.
- **SC-011**: All policy changes, sync-applied relationship changes, access-check denials, and administrative overrides produce audit records sufficient to reconstruct who changed what, when, why, and from which source.
- **SC-012**: During migration, administrators can identify every resource type as not gated, role-gated, ReBAC-shadowed, ReBAC-enforced, or deprecated from a single authorization status view.

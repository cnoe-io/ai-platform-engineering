# Feature Specification: Service Accounts

**Feature Branch**: `2026-06-05-service-accounts`
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "Service Accounts — user-minted, team-owned bot identities for external/API access (GitHub issue #1677)."

## Clarifications

### Session 2026-06-05

- Q: Should service-account activity be audited, and at what level? → A: Audit BOTH lifecycle events (create / scope add / scope remove / rotate / revoke, with actor + target) AND call-time authentication/authorization decisions (allow/deny) made under a service-account credential.
- Q: Must service-account names be unique, and within what boundary? → A: Unique within the owning team (two different teams may reuse the same name).
- Q: Is revocation reversible, and what happens to the record and its name? → A: Revocation is terminal and irreversible; the record is retained (soft-deleted) for audit, and its name is freed for reuse within the team.
- Q: How does v1 behave if caller-keyed tool authorization (FR-012's prerequisite) isn't delivered in time? → A: SUPERSEDED — see next item. Closing the caller-keyed gap is now in scope for this work.
- Q: Is the caller-keyed tool-authorization gap an external dependency or part of this work? → A: Part of this work. Confirmed by Sri (platform owner) in the RBAC thread as a real gap ("we are not checking the user has access to the tool at the agentgateway layer … we need to fix it, should be a quick fix"). The gap affects ALL callers (human users today, not only service accounts) — a confused-deputy/privilege-escalation surface where a caller's effective tool reach is the union of tools granted to every agent they may use. This work MUST add a caller-keyed tool-authorization check at the AgentGateway layer for both `user` and `service_account` subjects.

## Overview

Today, calling a CAIPE agent or tool requires an interactive user session. External systems —
CI pipelines, monitoring alerts, incident webhooks, other internal services — have no first-class
way to authenticate.

A **Service Account** is a named, team-owned bot identity with its own credential and its own
scoped access to specific agents and tools. External systems authenticate *as* the service
account to call CAIPE without a human in the loop. A service account's access is independent of
any individual user, but it can never be created with more access than the person creating it
already has.

This is distinct from the platform's internal machine identities (e.g. the Slack/Webex bots,
which are provisioned by operators). Service accounts are **self-service** and **team-managed**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a service account scoped to what I can access (Priority: P1)

A user who belongs to one or more teams opens **Admin → Settings → Service Accounts** and creates
a service account. They give it a name and description, choose one of their teams to own it, and
select the agents and tools it should be able to use — choosing only from the agents and tools they
themselves can already access. On creation they are shown the credential exactly once and copy it
for use by their external system.

**Why this priority**: This is the core of the feature — without create + one-time credential
reveal, there is no usable service account. It is the minimum that delivers value.

**Independent Test**: Sign in as a user with access to at least one agent, create a service account
owned by a team the user belongs to, grant it that agent, and confirm the credential is displayed
once and can be copied.

**Acceptance Scenarios**:

1. **Given** a user who belongs to at least one team, **When** they open the Service Accounts tab,
   **Then** they can start creating a service account and must choose an owning team from the teams
   they belong to.
2. **Given** the create form, **When** the user picks the resources to grant, **Then** only agents
   and tools the user currently has access to are offered for selection.
3. **Given** a completed create form, **When** the user submits, **Then** a new service account is
   created owned by the chosen team, granted exactly the selected scopes, and the credential is
   displayed exactly once.
4. **Given** the one-time credential display, **When** the user dismisses or navigates away,
   **Then** the credential can never be retrieved again through the UI.
5. **Given** a user attempts to grant a scope they do not personally hold (e.g. via a tampered
   request), **When** the request is processed, **Then** that scope is rejected and not granted.
6. **Given** a brand-new service account with no scopes selected, **When** it is created,
   **Then** it has access to nothing.

---

### User Story 2 - Use a service account to call CAIPE from an external system (Priority: P1)

An external system (CI job, alert handler, webhook) presents the service account's credential when
calling a CAIPE agent. The platform recognizes the service account as its own identity and allows
the call only if the service account was granted that agent — and allows downstream tool calls only
if the service account was granted those tools. Holding access to an agent does not by itself grant
access to the tools that agent can use.

**Why this priority**: A service account that cannot actually authenticate and be correctly
authorized end-to-end delivers no value. This is the other half of the MVP.

**Independent Test**: With a service account granted `agent:A` but not `tool:T`, call `agent:A` with
the credential and confirm the agent runs; confirm a call that would require `tool:T` is denied; then
grant `tool:T` and confirm it succeeds.

**Acceptance Scenarios**:

1. **Given** a service account granted access to `agent:A`, **When** an external caller invokes
   `agent:A` with the service account's credential, **Then** the call is authenticated and authorized.
2. **Given** a service account NOT granted access to `agent:B`, **When** a caller invokes `agent:B`
   with its credential, **Then** the call is denied.
3. **Given** a service account granted `agent:A` but not `tool:T`, **When** invoking `agent:A`
   triggers a call to `tool:T`, **Then** the tool call is denied — agent access alone does not grant
   tool access.
4. **Given** a service account granted both `agent:A` and `tool:T`, **When** invoking `agent:A`
   triggers `tool:T`, **Then** the tool call is allowed.
5. **Given** an invalid, revoked, or unknown credential, **When** a caller presents it,
   **Then** the call is rejected.

---

### User Story 3 - Manage scopes after creation (Priority: P2)

A member of the owning team opens an existing service account and adjusts its access: adding new
agents or tools, or removing existing ones. Adding a scope requires that the editing member
currently holds that scope. Removing a scope is always allowed for any owning-team member, even a
scope they could not themselves grant.

**Why this priority**: Access needs change over time; without post-create editing, users would have
to delete and recreate (and redistribute credentials). Valuable but not required for first use.

**Independent Test**: As an owning-team member, add a scope you hold (succeeds), attempt to add a
scope you don't hold (rejected), and remove a scope that was added by someone else (succeeds).

**Acceptance Scenarios**:

1. **Given** an owning-team member viewing a service account, **When** they add a scope they
   currently hold, **Then** the service account gains that access.
2. **Given** an owning-team member, **When** they attempt to add a scope they do NOT currently hold,
   **Then** the addition is rejected.
3. **Given** an owning-team member, **When** they remove any existing scope (including one they could
   not themselves grant), **Then** the service account loses that access.
4. **Given** scopes are changed, **When** the change is saved, **Then** the service account's
   credential is unchanged (editing scopes does not rotate the credential).

---

### User Story 4 - Rotate and revoke (Priority: P2)

A member of the owning team rotates a service account's credential (e.g. on suspected leak),
receiving a new credential shown once while the old one stops working. Or they revoke the service
account entirely, after which its credential no longer authenticates and all of its access is
removed.

**Why this priority**: Credential hygiene and incident response. Important for production trust,
but the account is usable before these exist.

**Independent Test**: Rotate a service account and confirm the old credential is rejected and a new
one is shown once; revoke a service account and confirm its credential no longer works and its
access is gone.

**Acceptance Scenarios**:

1. **Given** an owning-team member, **When** they rotate the credential, **Then** a new credential is
   shown exactly once and the previous credential stops authenticating.
2. **Given** an owning-team member, **When** they revoke the service account, **Then** its credential
   no longer authenticates and all of its granted access is removed.
3. **Given** a revoked service account, **When** anyone views the Service Accounts list,
   **Then** it is no longer presented as usable.

---

### User Story 5 - Ownership and visibility boundaries (Priority: P2)

Service accounts belong to exactly one team and are not shared. Only members of the owning team can
see, manage, rotate, or revoke a given service account. A user who is not a member of the owning team
cannot view or affect it.

**Why this priority**: Defines the access-control boundary of the feature itself. Required for the
feature to be trustworthy in a multi-team org, but layered on top of the core create/use flows.

**Independent Test**: Create a service account owned by Team A; confirm a Team A member sees and can
manage it, and a non-member (Team B only) cannot see or manage it.

**Acceptance Scenarios**:

1. **Given** a service account owned by Team A, **When** a Team A member opens the Service Accounts
   list, **Then** they see it and can manage it.
2. **Given** the same service account, **When** a user who is only in Team B opens the list,
   **Then** they do not see it and cannot manage, rotate, or revoke it.
3. **Given** a service account, **When** it is created, **Then** it is owned by exactly one team and
   cannot be shared with additional teams or individual users.

---

### Edge Cases

- **User belongs to no team**: They cannot create a service account (no valid owning team).
- **Creating user later loses a granted permission**: The service account KEEPS its access (access
  is static / fire-and-forget; it is not re-derived from the creator over time).
- **Owning team is deleted**: Team deletion is blocked while the team still owns any service
  accounts. The team's members must revoke (or otherwise remove) its service accounts first; only
  then can the team be deleted. This prevents orphaned, unmanageable identities. (See FR-025.)
- **Granted agent or tool is deleted**: The corresponding grant becomes inert; calls referencing the
  removed resource fail as they would for any caller. The service account remains otherwise usable.
- **Two members of the owning team edit the same service account concurrently**: Scope changes are
  applied per scope; the resulting access reflects the union of adds minus removes, with the
  permission-bound check applied per add.
- **Credential is lost by the operator** (never copied or misplaced): It cannot be recovered; the
  only remedy is to rotate to obtain a new credential.
- **A scope is removed while an external call is in flight**: The in-flight call completes under the
  access in effect at the time of the authorization check; subsequent calls are evaluated against
  the new scopes.

## Requirements *(mandatory)*

### Functional Requirements

#### Creation & identity
- **FR-001**: The system MUST allow any authenticated user who belongs to at least one team to create
  a service account.
- **FR-002**: The system MUST require each service account to be owned by exactly one team, chosen
  from the teams the creating user belongs to.
- **FR-002a**: The system MUST require a service account's name to be unique among *active* service
  accounts within its owning team, and MUST reject creation that would collide with an existing active
  name in the same team. Name comparison for uniqueness MUST be case-insensitive (e.g.
  "Incident-Bot" collides with "incident-bot"). The same name MAY be reused by a different team, or
  reused within the team once the prior holder is revoked.
- **FR-003**: The system MUST give each service account its own distinct identity and its own
  credential, independent of any user identity.
- **FR-004**: A newly created service account MUST have access to nothing until scopes are explicitly
  granted.
- **FR-005**: The system MUST display a service account's credential exactly once, at the moment it is
  created (and again only when rotated), and MUST NOT provide any way to retrieve it afterward.

#### Permission-bounded granting
- **FR-006**: The system MUST allow granting a service account only those agent and tool scopes that
  the acting user currently holds.
- **FR-007**: The grantable set MUST be based on the acting user's own effective access (which may
  aggregate access from multiple of the user's teams), NOT on the owning team's access.
- **FR-008**: The system MUST enforce the permission bound at the time access is written, rejecting
  any requested scope the acting user does not currently hold — regardless of what the interface
  offered.
- **FR-009**: When presenting choices, the system MUST offer only resources the acting user currently
  has access to.

#### Authorization at call time
- **FR-010**: The system MUST authenticate external callers presenting a valid service account
  credential as that service account's identity.
- **FR-011**: The system MUST authorize agent invocations against the service account's own granted
  access — allowing only agents the service account was granted.
- **FR-012**: The system MUST authorize tool calls against the service account's own granted access,
  such that access to an agent does NOT by itself confer access to the tools that agent can use.
- **FR-012a**: This work MUST close the existing caller-keyed tool-authorization gap as part of its
  scope. Today the runtime enforces tool calls only against the agent's identity
  (`agent → tool`), not the caller's, so a caller's effective tool reach is the union of tools
  granted to every agent they may use (a confused-deputy / privilege-escalation surface). The system
  MUST add a caller-keyed tool-authorization check at the gateway layer so that a tool call is
  permitted only when BOTH the agent AND the calling subject are authorized for that tool.
- **FR-012b**: The caller-keyed tool-authorization check MUST apply to ALL caller subjects — both
  human users and service accounts — not only to service accounts. (The gap affects regular users
  today; service accounts inherit the same enforcement.)
- **FR-012c**: Enabling caller-keyed tool enforcement MUST NOT silently break existing human callers
  who currently rely on transitive (agent-granted) tool access. Rollout MUST either (a) backfill
  direct tool grants for callers based on their current effective access before enforcement is
  turned on, or (b) gate the new check behind a configuration flag with a documented migration path.
  The chosen approach MUST be stated in operator docs.
- **FR-013**: The system MUST reject calls presenting an invalid, unknown, or revoked credential.

#### Lifecycle & management
- **FR-014**: The system MUST allow any member of the owning team to view a service account and its
  current granted scopes.
- **FR-015**: The system MUST allow an owning-team member to ADD a scope only if that member
  currently holds the scope being added.
- **FR-016**: The system MUST allow any owning-team member to REMOVE any existing scope, including a
  scope that member could not themselves grant.
- **FR-017**: The system MUST allow an owning-team member to rotate the credential, producing a new
  credential (shown once) and invalidating the previous one.
- **FR-018**: The system MUST allow an owning-team member to revoke a service account, after which
  its credential no longer authenticates and all of its granted access is removed.
- **FR-018a**: Revocation MUST be terminal and irreversible (a revoked service account cannot be
  reactivated). The system MUST retain the revoked record for audit purposes while excluding it from
  the active/usable list, and MUST free its name for reuse within the owning team.
- **FR-019**: Editing scopes MUST NOT change the credential; rotating the credential MUST NOT change
  scopes.
- **FR-020**: The system MUST keep a service account's granted access stable over time, unaffected by
  later changes to the creating user's own permissions.

#### Ownership & visibility
- **FR-021**: The system MUST restrict viewing and managing a service account to members of its
  owning team; non-members MUST NOT be able to see or affect it.
- **FR-022**: The system MUST NOT allow a service account to be shared with additional teams or
  individual users.
- **FR-025**: The system MUST block deletion of a team while it still owns one or more service
  accounts; those service accounts must be revoked/removed before the team can be deleted.

#### Auditing
- **FR-026**: The system MUST record an audit event for each service-account lifecycle action —
  creation, scope addition, scope removal, credential rotation, and revocation — capturing the
  acting user, the target service account, and the affected scope (where applicable).
- **FR-027**: The system MUST record an audit event for each call-time authentication/authorization
  decision (allow or deny) made under a service-account credential, identifying the service account
  and the resource (agent or tool) involved.

#### Scope (v1 boundaries)
- **FR-023**: The grantable resource types in v1 MUST be agents and tools; other resource types are
  out of scope for v1.
- **FR-024**: Credentials in v1 MUST NOT have a time-based expiry; a credential remains valid until
  rotated or revoked.

### Key Entities *(include if feature involves data)*

- **Service Account**: A named, team-owned bot identity. Attributes: name (unique within the owning
  team), description, owning team, who created it, creation time, status (active/revoked), and the set
  of granted scopes. Has exactly one credential at a time.
- **Owning Team**: The single team that owns a service account. Determines who may view and manage it.
  A service account references exactly one; a team may own many service accounts.
- **Scope / Grant**: An individual access grant tying a service account to a specific agent or tool.
  A service account has zero or more. Adding is permission-bounded; removing is unconditional for
  owning-team members.
- **Credential**: The secret an external caller presents to authenticate as the service account.
  Shown once on creation and on rotation; never retrievable otherwise. Invalidated by rotation or
  revocation.

## Assumptions

- "Access a user holds" means the user's effective permission as evaluated by the platform's existing
  authorization system at the moment of the action, aggregated across all of the user's team
  memberships.
- A service account's access is enforced by the same authorization checks that govern human callers,
  evaluated against the service account's identity rather than a user's.
- The Service Accounts management UI lives under Admin → Settings purely as the location for
  identity/account settings; it is NOT gated to platform administrators. Per-action authorization
  (team membership, permission bound) provides the real access control.
- "Tool" refers to the individually addressable tools an agent can call (MCP tools), consistent with
  how the platform already identifies and authorizes tool calls.

## In-Scope Platform Change (not just a dependency)

- **Caller-keyed tool authorization** (FR-012 / FR-012a / FR-012b): The platform currently evaluates
  tool calls only against the agent's identity, not the caller's. Closing this gap is **part of this
  work**, confirmed with the platform owner (RBAC Slack thread, 2026-06-05). Because the gap is a
  pre-existing privilege-escalation surface affecting all human users — not only service accounts —
  the fix is independently valuable and is a prerequisite for FR-012 to hold for service accounts.
  Scope of the change: add a caller-keyed `subject → tool` check at the AgentGateway authorization
  layer, evaluated together with the existing `agent → tool` check, for both `user` and
  `service_account` subjects.

## Out of Scope (v1)

- Time-based credential expiry (FR-024).
- Multiple simultaneous credentials per service account.
- Granting resource types other than agents and tools (FR-023).
- Sharing a service account across multiple teams or with individual users (FR-022).
- Automatic reconciliation when the creating user's permissions change later (FR-020 — access is
  intentionally static).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who can access at least one agent can create a working service account and obtain
  its credential in under 3 minutes, without operator/administrator involvement.
- **SC-002**: An external system can authenticate as a service account and successfully invoke a
  granted agent on the first attempt using only the credential issued at creation.
- **SC-003**: 100% of attempts to grant a service account a scope the acting user does not hold are
  rejected.
- **SC-004**: 100% of calls to agents or tools a service account was not granted are denied, including
  tool calls made while invoking an agent the service account *can* use.
- **SC-005**: A service account is visible and manageable to 100% of its owning-team members and to 0%
  of non-members.
- **SC-006**: After rotation, the previous credential is rejected on its next use; after revocation,
  the credential is rejected and the service account's access is fully removed.
- **SC-007**: A service account's granted access is unchanged after the creating user loses one of the
  permissions they originally used to grant it.
- **SC-008**: 100% of attempts to delete a team that still owns one or more service accounts are
  blocked until those service accounts are removed.
- **SC-009**: 100% of service-account lifecycle actions and call-time authorization decisions produce
  a retrievable audit record identifying the actor/service account, the action/decision, and the
  affected resource.
- **SC-010**: After the caller-keyed tool-authorization change, a caller (human user OR service
  account) who has not been granted a tool is denied that tool even when invoking an agent that can
  call it — closing the pre-existing escalation surface for 100% of unauthorized caller/tool pairs.
- **SC-011**: Enabling the caller-keyed tool check causes zero unintended denials for existing
  callers — every caller who could invoke a tool (via an agent) before the change either retains
  access through a direct grant or is intentionally revoked per policy.

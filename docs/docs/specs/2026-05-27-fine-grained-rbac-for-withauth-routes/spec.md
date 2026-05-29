# Feature Specification: Fine-Grained RBAC for `withAuth` Routes

**Feature Branch**: `prebuild/collapse-rbac-kb-prs`  
**Created**: 2026-05-28  
**Status**: Draft  
**Input**: User description: "Split the coarse `supervisor#invoke` OpenFGA gate into explicit capabilities for basic user functions, including credentials and Slack/Webex access-check routes, without creating a new branch."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Preserve Access While Splitting Capabilities (Priority: P1)

As an existing signed-in CAIPE user, I want profile, settings, chat, feedback, file, credential, and integration routes to keep working after the RBAC split, so the migration does not interrupt normal usage.

**Why this priority**: The current `supervisor#invoke` gate covers many unrelated signed-in user functions. The first migration slice must preserve behavior while replacing the misleading shared capability with explicit names.

**Independent Test**: Can be tested by signing in as a user who currently satisfies `supervisor#invoke` and exercising representative routes from each new capability bucket.

**Acceptance Scenarios**:

1. **Given** a user currently has the organization-level access required for `supervisor#invoke`, **When** the new capability model is active, **Then** profile, settings, chat, feedback, credential, file, AI assist, Slack access-check, and Webex access-check routes remain reachable where their existing deeper resource checks allow access.
2. **Given** a route is protected only by the legacy `withAuth` umbrella today, **When** the route is migrated, **Then** its audit record uses a capability that describes the actual route purpose rather than `supervisor#invoke`.
3. **Given** a new BFF route is added later, **When** no explicit capability mapping exists, **Then** the route does not silently inherit `supervisor#invoke`.

---

### User Story 2 - Revoke Chat Without Breaking Basic Account Functions (Priority: P1)

As an administrator, I want chat access to be independently revocable from profile, settings, feedback, and directory access, so I can disable the assistant surface without locking a user out of account functions.

**Why this priority**: The main security issue with the current gate is that revoking one broad tuple removes unrelated functions at the same time.

**Independent Test**: Can be tested by revoking the chat capability for one user and confirming chat routes deny while self-profile and settings routes still allow.

**Acceptance Scenarios**:

1. **Given** a user has access to self-service account routes but lacks the chat capability, **When** the user calls chat or A2A routes, **Then** the request is denied with a chat-specific capability code.
2. **Given** the same user calls self-profile, settings, feedback, or NPS routes, **When** the route is not chat-related, **Then** the request is evaluated against the matching non-chat capability.
3. **Given** an audit reviewer inspects denied chat events, **When** the event is recorded, **Then** the capability name clearly identifies chat access rather than generic supervisor invocation.

---

### User Story 3 - Protect Credential APIs With Credential-Specific FGA (Priority: P1)

As a user or service retrieving stored credentials, I want every credential operation to require an appropriate credential or secret relationship, so credential APIs cannot be accessed only because the caller can use the assistant.

**Why this priority**: Credential APIs are sensitive and already have resource-level `secret_ref` concepts. The BFF-level gate must stop reporting them as `supervisor#invoke`.

**Independent Test**: Can be tested by calling credential list, retrieve, create, update, share, health, audit, connection, and exchange flows with callers that have only broad signed-in access versus callers with the correct credential relationships.

**Acceptance Scenarios**:

1. **Given** a caller has basic CAIPE access but no credential-vault capability, **When** the caller reaches a credential user API, **Then** the route denies before exposing credential metadata or payloads.
2. **Given** a caller has credential-vault access but lacks access to a specific `secret_ref`, **When** the caller tries to retrieve or use that secret, **Then** the per-secret check denies the request.
3. **Given** a caller has the required `secret_ref` relationship, **When** the caller performs the matching read, use, share, manage, or delete operation, **Then** the operation is allowed and audited with credential-specific capability context.

---

### User Story 4 - Prevent Slack/Webex Access-Check Oracles (Priority: P2)

As an administrator or integration service, I want Slack and Webex access-check routes to require visibility on the channel or space being inspected, so callers cannot probe relationships for messaging resources they should not see.

**Why this priority**: The access-check helpers already evaluate channel/space grants and user grants, but the route itself should first verify that the caller may inspect the channel or space.

**Independent Test**: Can be tested by calling each Slack/Webex access-check route as a caller with and without read access to the target channel or space.

**Acceptance Scenarios**:

1. **Given** a caller lacks read access to `slack_channel:<workspace>--<channel>`, **When** the caller invokes the Slack access-check route for that channel, **Then** the route denies before returning relationship details.
2. **Given** a caller has read access to the Slack channel, **When** the caller invokes the access-check route, **Then** the route evaluates the requested channel grant and user grant as it does today.
3. **Given** a caller lacks read access to `webex_space:<workspace>--<space>`, **When** the caller invokes the Webex access-check route for that space, **Then** the route denies before returning relationship details.
4. **Given** a caller has read access to the Webex space, **When** the caller invokes the access-check route, **Then** the route evaluates the requested space grant and user grant as it does today.

---

### User Story 5 - Improve Audit and Support Triage (Priority: P3)

As an operator investigating access failures, I want audit events to name the actual denied function, so I can tell whether a failure involved chat, profile, credentials, files, Slack, Webex, or another surface.

**Why this priority**: The current shared capability hides the route purpose and makes support, revocation validation, and policy debugging harder.

**Independent Test**: Can be tested by forcing one allow and one deny event in each new capability bucket and reviewing the resulting audit records.

**Acceptance Scenarios**:

1. **Given** a denied credential retrieval, **When** the audit event is written, **Then** the capability identifies credential or `secret_ref` access rather than supervisor invocation.
2. **Given** a denied Slack or Webex access-check, **When** the audit event is written, **Then** the capability identifies the messaging resource inspection.
3. **Given** a denied self-profile, settings, feedback, or AI assist request, **When** the audit event is written, **Then** the capability identifies that user-facing surface.

### Edge Cases

- Existing users and service accounts must keep working after the new capabilities are introduced unless an existing resource-level check already denies them.
- Routes that already perform deeper resource checks must keep those checks; the new route capability is not a substitute for `secret_ref`, conversation, channel, space, or target resource authorization.
- Token-only callers must have a stable subject or equivalent service-account subject before OpenFGA can evaluate resource-specific checks.
- Unsupported resource types in Slack/Webex access-check requests must still return a denial without leaking whether the caller could inspect another resource.
- Bootstrap or break-glass admin behavior must remain explicit and auditable; it must not silently reintroduce a broad `supervisor#invoke` bypass.
- Missing route mappings must fail loudly during development or produce an explicit warning during a transition period.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST replace the legacy `supervisor#invoke` fallback for `withAuth`-only routes with explicit route capabilities that match the route purpose.
- **FR-002**: The system MUST preserve existing access automatically for users who currently satisfy the broad signed-in-user gate, unless a deeper resource-level check denies access.
- **FR-003**: The system MUST define separate capabilities for self-profile read/write, user-directory read, chat supervisor invocation, feedback submission, user-settings read/write, user-file read/write, AI assist invocation, credential-vault use, Slack channel access-check, and Webex space access-check.
- **FR-004**: The system MUST map chat and A2A routes to a chat-specific capability so chat access can be revoked without disabling self-profile, settings, feedback, or other basic account functions.
- **FR-005**: The system MUST map `/api/users/search` to a directory-read capability rather than any chat or supervisor capability.
- **FR-006**: The system MUST map self-profile and account-link routes to self-service capabilities and continue to ensure the request operates only on the caller's own account.
- **FR-007**: The system MUST protect credential user APIs with a credential-vault route capability before route-specific logic runs.
- **FR-008**: The system MUST require per-credential OpenFGA relationships for operations on a specific `secret_ref`, including use/retrieve, read, manage, share, and delete as applicable to each route.
- **FR-009**: The system MUST not treat credential-vault access as sufficient to retrieve a specific credential payload without the matching `secret_ref` relationship.
- **FR-010**: The system MUST protect Slack access-check routes by requiring the caller to have read access to the target Slack channel before evaluating requested channel and user grants.
- **FR-011**: The system MUST protect Webex access-check routes by requiring the caller to have read access to the target Webex space before evaluating requested space and user grants.
- **FR-012**: The system MUST keep existing Slack/Webex access-check semantics after the route-level read gate passes: both the channel or space grant and the target subject grant must be evaluated.
- **FR-013**: The system MUST emit audit capability names that describe the evaluated surface, not the legacy `supervisor#invoke` umbrella.
- **FR-014**: The system MUST provide tests showing that each new capability has at least one allowed and one denied case.
- **FR-015**: The system MUST document where each new capability is granted, how existing access is preserved, and how administrators can revoke each capability.
- **FR-016**: The system MUST update the RBAC route coverage inventory so future routes cannot silently inherit the legacy supervisor gate.

### Key Entities

- **Route Capability**: A named permission used by the BFF to describe the high-level surface a caller is trying to access, such as `chat_supervisor#invoke` or `credential_vault#use`.
- **Organization Capability**: A capability that applies at the CAIPE organization level and can preserve current signed-in-user behavior by deriving from existing membership or admin relationships.
- **Secret Reference**: A resource representing a stored credential. Access to it must be evaluated separately from broad credential-vault access.
- **Slack Channel Resource**: A messaging resource that can be read, managed, or used through OpenFGA relationships. Access-check routes must require read access to the channel being inspected.
- **Webex Space Resource**: A messaging resource that can be read, managed, or used through OpenFGA relationships. Access-check routes must require read access to the space being inspected.
- **Audit Event**: A record of an authorization decision that must carry the route capability or resource relationship that was actually evaluated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of routes currently falling through to `supervisor#invoke` are mapped to an explicit capability or have a documented resource-specific authorization helper.
- **SC-002**: Existing users with current signed-in access can complete representative profile, settings, chat, feedback, credential, Slack access-check, and Webex access-check flows after migration without manual tuple backfill.
- **SC-003**: Revoking the chat capability blocks chat and A2A routes while leaving self-profile, settings, and feedback routes accessible for the same user.
- **SC-004**: A caller with credential-vault access but without a required `secret_ref` relationship cannot retrieve or use that credential.
- **SC-005**: A caller without read access to a Slack channel or Webex space receives a denial from the corresponding access-check route before any requested relationship result is returned.
- **SC-006**: Authorization tests cover at least one allow and one deny case for every newly introduced route capability.
- **SC-007**: Audit records for migrated routes no longer report `supervisor#invoke` except for any deliberately retained deprecated fallback during the transition period.
- **SC-008**: RBAC documentation lists every new capability and the associated route families, grant source, and revocation behavior.

# Research: Enterprise Identity Group Sync and Universal ReBAC

## Decision: Treat enterprise groups as identity inputs, not direct application grants

**Decision**: Okta, Active Directory, and OIDC group claims will feed CAIPE team membership and team administration relationships. Enterprise group existence alone will not grant agents, tools, knowledge bases, skills, tasks, Slack channels, or admin pages.

**Rationale**: Enterprise groups are useful organizational inputs but often contain naming conventions, nesting, exceptions, and stale memberships that do not directly match product authorization intent. Resolving groups into CAIPE teams keeps enterprise identity as the source for membership while preserving product-level ReBAC as the source for resource access.

**Alternatives considered**:

- Grant resources directly from external groups. Rejected because it couples product policy to upstream naming and makes access explanations brittle when groups are renamed or repurposed.
- Ignore external groups and keep manual teams only. Rejected because it cannot scale and would drift from enterprise identity.

## Decision: Use ordered regex mapping clusters with dry-run approval

**Decision**: Group-to-team sync will use multiple ordered mapping clusters. Each cluster can include and exclude group patterns, capture team and role components, map captured role values to CAIPE member/admin relationships, and preview results before enablement.

**Rationale**: Enterprises rarely have one naming convention. Ordered clusters let CAIPE support multiple patterns without hardcoding provider-specific logic. Dry-run approval is required because mapping mistakes can create teams or revoke memberships at scale.

**Alternatives considered**:

- One global regex. Rejected because it cannot model multiple naming families or migrations.
- Manual mapping table only. Rejected because it is too costly for hundreds of groups.
- Automatic enablement after saving a rule. Rejected because unsafe mappings can create or remove access before review.

## Decision: Preserve manual membership as a separate source

**Decision**: Team membership will track source records. A user can have the same team relationship from manual assignment, Okta group, AD group, OIDC claim, bootstrap, or policy rule. Removing one source removes only that source, not the relationship if another source remains active.

**Rationale**: Manual assignments are needed for bootstrap, exceptions, temporary access, and teams that do not yet have upstream groups. Source tracking prevents sync from deleting intentionally manual access and provides explainability.

**Alternatives considered**:

- Store only a flattened team member list. Rejected because it cannot explain or safely revoke multi-source membership.
- Let sync own all team membership. Rejected because it breaks manual emergency and migration workflows.

## Decision: Represent every protected item as a ReBAC resource

**Decision**: Users, teams, external groups, Slack workspaces, Slack channels, agents, MCP servers, tools, knowledge bases, documents, skills, tasks, conversations, admin surfaces, policies, audit views, secret references, and system configuration scopes will be modeled as ReBAC resources with a shared action vocabulary.

**Rationale**: The user's stated goal is that every atomic resource is gated. A universal resource vocabulary makes access checks, graph visualization, admin scoping, and audit explanation consistent across product surfaces.

**Alternatives considered**:

- Model only agents/tools/knowledge bases in ReBAC. Rejected because admin pages, Slack channels, tasks, and skills would remain bypass-prone side paths.
- Keep resource-specific ad hoc permission systems. Rejected because it prevents a single graph and access checker from explaining decisions.

## Decision: Keep Keycloak for identity and migration compatibility, not final resource authorization

**Decision**: Keycloak remains the identity provider, token issuer, and bootstrap/global-role source. Resource-specific realm roles remain only as transitional compatibility until matching ReBAC enforcement is active.

**Rationale**: Existing services depend on Keycloak tokens and roles. Removing roles immediately would be disruptive, but continuing to treat them as final resource grants would conflict with ReBAC as the target PDP.

**Alternatives considered**:

- Replace Keycloak roles immediately. Rejected due to migration risk and current runtime dependencies.
- Keep all current resource roles permanently. Rejected because role explosion and encoded string semantics do not scale to scoped administration or graph explainability.

## Decision: Slack channels are first-class many-to-many authorization resources

**Decision**: Slack channels will be modeled as resources that can be associated with multiple agents, tools, and knowledge bases. Slack invocation must satisfy channel access and selected resource access.

**Rationale**: A Slack channel is a collaboration space, not a single-agent binding. The current one-channel-to-one-agent mapping cannot represent real team workflows. ReBAC relationships can express channel-to-many-resource access and channel-scoped administrators.

**Alternatives considered**:

- Keep one bound agent per channel. Rejected by requirement and insufficient for multi-agent workflows.
- Treat Slack channel membership as enough to use all team resources. Rejected because teams may need different channels with different agent/tool/KB exposure.

## Decision: Policy authoring must be guided, staged, and validated

**Decision**: Administrators create and update ReBAC relationships through guided forms and graph interactions that stage grants/revocations, validate them, preview impact, and audit every saved change.

**Rationale**: Raw tuple editing is powerful but error-prone. The UI must support safe delegation to scoped admins who may not understand low-level relationship syntax.

**Alternatives considered**:

- Raw tuple editor only. Rejected because it is not safe enough for scoped administrators.
- Hardcoded resource assignment screens only. Rejected because the resource set is broad and needs graph visibility.

## Decision: Use graph visualization and access checker as operational controls

**Decision**: CAIPE will provide all-relationships graph visualization and an access checker that explains allowed and denied decisions.

**Rationale**: ReBAC systems are difficult to operate without explainability. Administrators need to answer who has access, why they have it, which upstream group or policy created it, and what is missing when access is denied.

**Alternatives considered**:

- Provide only tabular tuple lists. Rejected because tuple lists do not show paths or inheritance clearly.
- Provide only runtime denials. Rejected because support and audit workflows need proactive investigation.

## Decision: MongoDB stores intent and provenance; OpenFGA stores relationship facts

**Decision**: MongoDB will store sync rules, sync runs, external group links, membership sources, policy change metadata, relationship ownership, and UI intent. OpenFGA will store the active relationship facts used for ReBAC checks.

**Rationale**: OpenFGA is optimized for relationship checks, not full administrative provenance. MongoDB is already the source for CAIPE team/resource intent and can store audit-friendly metadata, status, and previews.

**Alternatives considered**:

- Store all metadata only in OpenFGA. Rejected because provenance, dry-run state, and sync history require richer records.
- Store all authorization only in MongoDB. Rejected because the target architecture requires a dedicated ReBAC PDP.

## Decision: Scheduled sync plus login-time refresh

**Decision**: The system supports dry-run, scheduled reconciliation, and login-time refresh. Scheduled sync remains authoritative for cleanup and drift detection; login-time refresh accelerates membership updates for the current user when trusted group claims are present.

**Rationale**: Scheduled sync is reliable for full reconciliation. Login-time refresh improves user experience after group changes but cannot safely prune absent users or detect deleted groups by itself.

**Alternatives considered**:

- Scheduled sync only. Rejected because users may wait too long after group membership changes.
- Login-time sync only. Rejected because it cannot reconcile users who do not log in and cannot detect global drift.

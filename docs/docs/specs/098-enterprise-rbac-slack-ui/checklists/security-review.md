# Security Review Checklist: Enterprise RBAC for Slack and CAIPE UI

**Purpose**: Full-sweep requirements-quality validation for security/compliance reviewer gate — covers identity, authorization, delegation, isolation, audit, architecture, operations, and edge-case/recovery requirements
**Created**: 2026-04-03
**Feature**: [spec.md](../spec.md) | [architecture.md](../architecture.md) | [plan.md](../plan.md)
**Audience**: Security reviewer (pre-implementation gate)
**Depth**: Comprehensive (~60 items across 10 categories)

---

## Identity & Authentication Requirements

- [ ] CHK001 Is the requirement for Keycloak as the sole OIDC broker unambiguous, and are fallback/alternative identity providers explicitly excluded? [Clarity, Spec FR-011]
- [ ] CHK002 Are IdP federation requirements specified for both SAML and OIDC protocols, and are the differences in group claim extraction documented for each? [Completeness, Spec FR-010, Architecture §IdP Groups]
- [ ] CHK003 Is the canonical source of group claims defined as a single, explicit source (Keycloak JWT), and is the prohibition against combining conflicting group sources from multiple IdPs stated as a normative requirement? [Clarity, Spec Edge Case: stacked/brokered identity]
- [ ] CHK004 Are Okta-specific and Entra ID-specific group claim formats (e.g., Entra GUIDs vs display names) explicitly documented with normative mapping guidance? [Completeness, Architecture §IdP-Specific Federation Setup]
- [ ] CHK005 Is the mechanism for mapping IdP groups to Keycloak realm roles at token issuance time specified with enough detail for an operator to configure without ambiguity (mapper types, attribute names, protocol mappers)? [Clarity, Spec FR-010, Architecture §Keycloak Mapper Configuration]
- [ ] CHK006 Are the exact JWT claims (`sub`, `act`, `groups`, `roles`, `scope`, `org`) normatively listed, and is the requirement for their presence in every issued token explicit? [Completeness, Spec FR-010, FR-018]
- [ ] CHK007 Is the requirement that the Slack bot and Admin UI derive identity from the same Keycloak realm stated as a normative MUST (not just a recommendation)? [Clarity, Spec FR-011]

## Authorization & RBAC Model Requirements

- [ ] CHK008 Is the default-deny requirement (FR-002) stated for every enforcement point, or only as a general principle? Are there any components in FR-008/FR-014 that could be interpreted as exempt from default deny? [Completeness, Spec FR-002, FR-008]
- [ ] CHK009 Are all 9 components (`admin_ui`, `slack`, `supervisor`, `rag`, `sub_agent`, `tool`, `skill`, `a2a`, `mcp`) explicitly listed in a single normative enumeration, or scattered across multiple FRs where a component could be missed? [Consistency, Spec FR-008, FR-014]
- [ ] CHK010 Is the permission matrix (FR-014) defined with sufficient structure — component, capability ID, channels/APIs, required roles, ASP relationship — or does the spec only describe the matrix conceptually without a concrete schema? [Measurability, Spec FR-014]
- [ ] CHK011 Is the relationship between 098 RBAC and ASP/tool policy clearly specified as "deny wins" (intersection), and is this stated as a normative requirement rather than operator guidance? [Clarity, Spec FR-012, Edge Case: layered authorization]
- [ ] CHK012 Are capability IDs for the permission matrix defined or constrained (e.g., naming convention, namespace), or is this left entirely to implementation? [Gap, Spec FR-014]
- [ ] CHK013 Is the distinction between "tool configuration RBAC" (FR-009) and "tool runtime RBAC" (FR-016) clearly defined with separate capability IDs, or could they be confused? [Clarity, Spec FR-009, FR-016]
- [ ] CHK014 Are the requirements for separating high-risk/administrative capabilities (FR-007) measurable — i.e., is it clear which capabilities are considered "high-risk"? [Measurability, Spec FR-007]
- [ ] CHK015 Is the requirement for skills-based RBAC (FR-014 mentions "skills") specified with the same level of detail as other components, or is it underspecified? [Completeness, Spec FR-014]

## Delegation & OBO Requirements

- [ ] CHK016 Is the OBO token exchange requirement (FR-018) specified with the exact grant type (`urn:ietf:params:oauth:grant-type:token-exchange`) and token type URNs, or does it rely on general RFC 8693 reference? [Clarity, Spec FR-018, Contracts §OBO]
- [ ] CHK017 Is the effective scope of an OBO token defined as the intersection of user entitlements, bot scope ceiling, and component matrix row — and is this stated as a normative MUST? [Clarity, Spec FR-019]
- [ ] CHK018 Is the bot service account scope ceiling (FR-021) defined as a configurable parameter, and are requirements for its management (who sets it, how it's audited) specified? [Completeness, Spec FR-021, Data-model §Bot service account]
- [ ] CHK019 Is the requirement that OBO tokens are short-lived and not persisted explicitly stated, and is the maximum token lifetime defined or left as an operator choice? [Gap, Spec FR-018]
- [ ] CHK020 Is the multi-hop delegation chain (user → bot → supervisor → agent → tool) explicitly required to carry the originating user principal at every hop, and are there requirements for what happens if a hop fails to propagate identity? [Completeness, Spec FR-019]
- [ ] CHK021 Does the spec define what happens when a bot attempts OBO exchange for a user whose Keycloak account has been disabled between identity linking and the exchange attempt? [Edge Case, Gap]
- [ ] CHK022 Is the requirement that agents must forward OBO JWTs (not re-exchange) through the delegation chain clearly stated, or could implementations cache/re-issue tokens at intermediate hops? [Ambiguity, Spec FR-019]

## Slack Identity Linking Requirements

- [ ] CHK023 Are the security properties of the linking URL (single-use, time-bounded, HTTPS-only, CSPRNG nonce) stated as normative MUSTs with specific constraints (e.g., max TTL in minutes)? [Measurability, Spec FR-025]
- [ ] CHK024 Is the requirement for denying all RBAC-protected operations for unlinked Slack users stated as a normative MUST, and is the linking prompt defined as mandatory (not optional UX)? [Clarity, Spec FR-025]
- [ ] CHK025 Is the invalidation behavior for Slack identity links clearly specified — what happens when Keycloak account is disabled, deleted, or realm is changed? [Edge Case, Spec FR-025, Edge Case: invalidated links]
- [ ] CHK026 Is the CSRF/replay protection for the OAuth callback endpoint specified as a requirement, or left to implementation? [Gap, Spec FR-025]
- [ ] CHK027 Are rate-limiting requirements for the identity linking endpoint specified to prevent brute-force or enumeration attacks? [Gap]
- [ ] CHK028 Is the requirement that `slack_user_id` is stored as a Keycloak user attribute (not MongoDB) clearly stated with both write and read API paths? [Clarity, Spec FR-025, Architecture §Storage mechanism]

## Agent Gateway & MCP Security Requirements

- [ ] CHK029 Is the requirement that AG is mandatory for MCP/A2A/agent traffic stated as a normative MUST with no exception path, or could an implementation bypass AG for "internal" MCP calls? [Clarity, Spec FR-013]
- [ ] CHK030 Is the fail-closed requirement for AG unavailability defined with specific behavior: HTTP status code, error message format, and which paths are affected vs unaffected? [Measurability, Spec FR-013, Architecture §Fail-Closed]
- [ ] CHK031 Are AG policy rules required to "mirror" the 098 permission matrix, and is this synchronization mechanism specified (manual, automated, declarative)? [Gap, Spec FR-017c]
- [ ] CHK032 Is the requirement that AG validates JWTs against Keycloak JWKS specified with JWKS endpoint URL, key rotation handling, and cache behavior? [Completeness, Spec FR-013]
- [ ] CHK033 Is the network segmentation requirement — preventing direct access to MCP servers bypassing AG — stated as a normative requirement or implied? [Gap, Edge Case: AG bypass]
- [ ] CHK034 AG uses CEL (Common Expression Language) for authorization rules — are CEL rule examples in spec aligned with AG's actual `mcpAuthorization.rules` and `authorization.rules` syntax? [Clarity, Spec §Out of scope]
- [ ] CHK035 Is the requirement for tool-level RBAC in AG (FR-016) specified with enough detail — tool identifiers, scope matching, deny semantics — or only described conceptually? [Completeness, Spec FR-016]

## Multi-Tenant Isolation Requirements

- [ ] CHK036 Is the tenant isolation requirement (FR-020) stated for every enforcement point (Keycloak AuthZ, AG, BFF, Slack bot), or only as a general principle? [Completeness, Spec FR-020]
- [ ] CHK037 Is the `org` claim defined as a required attribute in the 098 matrix and in AG policy rules, and are requirements for its validation at each enforcement point specified? [Clarity, Spec FR-020]
- [ ] CHK038 Is the requirement for deterministic tenant resolution when a user holds multiple org memberships explicitly stated? [Edge Case, Spec Edge Case: multiple enterprise memberships]
- [ ] CHK039 Is cross-tenant resource access defined as a normative denial (not just absence of permission), and is the error response format specified? [Clarity, Spec FR-020]
- [ ] CHK040 Are requirements for tenant onboarding/offboarding (realm creation, IdP broker setup, role migration) specified, or left entirely to the operator guide? [Gap, Spec FR-017]

## Audit & Compliance Requirements

- [ ] CHK041 Is the audit record schema (FR-005) normatively defined with required fields, or only described as "sufficient to support enterprise review"? [Measurability, Spec FR-005, Data-model §Authorization decision record]
- [ ] CHK042 Are the privacy constraints for audit records (salted hash of subject, no raw PII) stated as normative MUSTs? [Clarity, Spec FR-005, Research R-5]
- [ ] CHK043 Is the requirement for audit records on BOTH allow and deny decisions explicitly stated for all enforcement points? [Completeness, Spec FR-005]
- [ ] CHK044 Are audit retention and deletion requirements specified, or deferred to "org policy" without minimum normative constraints? [Gap, Spec FR-005]
- [ ] CHK045 Is the audit record's `pdp` field (keycloak vs agent_gateway) specified to enable cross-channel consistency verification (SC-003)? [Completeness, Data-model §Authorization decision record]
- [ ] CHK046 Are requirements for audit log integrity (append-only, tamper detection) specified, or only implicitly assumed? [Gap]
- [ ] CHK047 Is the correlation ID requirement specified to enable end-to-end tracing across the delegation chain (user → bot → supervisor → agent → tool)? [Completeness, Spec FR-019]

## Architecture & Design Consistency

- [ ] CHK048 Is the dual-PDP architecture (Keycloak AuthZ for UI/Slack, AG for MCP/A2A/agent) consistently described across spec, architecture, contracts, and plan — with no document implying a single PDP? [Consistency, Spec FR-022, FR-013]
- [ ] CHK049 Is the hybrid storage split (Keycloak for authz policies + identity links, MongoDB for team/KB + app metadata) consistently described, and are there any FRs that could be misread as requiring MongoDB for authz decisions? [Consistency, Spec FR-023, Data-model §Storage split]
- [ ] CHK050 Are the three enforcement zones (UI, Slack/Webex, MCP/A2A/Agent) consistently mapped to their PDPs across all design documents? [Consistency, Architecture §Authorization Enforcement Points]
- [ ] CHK051 Is the requirement that BFF and Slack bot are independent of AG (not routed through AG) consistently stated, and could any architecture diagram be misread as routing Slack through AG? [Consistency, Spec FR-013, Architecture §Canonical diagram]
- [ ] CHK052 Is the Keycloak Authorization Services model (resources = components, scopes = capabilities, policies = role-based) consistently described in spec, architecture, data-model, and contracts? [Consistency]
- [ ] CHK053 Are the FR numbering and session references internally consistent (no FR gaps, no dangling session references)? [Consistency]

## Operational Security Requirements

- [ ] CHK054 Is the operator guide requirement (FR-017) specific enough to serve as an acceptance criterion — are the six documented sections (realm setup, AG deployment, policy rules, composition, fail-closed, day-two) normatively required? [Measurability, Spec FR-017]
- [ ] CHK055 Are requirements for Keycloak client secret management (vault/env, rotation, no hardcoding) stated as normative MUSTs, or assumed as best practice? [Gap, Plan §Constraints]
- [ ] CHK056 Is the requirement for permission propagation within 15 minutes (SC-002) specified with a mechanism (token refresh, cache invalidation), or only as a measurable outcome? [Clarity, Spec SC-002]
- [ ] CHK057 Are requirements for emergency break-glass access specified beyond "if offered, it must be time-bound, attributed, and auditable" — e.g., who can grant it, max duration, approval flow? [Gap, Spec Edge Case: break-glass]
- [ ] CHK058 Is the requirement for knowledge scope vs answer quality messaging (product/support messaging) specified as a normative requirement, or only noted as an edge case? [Clarity, Spec Edge Case: knowledge scope]

## Edge Case & Recovery Flow Coverage

- [ ] CHK059 Is the recovery flow for stale elevated access (token refresh failure) specified with normative behavior: fail closed, force re-authentication, and deny with stale cached roles? [Completeness, Spec Edge Case: delay/partial failure]
- [ ] CHK060 Is the recovery flow for invalidated Slack identity links (Keycloak account disabled/deleted) specified with normative behavior: treat as invalid, prompt re-link, deny RBAC operations? [Completeness, Spec Edge Case, FR-025]
- [ ] CHK061 Is the behavior for a user switching primary organization context specified — how does tenant resolution change, and are there requirements for clearing cached permissions? [Gap, Spec Edge Case: multiple memberships]
- [ ] CHK062 Is the distinction between human users and bot/service principals clearly defined in the permission matrix, and are high-risk action restrictions for service identities specified? [Clarity, Spec Edge Case: human vs automated]
- [ ] CHK063 Are requirements for AG unavailability recovery (retry, circuit-breaker, alerting) specified beyond "fail closed"? [Gap, Spec Edge Case: AG unavailability]
- [ ] CHK064 Are requirements for Keycloak unavailability specified — can existing valid JWTs continue to authorize operations, and for how long? [Ambiguity, Architecture §Fail-Closed]
- [ ] CHK065 Is the KB vs custom RAG tool privilege expansion prevention requirement (no implicit inheritance from tool use to KB admin/ingest) stated as a normative MUST with explicit deny semantics? [Clarity, Spec Edge Case: KB vs RAG tool]
- [ ] CHK066 Are requirements for handling conflicting 098 RBAC and ASP denials specified beyond "deny wins" — e.g., which denial reason is surfaced to the user, and is the audit record enriched with both layers' decisions? [Gap, Spec FR-012, Edge Case: layered authorization]

## Specification Clarity & Measurability

- [ ] CHK067 Are all 9 success criteria (SC-001 through SC-009) measurable with specific thresholds, time windows, or binary pass/fail conditions? [Measurability]
- [ ] CHK068 Is the "sub-5ms" PDP decision latency (FR-022) specified with test conditions (load level, cache state, network topology) that make it reproducible? [Measurability, Spec FR-022d]
- [ ] CHK069 Is the "99% within 15 minutes" propagation requirement (SC-002) specified with the test methodology (how many checks, what interval, which surfaces)? [Measurability, Spec SC-002]
- [ ] CHK070 Is the "five personas" requirement for acceptance testing (SC-003) specified with enough detail to reproduce — role assignments, expected allow/deny matrix per persona? [Measurability, Spec SC-003]
- [ ] CHK071 Are the terms "protected capability", "high-risk action", and "administrative capability" defined with concrete examples or criteria for classification? [Clarity, Spec FR-002, FR-007]
- [ ] CHK072 Is the "same conceptual principal" requirement (FR-012) defined precisely enough to test — what constitutes "same" when claims traverse OBO exchange, Keycloak mapping, and AG policy? [Ambiguity, Spec FR-012]

---

## Notes

- Check items off as completed: `[x]`
- Add inline comments with findings, especially for items marked [Gap] or [Ambiguity]
- Reference specific spec sections, architecture diagrams, or session dates when documenting gaps
- Items are numbered sequentially (CHK001–CHK072) for cross-referencing
- This checklist tests **requirements quality**, not implementation correctness

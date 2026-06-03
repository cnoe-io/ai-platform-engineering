# Feature Specification: Per-User OAuth Scope Selection

**Feature Branch**: `2026-06-03-per-user-oauth-scope-selection` (spec authored on `main`, no feature branch yet)  
**Created**: 2026-06-03  
**Status**: Draft  
**Input**: User request: "Can we make this [OAuth connector scopes] configurable in the UI, in the connector, so the user can choose in an advanced setting?" — with the follow-up clarification that the choice should be **per-user at connect time** (option B), plus the open question **"do we need to store it?"**

## Context & Problem

OAuth connectors (GitHub, Atlassian/Jira, Webex, PagerDuty, GitLab) carry a fixed `scopes` array on the global connector document (`oauth_connectors`). Those scopes are baked from `built-in-oauth-connectors.ts` (or env at bootstrap) and are only editable today by recreating the connector — there is no UI to adjust them.

This bit us concretely: the Atlassian connector shipped without `read:jira-user`, so the Jira MCP's `get_current_user_account_id` (`GET /rest/api/3/myself`) returned `401 "scope does not match"` and the whole Jira agent looked broken. Fixing it required hand-editing Mongo and the seed file.

Two problems motivate this feature:

1. **No self-service.** A user who needs a different scope set (e.g. add a write scope, or a Jira/Confluence granular scope) cannot change what they request — they must ask an operator to edit global config.
2. **One-size-fits-all scopes.** A single global scope list is granted to every user of a connector. There is no way for an individual to request **only** the scopes they need (least privilege) or to add a scope they personally need without broadening it for everyone.

The user has chosen a **per-user, connect-time** model: when a user connects (or relinks) a provider, an **"Advanced settings"** control lets them choose which scopes to request for *their* connection, within the bounds the connector allows.

### The "do we need to store it?" decision

**Short answer: yes — persist the user's requested scopes on the per-user `provider_connection`, but the access token remains valid without it.**

- The IdP encodes the **granted** scopes inside the issued token (e.g. Atlassian's access JWT has a `scope` claim). So a token *works* at call time regardless of whether we separately store the request.
- However, three behaviors break without persistence:
  - **Relink** re-runs the authorization request. With no stored choice, relink would silently fall back to the connector default and **discard the user's narrowing/expansion** — surprising and a security regression (a user who narrowed scopes would silently get the full set back).
  - **Display** — the "My Connections" UI cannot show "connected with: …" or pre-fill the advanced editor with the user's last choice.
  - **Refresh** consistency — reasoning about what a connection is entitled to (audits, troubleshooting) needs a first-class field rather than decoding provider-specific token claims.

Therefore we persist a `requestedScopes: string[]` (and, where the IdP returns it, `grantedScopes`) on the `provider_connection` document. This is additive and backward compatible (absent ⇒ "used connector default").

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose scopes when connecting (Priority: P1)

A user opens "My Connections", expands **Advanced settings** on a provider, sees the scopes the connector permits (pre-selected to the connector default), toggles the set they want, and clicks Connect. The authorization request asks the IdP for exactly that set.

**Why this priority**: This is the core ask — self-service, per-user scope choice at connect time.

**Independent Test**: With a connector that permits scopes `{A, B, C}` (default `{A, B}`), connect choosing `{A, C}`; assert the authorization URL `scope` param is exactly `A C`.

**Acceptance Scenarios**:

1. **Given** an enabled connector with an allowed-scope set and a default subset, **When** the user expands Advanced settings, **Then** the allowed scopes are listed with the default subset pre-selected.
2. **Given** the user selects a subset/variant, **When** they Connect, **Then** the authorization request's `scope` parameter equals their selection (provider-specific filters like GitHub's `offline_access` strip still apply).
3. **Given** the user does not open Advanced settings, **When** they Connect, **Then** the connector default scopes are requested (today's behavior is preserved).

---

### User Story 2 - The choice survives relink and is visible (Priority: P2)

After connecting with a custom scope set, the user later relinks (e.g. to re-consent). The advanced editor is pre-filled with **their** previous choice, not the global default, and the connections list shows what they connected with.

**Why this priority**: Without persistence, relink silently reverts to the global default — a least-privilege and trust regression (this is the "do we need to store it?" answer made concrete).

**Independent Test**: Connect with `{A, C}`; reload; open Advanced settings on that connection and assert `{A, C}` is pre-selected; relink and assert the authorization URL again requests `{A, C}`.

**Acceptance Scenarios**:

1. **Given** a connection created with a custom scope set, **When** the user reopens Advanced settings, **Then** their stored `requestedScopes` are pre-selected (not the connector default).
2. **Given** a stored custom scope set, **When** the user relinks, **Then** the authorization request uses the stored set unless the user changes it.
3. **Given** a connection created before this feature (no stored scopes), **When** it is displayed, **Then** it is treated as "connector default" without error.

---

### User Story 3 - Scope choice is bounded and least-privilege (Priority: P3)

A user cannot request scopes the connector does not permit (which would also fail at the IdP if the OAuth app lacks them). The advanced editor only offers the connector's allowed set; the server rejects out-of-bounds scopes.

**Why this priority**: Per-user freedom must not become a privilege-escalation hole. The admin-defined connector remains the upper bound; users may narrow (and optionally pick within an allowed superset), never exceed.

**Independent Test**: Attempt to start a connection requesting a scope outside the connector's allowed set via the API directly; assert it is rejected (400) and no authorization URL is issued.

**Acceptance Scenarios**:

1. **Given** a connector allowed-scope set, **When** a connect request includes a scope outside that set, **Then** the server rejects it with a validation error and starts no authorization flow.
2. **Given** the advanced editor, **When** it renders, **Then** it only offers scopes within the connector's allowed set.
3. **Given** a user selects an empty set, **When** they attempt to Connect, **Then** the system requires at least the connector's minimum/default (no zero-scope tokens).

### Edge Cases

- **OAuth app lacks the scope**: even an allowed connector scope can be refused by the IdP if the registered OAuth app does not grant it. This surfaces as the existing connect/relink error; the feature does not mask it.
- **Connector `scopes` changes** after a user stored a narrower set: the user's stored choice is preserved; scopes added to the connector are **not** silently added to existing connections (they appear as newly-available toggles on next relink). A stored scope that is later *removed* from the connector is dropped from the selection (bounded by the current allowed set).
- **GitHub `offline_access`**: the existing provider-specific authorization-scope filter must continue to apply on top of the user's selection.
- **Provider with no concept of granular scopes**: the advanced editor still works (free-form/whole-set), bounded by the connector's allowed list.
- **Backward compatibility**: existing connections (no `requestedScopes`) and the default "didn't open advanced settings" path behave exactly as today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The connector's existing `scopes` array IS both the **allowed-scope set** (the admin-managed upper bound) and the **default selection**. No new connector field is added in this iteration: users may select any subset of `connector.scopes` (narrow only); the default selection is the full set. (A broader per-provider scope catalog that lets users pick *beyond* today's default is explicitly deferred — see Out of Scope.)
- **FR-002**: The user-facing connect flow MUST expose an **"Advanced settings"** control listing the connector's allowed scopes, pre-selected to the default (or the user's stored choice when relinking).
- **FR-003**: The connect/start API MUST accept an optional per-request `scopes` selection and MUST build the authorization URL `scope` parameter from it (preserving provider-specific filters such as GitHub `offline_access` stripping).
- **FR-004**: The server MUST validate the requested scopes against the connector's allowed set and reject any scope outside it (no privilege escalation); it MUST also reject an empty selection.
- **FR-005**: The per-user `provider_connection` MUST persist the user's `requestedScopes` (and `grantedScopes` when the IdP returns them), additively and backward compatibly.
- **FR-006**: Relink MUST default to the connection's stored `requestedScopes` when present, else the connector default.
- **FR-007**: The "My Connections" UI MUST display what a connection was connected with and pre-fill the advanced editor from stored scopes.
- **FR-008**: Existing connections without stored scopes and connects that do not use Advanced settings MUST behave exactly as before (no migration required for tokens to keep working).
- **FR-009**: Changing the requested scopes MUST NOT retroactively change an existing token; the UI MUST indicate that a **relink** is required for new scopes to take effect.
- **FR-010**: The RBAC reference documentation MUST be updated to record per-user scope selection, the allowed-vs-default model, and the new persisted fields (per the repository's RBAC living-documentation rule).

### Key Entities *(data)*

- **OAuth connector** (`oauth_connectors`): **unchanged.** Its existing `scopes` array serves as both the allowed upper bound and the default selection. Admin-managed.
- **Provider connection** (`provider_connections`): gains `requestedScopes` (what the user asked for) and optionally `grantedScopes` (what the IdP issued). Per user, per provider.
- **Scope selection request**: the optional, validated `scopes` payload on the connect/start call; bounded by the connector allowed set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can choose a scope set at connect time and the issued authorization request asks the IdP for exactly that set in **100%** of tested provider cases (with GitHub `offline_access` filtering preserved).
- **SC-002**: A custom scope choice is preserved across relink and reload in **100%** of tested cases (no silent revert to the global default).
- **SC-003**: A connect request for a scope outside the connector's allowed set is rejected **100%** of the time with no authorization flow started.
- **SC-004**: Pre-feature connections and the "didn't touch advanced settings" path continue to work unchanged (no regressions in the existing connect/relink/refresh tests).
- **SC-005**: The "My Connections" UI shows the connection's scopes and pre-fills the advanced editor from the stored value.

## Assumptions

- The admin-defined connector remains the authority for the **maximum** scopes; per-user selection can only narrow within (or pick within) that allowed set. Editing the connector's allowed/default set globally is a separate admin concern (existing create flow / future admin edit).
- The IdP encodes granted scopes in the token, so the token is valid without our stored copy; persistence is for relink fidelity, display, and auditing.
- Per-connection token storage already exists (`provider_connections`); adding scope fields is additive.
- The allowed scope set equals the connector's current `scopes` for this iteration (users narrow only). A richer per-provider scope *catalog* (pick beyond today's default) is a follow-up.

## Out of Scope

- An admin UI to edit a connector's global default/allowed scopes (this spec is the **per-user** path; admin editing can reuse the same model later).
- A per-provider scope **catalog** that lets users request scopes *beyond* today's connector default (this iteration: narrow-only within `connector.scopes`).
- Registering/altering scopes on the upstream OAuth app (developer.atlassian.com, GitHub OAuth app, etc.) — that remains an operator responsibility; the IdP still enforces what the app permits.
- Automatically re-requesting/refreshing existing tokens when scopes change (a relink is required; no background re-consent).
- Changing how MCP servers consume the resulting token (unchanged: forwarded via `X-CAIPE-Provider-Token`).

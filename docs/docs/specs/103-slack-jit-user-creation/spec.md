# Feature Specification: Slack just-in-time Keycloak user creation with web-UI auto-merge

**Feature Branch**: `prebuild/feat/slack-jit-user-creation`
**Created**: 2026-04-22
**Status**: Draft
**Owner**: Platform Engineering Team
**Predecessor specs**: [098-enterprise-rbac-slack-ui](../098-enterprise-rbac-slack-ui/spec.md), [102-comprehensive-rbac-tests-and-completion](../102-comprehensive-rbac-tests-and-completion/spec.md)
**Related code paths**:
- `ai_platform_engineering/integrations/slack_bot/utils/identity_linker.py`
- `ai_platform_engineering/integrations/slack_bot/utils/keycloak_admin.py`
- `ai_platform_engineering/integrations/slack_bot/app.py`
- `charts/ai-platform-engineering/charts/slack-bot/`
- `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`
- `deploy/keycloak/realm-config.json`

---

## 1. Problem statement

Today, when a user DMs (or @mentions) the CAIPE Slack bot for the first time:

1. `slack-bot` calls Slack's `users.info` to get the Slack profile email.
2. It looks up that email in Keycloak via the Admin REST API
   (`GET /admin/realms/caipe/users?email=<email>&exact=true`).
3. **If a Keycloak user with that email exists**, the bot writes
   `slack_user_id=<U…>` as a Keycloak user attribute and the link is established.
4. **If no Keycloak user exists with that email**, the bot dead-ends and posts
   the misleading ephemeral message:

   > "Your Slack account could not be automatically linked. Make sure your
   > Slack email matches your enterprise account, or contact your admin."

In a corporate-only Slack workspace where everyone authenticates via the
upstream IdP (Duo SSO/OIDC), step 4 is the common case the **first time** a
person uses the bot — they may have never opened the web UI, so Keycloak has
never shadow-created their user record. Today they have to (a) open the web
UI, (b) sign in via Duo, (c) wait for Keycloak to mint a federated user, and
then (d) come back to Slack and try again. The UX is bad and the error
message is wrong (the email doesn't fail to match — there's nothing to match
against yet).

This specification adds a **just-in-time (JIT) shell-user creation** path so
the first Slack interaction creates the Keycloak user itself. When the same
person later signs into the web UI via Duo SSO, the IdP broker
**automatically merges** the federated identity into the existing shell user
(no duplicate, no user-visible "link account?" prompt).

When JIT is disabled (operator opt-out), the bot falls back to a **link-based
onboarding** flow: it sends the user the existing HMAC-signed linking URL
(`/api/auth/slack-link?…`) which walks them through web-UI sign-in once,
after which their Slack identity is bound to their Keycloak account.

---

## 2. Goals and non-goals

### 2.1 Goals

- **G1**: First-time Slack interaction by a corporate user must succeed
  without out-of-band onboarding (web UI, admin help-desk ticket, etc.) when
  JIT mode is on.
- **G2**: One Keycloak user per human across both surfaces (Slack and web UI).
  No duplicates. The same `kc_user_id` is reused regardless of which surface
  the person touches first.
- **G3**: Operational simplicity — a single Keycloak admin client
  (`caipe-platform`) handles both lookup and creation. We deliberately
  avoid introducing a second client to keep one secret to manage, one
  rotation procedure, and one audit identity. The trade-off (no
  privilege separation between read and write on users) is accepted
  and documented in `plan.md` R-8.
- **G4**: Operator opt-in via a single feature flag, with safe default in
  development (on) and explicit choice in production (operator decides).
- **G5**: When JIT is off, the user gets actionable next steps (a link),
  not a dead-end error.
- **G6**: Audit trail — every JIT user creation produces a structured log
  line with `slack_user_id`, `email` (masked), and resulting `kc_user_id`,
  consumable by SIEM.

### 2.2 Non-goals

- **NG1**: This feature does **not** grant any roles or KB access to the
  newly created user. They get whatever the team-mapping / RBAC policy
  default is for an unmapped user (today: deny most operations). Granting
  roles is the operator's responsibility via the existing admin UI.
- **NG2**: This feature does **not** invent a new identity model. It uses
  Keycloak's standard "First Broker Login" auto-link-by-email flow.
- **NG3**: This feature does **not** support JIT user creation from the
  **web UI** path. Web-UI users continue to be created by the Duo IdP broker
  on first SSO. (The merge direction is one-way: Slack-shell → broker-attach.)
- **NG4**: Webex/Teams/other surfaces are out of scope. The
  `KEYCLOAK_SLACK_BOT_ADMIN_*` naming convention leaves room for them
  but they require their own spec.
- **NG6**: A separate dedicated provisioner Keycloak client is **not**
  introduced. After deliberation we accepted the operational simplicity
  of reusing the existing `caipe-platform` admin client for both
  lookup (`view-users` + `query-users`) and creation (`manage-users`).
  The trade-off is documented in `plan.md` R-8.
- **NG5**: Removing or disabling existing seeded `@example.com` personas is
  out of scope. They remain for dev/test.

---

## 3. User scenarios and acceptance criteria

### 3.1 User Story 1 — first-time Slack user, JIT on (Priority: P1)

A corporate employee who has **never** used the web UI sends their first DM
to the CAIPE Slack bot.

**Why P1**: This is the entire reason the feature exists. Without it, the
"could not be auto-linked" error is the very first thing every new user sees.

**Independent test**: Pick an email that does not exist in the Keycloak
realm. Set `SLACK_JIT_CREATE_USER=true`. Send the bot a DM. Confirm:
1. A Keycloak user with that email is created within the request.
2. The user has `slack_user_id` attribute set to the sender's Slack ID.
3. The bot proceeds to handle the message normally (subject to RBAC policies).

**Acceptance scenarios**:

1. **Given** Slack returns `email=alice@corp.com` and Keycloak has no user
   with that email, **when** the user DMs the bot with JIT on, **then**
   slack-bot creates a Keycloak user with:
   - `username = alice@corp.com`
   - `email = alice@corp.com`
   - `emailVerified = true`
   - `enabled = true`
   - `requiredActions = []` (no password ever)
   - `attributes.slack_user_id = ["<U…>"]`
   - `attributes.created_by = ["slack-bot:jit"]`
   - `attributes.created_at = ["<RFC3339 timestamp>"]`
   - **No password credential.** (Federated-identity-only.)
2. **Given** the user record was just created, **when** the bot proceeds
   with the request, **then** `_rbac_enrich_context` returns `"ok"` (the
   shell user is treated as a real user for downstream RBAC enforcement,
   gated by whatever roles/teams policy assigns them — which by default is
   none, but the request **proceeds** rather than dead-ends).
3. **Given** a JIT-created user, **when** they later DM the bot a second
   time, **then** `resolve_slack_user` finds them by `slack_user_id`
   attribute on the very first call and `auto_bootstrap_slack_user` is
   never invoked again.

---

### 3.2 User Story 2 — JIT user later signs into web UI via Duo (Priority: P1)

The same user from Story 1 later opens the CAIPE web UI and signs in via
Duo SSO.

**Why P1**: Without this, every JIT user creates a duplicate Keycloak record
the first time they touch the web UI, which permanently breaks SSO for
that person (multiple identities for the same email, RBAC sees the wrong
one, audit trails split).

**Independent test**: After Story 1 has produced a JIT user, complete a Duo
SSO login as that same person. Verify Keycloak ends up with **one** user
record carrying both the `slack_user_id` attribute (from Story 1) and a
federated identity entry pointing at the Duo IdP.

**Acceptance scenarios**:

1. **Given** a JIT-created shell user with `email=alice@corp.com`, **when**
   the same person signs into the web UI via Duo and Duo returns
   `email=alice@corp.com`, **then** Keycloak's First Broker Login flow runs
   and:
   - Finds the existing Keycloak user by email (because Duo `trustEmail=true`
     and the IdP first-broker flow is set to "Automatically Set Existing User").
   - Attaches the Duo `federatedIdentity` entry to that existing user.
   - Does **not** create a second Keycloak user.
   - Does **not** prompt the user to confirm linking.
2. **Given** the merge succeeded, **when** the user DMs the Slack bot
   afterwards, **then** the bot's existing `resolve_slack_user` path
   (lookup by `slack_user_id` attribute) returns the same `kc_user_id` it
   used before the merge.
3. **Given** the merge succeeded, **when** the user signs out and back in
   via Duo, **then** Keycloak reuses the same user (no further duplicates).

---

### 3.3 User Story 3 — first-time Slack user, JIT off (Priority: P1)

An operator has set `SLACK_JIT_CREATE_USER=false`. A corporate employee
sends their first DM to the bot.

**Why P1**: When JIT is off, the bot must do something **useful** — not the
current dead-end error message. The link-based onboarding flow already
exists; it just isn't wired into the auto-bootstrap path.

**Independent test**: With `SLACK_JIT_CREATE_USER=false`, send the bot a DM
from an unknown email. Confirm the bot replies with an HMAC linking URL,
not the "make sure your email matches" message.

**Acceptance scenarios**:

1. **Given** `SLACK_JIT_CREATE_USER=false` and no matching Keycloak user,
   **when** the user DMs the bot, **then** the bot posts an ephemeral
   message containing a freshly generated HMAC-signed
   `/api/auth/slack-link?…` URL valid for `SLACK_LINK_TTL_SECONDS`.
2. **Given** the user clicks the link and completes web-UI sign-in via Duo,
   **when** they return to Slack and DM the bot, **then** auto-bootstrap
   succeeds via the email-match branch (not JIT).
3. **Given** JIT is off, **when** any code path in slack-bot is exercised,
   **then** the JIT code branch in `auto_bootstrap_slack_user` is not
   entered (no `POST /users` is issued).

---

### 3.4 User Story 4 — operator audits JIT-created users (Priority: P2)

An operator wants to know which Keycloak users were created by the
slack-bot vs. by other paths.

**Why P2**: Useful for periodic identity hygiene, but not a launch blocker.

**Independent test**: After several Slack interactions create users,
query Keycloak for users with `attributes.created_by=slack-bot:jit` and
confirm only the expected ones are returned.

**Acceptance scenarios**:

1. **Given** N JIT-created users exist, **when** an operator runs
   `GET /admin/realms/caipe/users?q=created_by:slack-bot:jit`, **then**
   exactly N users are returned.
2. **Given** a JIT-created user, **when** an operator inspects the user in
   Keycloak admin UI, **then** the `created_by` and `created_at`
   attributes are visible.
3. **Given** a JIT-created user has been merged with a Duo federated
   identity, **when** the operator inspects them, **then** `created_by`
   still says `slack-bot:jit` (provenance preserved).

---

### 3.5 User Story 5 — JIT failure must fail safe (Priority: P1)

Keycloak is unreachable, the admin client_secret is wrong, or the
`manage-users` role is missing from the admin client. JIT cannot succeed.

**Why P1**: Auth-path failures are the most likely production incident
mode; we cannot fail silently.

**Independent test**: Break the admin credentials (or remove
`manage-users`). Send a Slack message. Confirm:
1. The user gets the link-based fallback (not the email-match dead-end).
2. The slack-bot logs a `WARNING` with the underlying error and does
   **not** swallow the exception silently at `DEBUG`.

**Acceptance scenarios**:

1. **Given** the admin client_secret is wrong, **when** the bot attempts
   JIT creation, **then** the Keycloak `POST /users` returns
   `401 Unauthorized` and the bot logs `WARNING JIT user creation failed
   for slack=<U…> email=<masked>: <reason>` and falls through to the
   link-based flow described in Story 3.
2. **Given** Keycloak is down, **when** the bot attempts JIT creation,
   **then** the bot logs the connection error at `WARNING` and falls
   through to the link-based flow.
3. **Given** the admin client lacks `manage-users`, **when** the bot
   attempts JIT creation, **then** Keycloak returns `403 Forbidden` and the
   bot logs an actionable warning naming the missing role.

---

### 3.6 Edge cases

- **EC-1**: Slack returns no email at all (workspace lacks
  `users:read.email` scope). JIT cannot proceed because there's no email
  to use. The bot falls through to link-based flow regardless of JIT mode.
  This is already handled but the user-facing message must not say "make
  sure your email matches" — it should say "your Slack workspace admin
  needs to grant the `users:read.email` scope" with operator remediation.
- **EC-2**: Two JIT requests for the same email arrive concurrently
  (e.g. user spam-DMs the bot twice in 10ms). The second `POST /users`
  returns `409 Conflict`; the bot must catch this, re-run
  `get_user_by_email`, and proceed as if the user existed.
- **EC-3**: A JIT-created user later changes their email in Slack to one
  that **does** match an existing Keycloak user (their old federated one).
  Auto-bootstrap by `slack_user_id` still finds the JIT user, so they
  continue to use that record. Operator must manually merge if desired.
  (Documented as a known gap.)
- **EC-4**: A Slack guest from an external workspace DMs the bot. Their
  email is from a domain not under the operator's control. Without
  upstream IdP whitelisting, JIT would create a Keycloak user for them.
  **Mitigation**: optional `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` config (CSV
  of domains). When set, only matching domains are JIT-created; others
  fall through to link-based flow. Empty (default) = allow all
  (preserves backward compatibility for trusted workspaces).
- **EC-5**: The Slack profile email is a personal email
  (e.g. `alice@gmail.com`) but the corporate identity is
  `alice@corp.com`. JIT will create a `gmail.com` user that the Duo SSO
  flow will never match. **Mitigation**: same as EC-4 — domain whitelist.
- **EC-6**: A JIT-created user is later deleted by an admin (cleanup,
  account departure). `attributes.slack_user_id` is gone with them; next
  time that Slack user DMs, `resolve_slack_user` returns None, JIT runs
  again, and a new Keycloak user is created. This is the intended
  behavior (re-provisioning is implicit).
- **EC-7**: The admin client_secret is rotated mid-session. Existing
  in-flight requests fail with 401 once the cached token expires; the
  bot retries with the new secret on next request. The fallback path
  (link-based) still works. No persistent state is corrupted.

---

## 4. Functional requirements

- **FR-001**: `slack-bot` MUST read JIT mode from
  `SLACK_JIT_CREATE_USER` environment variable. Default value MUST be
  `true` in the bundled `docker-compose.dev.yaml` and the slack-bot Helm
  chart's `values.yaml` (operator can override).
- **FR-002**: When `SLACK_JIT_CREATE_USER=true` and `auto_bootstrap_slack_user`
  finds a Slack email but no matching Keycloak user, the bot MUST attempt
  to create a Keycloak user via the Admin REST API.
- **FR-003**: The created user MUST have:
  - `username = email` (lowercased)
  - `email = email` (lowercased)
  - `emailVerified = true`
  - `enabled = true`
  - `requiredActions = []`
  - **No `credentials` field** (no password)
  - `attributes.slack_user_id = [<slack_user_id>]`
  - `attributes.created_by = ["slack-bot:jit"]`
  - `attributes.created_at = [<RFC3339 timestamp>]`
- **FR-004**: User-creation MUST reuse the existing Keycloak admin
  client identified by `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` and
  `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET` (the `caipe-platform` client).
  This client's service account MUST hold the realm-management roles
  `view-users`, `query-users`, and `manage-users` — and SHOULD NOT hold
  any additional realm-management roles (least-privilege within the
  single-client model).
- **FR-005**: A single set of credentials is used by the slack-bot for
  both user lookup and user creation. We deliberately did **not**
  introduce a separate provisioner client. The trade-off (one
  compromised secret can both read and create users) is documented in
  `plan.md` R-8 and accepted in exchange for operational simplicity
  (one Secret to manage, one rotation procedure, one log audit
  identity).
- **FR-006**: When `SLACK_JIT_CREATE_USER=false` and no matching Keycloak
  user is found, the bot MUST send the user an ephemeral message containing
  a freshly generated HMAC linking URL (the same URL produced by
  `generate_linking_url()` and used by `SLACK_FORCE_LINK=true` today).
- **FR-007**: Optional `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` MAY be set to a
  comma-separated list of email domains. When set, JIT MUST only create
  users whose email matches one of those domains; other emails fall back
  to the link-based flow regardless of JIT mode. When unset (default),
  no domain filtering is applied.
- **FR-008**: Concurrent JIT requests for the same email MUST resolve to a
  single Keycloak user. When the underlying `POST /users` returns 409
  Conflict, the bot MUST re-query by email and proceed with the existing
  user.
- **FR-009**: Keycloak's IdP "First Broker Login" flow for the upstream
  IdP (Duo) MUST be configured so that an existing Keycloak user with the
  same email is automatically reused (silently linked) when the user
  signs in via Duo for the first time. Specifically:
  - `firstBrokerLoginFlowAlias = "first broker login"` (default flow), with
    its `Confirm Link Existing Account` step set to `Automatically Set
    Existing User` (skip user confirmation).
  - `trustEmail = true` (the IdP-asserted email is treated as authoritative).
  - `syncMode = FORCE` (refresh user attributes from Duo on every login,
    not just first).
- **FR-010**: Every JIT user creation MUST produce a single structured
  log line at `INFO` level that includes:
  - `event = "slack_jit_user_created"` (or equivalent stable identifier)
  - `slack_user_id = <U…>`
  - `email_masked = <first 3 chars>***@<domain>`
  - `kc_user_id = <uuid>`
  - `created_at = <RFC3339>`
  
  The structured field names MUST be stable so SIEM rules can rely on them.
  The full email MUST NOT appear in logs.
- **FR-011**: Every JIT failure MUST produce a single `WARNING` log line
  with `event = "slack_jit_user_creation_failed"`, `slack_user_id`,
  `email_masked`, and `error_kind` ∈ `{auth_failure, forbidden,
  conflict_resolved, server_error, network_error, domain_excluded,
  no_email}`.
- **FR-012**: All JIT-related code paths MUST honor the existing
  `SecretRedactionFilter` — secrets must never appear in any log emitted
  by this feature.
- **FR-013**: When JIT is enabled but the slack-bot admin credentials
  (`KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_ID` /
  `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_SECRET`) are missing or empty,
  slack-bot startup MUST emit a single `WARNING` log line and JIT
  MUST behave as if disabled (fall through to link-based flow on every
  request). It MUST NOT crash the bot.
- **FR-014**: No new Helm values, Secret keys, or env vars are introduced
  for a separate provisioner client. The existing
  `keycloakAdmin.{clientId, clientSecretFromSecret.{name,key}}` block
  in the slack-bot chart remains the single source of credentials.
- **FR-015**: The realm seeder (`init-idp.sh`) and `realm-config.json`
  MUST ensure `caipe-platform`'s service account holds exactly
  `realm-management.{view-users, query-users, manage-users}` and no
  other realm-management roles. Drift correction MUST be idempotent
  (re-running the seeder against an already-correct realm is a no-op).

---

## 5. Key entities

- **Slack user** — identified by `slack_user_id` (e.g. `U09TC6RR8KX`),
  carries a profile email visible only with `users:read.email` scope.
- **Keycloak user** — identified by `id` (UUID), carries `username`,
  `email`, `enabled`, `attributes` (multi-valued string map), and
  `federatedIdentities` (list of `{identityProvider, userId, userName}`
  entries written by the broker on SSO).
- **Shell user** — a Keycloak user with no password credential, no
  required actions, no realm roles by default. Created by JIT,
  authenticated only via federated identity attached later. The term
  "shell" is internal terminology used in this spec and in code comments.
- **Admin client** (`caipe-platform`) — the slack-bot's single Keycloak
  admin client. Service-account roles after this feature:
  `realm-management.view-users`, `realm-management.query-users`, and
  `realm-management.manage-users`. Used for both user lookup
  (`GET /users?email=…`, `GET /users?q=slack_user_id:…`) and JIT user
  creation (`POST /users` + follow-up `PUT /users/{id}` for attributes).
  No other realm-management roles SHOULD be present (least-privilege
  within the single-client model).

---

## 6. Success criteria

### 6.1 Measurable outcomes

- **SC-001**: A first-time Slack user with no prior Keycloak account
  receives a normal bot response (or the appropriate RBAC denial — but
  not the "could not be auto-linked" dead-end) within **2 seconds** of
  sending their first DM, when JIT is on. Measured by integration test
  wall-clock.
- **SC-002**: Across 100 first-time-user simulations against a fresh
  realm, **0** Keycloak duplicate users are created when each user later
  signs into the web UI via Duo. Measured by post-test assertion that
  every email maps to exactly one Keycloak user.
- **SC-003**: When JIT is off and the user has no Keycloak account,
  **100%** of bot replies contain a working HMAC linking URL (not the
  email-match dead-end message). Measured by parsing the ephemeral
  message text in tests.
- **SC-004**: The slack-bot admin client_secret never appears in any
  log emitted under any code path (including the new JIT branches).
  Measured by a regression test that exercises every JIT branch with
  `SecretRedactionFilter` active and asserts no fragment of the secret
  is present in captured log records.
- **SC-005**: The `caipe-platform` admin client is **allowed**
  `POST /admin/realms/{realm}/users` (HTTP 201) and is **denied** any
  other realm-management write operation that would require a role
  outside `{view-users, query-users, manage-users}` (HTTP 403).
  Measured by a CI test that exercises positive and negative cases
  against a real Keycloak with the seeded realm.
- **SC-006**: An operator can list all JIT-created users in **one**
  Keycloak Admin API call using the `created_by` attribute query.
  Measured by integration test.
- **SC-007**: When the upstream IdP (Duo) reports an email that matches
  an existing JIT shell user, the user signs in to the web UI without
  ever being shown a "We found an existing account, link?" prompt.
  Measured by browser automation test.
- **SC-008**: The `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` config, when set,
  prevents creation of users with non-matching email domains. Measured
  by unit test exercising the gating logic.
- **SC-009**: With `SLACK_JIT_CREATE_USER=true` and admin credentials
  absent, the bot starts cleanly, emits one startup `WARNING`, and
  behaves as if JIT is off for every request. Measured by integration
  test.

---

## 7. Security considerations (summary; full review in
`security-review.md`)

This feature **expands the slack-bot's blast radius**: a previously
read-only-on-users service account gains the ability to create users.
The mitigations below collectively reduce that risk to an acceptable
level.

- **M1 — Bounded privilege within one client**: The single
  `caipe-platform` admin client holds only
  `{view-users, query-users, manage-users}`. It cannot manage clients,
  realms, roles, groups, IdPs, events, or authorization. The JIT code
  path is restricted to `POST /users` + one follow-up
  `PUT /users/{id}` against the freshly-created user only, never
  against pre-existing users (enforced by helper-function shape, not
  by Keycloak roles). A bug in lookup code that mutated a user would
  also be possible — see R-8 in `plan.md` for the residual-risk
  acceptance.
- **M2 — Created users are powerless by default**: No password, no
  required actions, no realm roles. They cannot log in to the web UI
  via password grant, cannot escalate privileges, and have no access to
  any RBAC-protected resource until an operator explicitly assigns
  them roles or team membership. The Slack RBAC enforcement code path
  is unchanged — the JIT user is subject to the same denials as any
  other unmapped user.
- **M3 — Optional domain allowlist**: `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`
  prevents JIT for emails outside the operator's trust boundary
  (e.g. Slack guests, personal emails).
- **M4 — Trust the IdP, not Slack**, for first broker login: The
  auto-merge by email is safe because Duo (or the upstream IdP) is
  the **authoritative source** for email-to-identity mapping in the
  corporate domain. Slack's email is **only** used to bootstrap the
  Keycloak record; it is never used as a credential.
- **M5 — Audit trail**: `created_by`, `created_at`, structured logs,
  and SIEM-friendly stable field names mean every JIT user creation
  is observable.
- **M6 — Fail safe**: Every JIT failure (auth, network, conflict, role)
  falls through to the link-based onboarding flow. The bot never
  silently denies a user; they always get an actionable next step.
- **M7 — Defense in depth on log redaction**: All new code paths route
  through the existing `SecretRedactionFilter` and add explicit
  email-masking helpers.

The single biggest residual risk is **EC-4/EC-5** (Slack guests or
personal emails) creating Keycloak shell users that an admin must clean
up. The domain allowlist (M3) reduces but does not eliminate this; the
operator-guide documents how to set it.

---

## 8. Out-of-scope follow-ups (tracked, not implemented here)

- **F-1**: A periodic background job that prunes shell users with no
  `federatedIdentities` and no activity for N days (default 90).
- **F-2**: A web-UI panel that lists JIT-created users pending merge
  (have `slack_user_id` but no `federatedIdentities`).
- **F-3**: An admin notification (Slack DM or email) when a JIT user is
  created in a domain not on the allowlist (audit hint).
- **F-4**: Generalize to `KEYCLOAK_<SURFACE>_BOT_PROVISIONER_*` for
  Webex/Teams/etc. The naming convention is already future-proofed; the
  shared helpers in `keycloak_admin.py` can be parameterized.

---

## 9. Open questions

None at spec time. All design choices were locked in via interactive
clarification (see `research.md`, section "Decision log").

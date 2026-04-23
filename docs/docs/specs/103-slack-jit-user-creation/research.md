# Research: Slack JIT Keycloak user creation with web-UI auto-merge

**Companion to**: [spec.md](./spec.md), [plan.md](./plan.md), [tasks.md](./tasks.md)
**Created**: 2026-04-22
**Status**: Final (post-implementation)

This document captures the **decisions taken** and the **alternatives
explicitly rejected** while designing the JIT path. Everything here is
load-bearing for the security posture of the feature; future maintainers
should re-read it before changing the JIT flow.

---

## D1 — Single Keycloak admin client (`caipe-platform`) for both lookup and creation

### Decision

The Slack bot uses **one** Keycloak admin client
(`caipe-platform`, env: `KEYCLOAK_SLACK_BOT_ADMIN_CLIENT_*`) for both:

- Reading users (`view-users`, `query-users`)
- Creating JIT shell users (`manage-users`)
- Setting attributes on users it just created (`manage-users`)

The service account holds exactly the three `realm-management` client
roles `{view-users, query-users, manage-users}` — no more, no less.

### Alternatives considered

#### A1.a — Dedicated `caipe-slack-bot-provisioner` client

A separate Keycloak client with **only** `manage-users`, kept out of the
slack-bot's normal lookup token cache. The lookup path keeps reading
through the existing read-only client; only the JIT branch acquires a
write-capable token via the second client.

**Pros**:

- Strict privilege separation: a compromised lookup token cannot create
  users; a compromised provisioner token cannot enumerate them.
- Token-exchange audit logs in Keycloak cleanly attribute the two
  responsibility classes to different clients.

**Rejected because**:

- Doubles the secret-bootstrap surface (two `ExternalSecrets`, two
  `Secret` Helm templates, two rotation calendars) for a
  ~5 KLOC integration component.
- The threat being mitigated (compromised lookup token escalating to
  write) is already mitigated by the helper-shape constraint M1
  (see §M1 below): the only `PUT /users/{id}` call site is hard-coded
  to a UUID *just returned by the same `POST`*, never user-supplied.
- The audit story is recovered cheaply by always-on
  `event=slack_jit_user_created` log lines from the bot itself, which
  also include the `slack_user_id` and `mask_email(email)` for human
  triage.
- Operationally the team's Keycloak admin already had to be told
  exactly **one** secret per environment for `caipe-platform`; doubling
  that during the 098 rollout would have been a regression.

#### A1.b — A separate Keycloak admin client per slack workspace / tenant

Multi-workspace tenancy was deferred to a later spec (cf. spec.md
§"Out-of-scope"). Single workspace ⇒ single client.

### Trade-off accepted (R-8 in plan.md)

A compromise of `caipe-platform`'s service-account credentials grants the
attacker both read and write on every user in the realm. Mitigations in
production:

- The credential is held only in Helm `ExternalSecrets` (or in dev `.env`)
  and never logged (see `slack_bot/utils/log_redaction.py`).
- `realm-management` roles do **not** include
  `manage-realm`/`manage-clients`/`view-events`, so the blast radius is
  bounded to the user database; an attacker cannot escalate to realm
  configuration or read auth events.
- Keycloak admin events for `MANAGE_USER` / `CREATE_USER` are forwarded
  to the SIEM (see `docs/docs/security/rbac/architecture.md`
  Component 1) and an unexpected creation rate triggers the
  `KeycloakUserCreationSpike` alert.

---

## D2 — Auto-merge on first Duo sign-in (no user prompt)

### Decision

The Keycloak Identity Provider for Duo OIDC is configured with:

- `firstBrokerLoginFlowAlias` = `silent-broker-login` (a custom flow
  containing only `idp-create-user-if-unique` (ALTERNATIVE) followed by
  `idp-auto-link` (ALTERNATIVE))
- `trustEmail = true`
- `syncMode = IMPORT` (changed from `FORCE` mid-session — see D2.b)

The result: when a JIT-created shell user (with a verified email but no
federated identity) signs in via Duo for the first time, Keycloak
silently links the federated identity to the existing shell user. The
user sees a normal Duo redirect and lands in the CAIPE web UI; they do
**not** see Keycloak's default "We found an existing account, link?"
confirmation prompt.

### Alternatives considered

#### A2.a — Keycloak's default `first broker login` flow with confirmation prompt

The out-of-the-box flow shows the user the email of the existing account
and asks them to confirm linking it. This is the safe default for an
unbounded multi-tenant Keycloak: it stops a malicious IdP from
auto-attaching itself to a victim's existing account.

**Rejected because**:

- In our deployment the IdP is the corporate enterprise SSO; it
  authoritatively owns the email namespace. There is no scenario where
  a different person legitimately owns the same enterprise email at the
  IdP level.
- The user-visible confirmation prompt would be the *only* time the user
  ever sees the Keycloak realm; the rest of CAIPE hides Keycloak behind
  the BFF and Duo. Showing it once for what looks like an internal app
  bug is bad UX.
- All five auth-architecture peer reviewers preferred the silent-merge
  trade-off given the bounded threat model.

#### A2.b — `syncMode=FORCE` (initial choice, reverted)

The initial implementation used `syncMode=FORCE` so attributes from the
IdP overwrite local attributes on every login. Mid-session we discovered
that this **wiped the `slack_user_id` attribute** that the JIT branch
had just written, because the IdP's userinfo response does not include
that attribute.

**Reverted to `syncMode=IMPORT`** which only sets attributes on first
import and never overwrites them on subsequent logins. The `slack_user_id`
attribute is now preserved across web-UI logins, which was always the
intended behavior.

The change is captured in:
- `charts/ai-platform-engineering/charts/keycloak/scripts/init-idp.sh`
  (canonical script, IDP `syncMode: IMPORT`)
- `docs/docs/security/rbac/workflows.md` (updated diagram)

---

## D3 — Default JIT to ON, gated by env flag

### Decision

`SLACK_JIT_CREATE_USER` defaults to `true`. Operators opt **out** by
setting it to `false` in the deployment env or Helm values
(`slackBot.jit.createUser=false`).

### Alternatives considered

#### A3.a — Default OFF, opt-in

**Rejected because** the entire reason this spec exists is that the
default behavior (refuse to talk to unknown Slack users) is bad UX in
the corporate-Slack-only environment that is our primary deployment
target. Defaulting OFF would mean every operator immediately flips it
ON, which is a strong signal the default is wrong.

#### A3.b — Default ON, no opt-out flag

**Rejected because** we have at least one known deployment (an external
partner pilot) where the slack workspace is multi-organization and
auto-creating Keycloak users for unknown email domains would let a
partner's user impersonate a CAIPE user just by joining a shared Slack
channel. The combination `SLACK_JIT_CREATE_USER=true` +
`SLACK_JIT_ALLOWED_EMAIL_DOMAINS=corp.com` covers this case explicitly.

---

## D4 — `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` allowlist (CSV)

### Decision

When non-empty, `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` is a CSV of email
domain suffixes (lowercase, no leading `@`). The JIT branch creates a
user only if the Slack profile's email's domain is in the list.

When empty (the default), all domains are allowed (subject only to JIT
being enabled at all).

### Alternatives considered

#### A4.a — Regex-based allowlist

**Rejected** as overkill for the actual operator need (typically 1-3
literal corporate domains). A CSV is easier to audit in PR review.

#### A4.b — Denylist instead

**Rejected**: an operator that needs precise control wants to specify
the *known good* set, not chase down every public-email domain that
might leak in via partner Slack federation.

---

## D5 — Reuse the existing admin token cache, no new token plumbing

### Decision

The JIT branch acquires its admin token via the same
`KeycloakAdminConfig` + admin token cache that the lookup path already
uses. No new connection pool, no new env var, no separate refresh
schedule.

### Rationale

Adding a second token client would have meant either a second
`httpx.AsyncClient` instance (doubling sockets per process) or
threading two tokens through every helper signature (boilerplate
explosion). Since D1 already settled on a single client, reusing the
single token cache is a free correctness win.

---

## D6 — `email_masking.py` for log redaction (FR-010, FR-011)

### Decision

A small `mask_email(email)` helper returns `"<first 3 chars>***@<domain>"`
(e.g. `srz***@cisco.com`). Used by every log line that needs to mention
a user identity for triage but must not leak the full email.

This is paired with a broader `log_redaction.py` (PII scrubber) wired
into the loguru sink at startup so existing call sites pick up redaction
without per-line code changes.

### Alternatives considered

#### A6.a — Hash the email instead of masking

**Rejected** because operators triaging a JIT failure need to recognize
the user from the log line. A hash provides correlation but no human
readability; masking gives both ("yeah that's `sri***@cisco.com`, that's
me").

#### A6.b — Don't log the email at all

**Rejected** because it makes triage of "JIT created the wrong user for
me" complaints impossible. Masked email is the right balance.

---

## M1 — Helper-shape mitigation: `PUT /users/{id}` is bound to the freshly-created UUID

### Mitigation

`create_user_from_slack()` returns a `kc_user_id` UUID parsed from the
`Location` header of the `POST /admin/realms/caipe/users` response.
Any subsequent `PUT /users/{id}` call inside the same flow (e.g. to set
a `slack_user_id` attribute defensively) is constrained to that exact
UUID — the caller never gets a generic `update_arbitrary_user(id, ...)`
helper.

This is structural: the JIT module exports
`create_user_from_slack(slack_user_id, email)` which internally chains
the POST + optional PUT, but never exports a `set_attribute_on_any_user`
function. The keycloak_admin module's general-purpose `set_user_attribute`
is rate-limited and audit-logged separately.

### Why this matters

In a future bug where Slack profile data flows into the JIT path
unsanitized, the worst an attacker could do is create a user with a
wonky email/name and write attributes on **that new user only**. They
cannot pivot to writing attributes on, say, the admin user.

Test coverage: `test_post_users_url_targets_only_freshly_created_id` in
`test_keycloak_admin_jit.py` exercises this invariant.

---

## References used

- Keycloak Server Administration — IdP brokering flow customization:
  - `idp-create-user-if-unique` execution
  - `idp-auto-link` execution
  - `firstBrokerLoginFlowAlias` configuration
  - `syncMode` semantics (FORCE vs IMPORT vs LEGACY)
- Keycloak Admin REST API — user representation requirements:
  - PUT `/admin/realms/{realm}/users/{id}` requiring full user-profile
    fields in Keycloak 26 (the round-trip fix in `keycloak_admin.py`).
- RFC 8693 — OAuth 2.0 Token Exchange (background only; JIT does not
  use token-exchange).
- `docs/docs/security/rbac/architecture.md` Component 1 — Keycloak
  baseline configuration that this spec extends.

---

## Open follow-ups (NOT for this spec)

- **F1**: Periodic CI assertion that `service-account-caipe-platform`
  holds *exactly* `{view-users, query-users, manage-users}` and no
  others. Tracked separately from this spec.
- **F2**: Multi-workspace Slack tenancy: per-workspace admin client and
  per-workspace JIT allowlist. Out of scope here; tracked in a future
  spec (104).
- **F3**: An admin UI surface to list "JIT-created users that never
  completed Duo sign-in" (i.e. shell users older than N days with no
  `federatedIdentities` entry) for cleanup.

---

Assisted-by: Claude:claude-opus-4-7

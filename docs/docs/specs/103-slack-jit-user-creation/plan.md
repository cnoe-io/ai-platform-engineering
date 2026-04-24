# Implementation Plan: Slack JIT Keycloak user creation with web-UI auto-merge

**Branch**: `prebuild/feat/slack-jit-user-creation`
**Date**: 2026-04-22
**Spec**: [spec.md](./spec.md)
**Tasks**: [tasks.md](./tasks.md)

---

## 1. Summary

Wire two new code paths into slack-bot's `auto_bootstrap_slack_user`:

1. **JIT-on path**: when `SLACK_JIT_CREATE_USER=true` and Slack returned an
   email but no Keycloak user matches, the bot creates a federated-only
   Keycloak shell user via the **existing `caipe-platform` admin client**.
   The same client is used for both lookups and creates; we deliberately
   avoid introducing a second client (see R-8). Its service account holds
   exactly `{view-users, query-users, manage-users}` and nothing else. The
   user is created with no password, no required actions,
   `emailVerified=true`, and the `slack_user_id`, `created_by`,
   `created_at` attributes pre-set.
2. **JIT-off path**: when `SLACK_JIT_CREATE_USER=false` and there's no
   matching user, the bot replaces the current dead-end "could not be
   automatically linked" message with the existing HMAC-signed link URL
   (the same one used today when `SLACK_FORCE_LINK=true`).

Auto-merge on later web-UI Duo SSO is achieved by configuring the IdP's
First Broker Login flow to "Automatically Set Existing User" with
`trustEmail=true`, `syncMode=FORCE`. This is a realm-level change applied
in `init-idp.sh` and the realm config JSON. No code changes are needed in
the UI BFF — Keycloak handles the merge transparently.

---

## 2. Technical context

| Aspect | Value |
|---|---|
| Language/version | Python 3.11+ (slack-bot), Bash 5.x / busybox sh (init scripts), YAML/JSON (Helm + realm config) |
| Primary deps | `httpx` (async HTTP), Keycloak 24.x Admin REST API, slack-bolt 1.27 |
| Storage | Keycloak realm DB (users + attributes); no new tables |
| Testing | `pytest` + `pytest-asyncio` (unit), shell-driven integration via `make e2e-test-minimal`, browser-level verification via Slack DM + Duo web sign-in |
| Target platform | Docker Compose (dev), Kubernetes via Helm (prod) |
| Project type | Web service (Python backend, no frontend changes) |
| Performance goal | JIT user creation overhead ≤ 300 ms (one POST + one PUT to Keycloak), p95 ≤ 800 ms including token fetch |
| Constraints | Must not break existing email-match path; must not change behavior when `SLACK_JIT_CREATE_USER` is unset (defaults to `true` in dev compose, but operator-controlled in prod) |
| Scale | Single Keycloak realm, low write rate (≤ 1 JIT user / minute typical) |

---

## 3. Constitution check

The repo's principles document (`.specify/memory/constitution.md` and
`AGENTS.md`) is consulted. The relevant gates for this feature:

| Gate | Status | Notes |
|---|---|---|
| Conventional Commits + DCO | ✅ planned | All commits will be `feat(slack-bot): …`, `feat(keycloak): …`, etc. with `Signed-off-by:` from the human committer; `Assisted-by: Claude:claude-opus-4-7` per the DCO + AI attribution policy in `AGENTS.md`. |
| Spec-driven workflow | ✅ in progress | spec.md → plan.md → tasks.md → code, in order. |
| Living RBAC docs | ✅ planned | `docs/docs/specs/098-enterprise-rbac-slack-ui/how-rbac-works.md` will be updated in the same PR per the CLAUDE.md rule. |
| `codeguard-1-hardcoded-credentials` | ✅ | No new secrets introduced. JIT reuses the existing `KEYCLOAK_SLACK_BOT_ADMIN_*` env vars / K8s Secret / ESO setup. |
| `codeguard-0-authorization-access-control` | ⚠️ accepted | We deliberately did **not** split lookup and creation into two clients. The single `caipe-platform` client holds `{view-users, query-users, manage-users}` and nothing else. R-8 documents the trade-off and the compensating mitigations (helper-function shape, domain allowlist, JIT-user-has-no-roles default, audit attributes, idempotent role re-assertion). |
| `codeguard-0-logging` | ✅ | Existing `SecretRedactionFilter` extended; email masking helper introduced. Stable structured fields per FR-010. |
| `codeguard-0-input-validation-injection` | ✅ | Email, slack_user_id, and timestamp pass through `httpx`'s JSON encoder; no string concatenation into Keycloak URLs beyond `urllib.parse.quote`. |
| `codeguard-0-supply-chain-security` | ✅ | No new dependencies. |

**No constitution violations require justification.**

---

## 4. Project structure

### Documentation for this feature

```text
docs/docs/specs/103-slack-jit-user-creation/
├── spec.md              # Done (Phase 0)
├── plan.md              # This file (Phase 1)
├── tasks.md             # Phase 2 (next)
├── research.md          # Phase 1 — design choices and rejected alternatives
├── security-review.md   # Phase 1 — threat model and mitigations
└── (no contracts/data-model dirs needed; no new APIs or persistent schemas)
```

### Source files touched (real paths)

```text
ai_platform_engineering/integrations/slack_bot/
├── utils/
│   ├── keycloak_admin.py              # +create_user_from_slack helper (reuses KeycloakAdminConfig)
│   ├── identity_linker.py             # +JIT branch in auto_bootstrap_slack_user
│   └── email_masking.py               # NEW: small helper used by logs
├── app.py                              # off-path message → linking URL
└── tests/
    ├── test_keycloak_admin_jit.py            # NEW
    ├── test_identity_linker_jit.py           # NEW
    └── test_app_offpath_message.py           # NEW

charts/ai-platform-engineering/charts/keycloak/scripts/
└── init-idp.sh                         # +_ensure_caipe_platform_user_roles (idempotent drift correction)

charts/ai-platform-engineering/charts/keycloak/
└── realm-config.json                   # caipe-platform service account: add query-users (manage-users already present)

deploy/keycloak/
└── realm-config.json                   # same change as the chart copy

charts/ai-platform-engineering/charts/slack-bot/
├── values.yaml                         # +jit.createUser, +jit.allowedEmailDomains
└── templates/
    └── deployment.yaml                 # +SLACK_JIT_CREATE_USER, +SLACK_JIT_ALLOWED_EMAIL_DOMAINS

docker-compose.dev.yaml                 # +SLACK_JIT_CREATE_USER on slack-bot (no new credentials)
.env.example                            # +commented documentation for the two new feature flags

docs/docs/specs/098-enterprise-rbac-slack-ui/
├── how-rbac-works.md                   # update component sections + flow diagram + file map
├── operator-guide.md                   # +"Enabling JIT user creation" section
├── architecture.md                     # +"Slack JIT shell-user creation" subsection
├── file-map.md                         # +entries for new files
└── quickstart.md                       # +note on JIT default behavior

docs/docs/security/rbac/
└── secrets-bootstrap.md                # update slack-bot admin-client subsection: same secret now also authorizes JIT creation
```

**Structure decision**: Single Python package (`slack_bot`) plus existing
Helm chart layout. No new packages, no new modules above the
`utils/` boundary. The `email_masking.py` helper is local to `slack_bot`
because the rest of the codebase uses `loguru` + redaction filters and
doesn't have a shared masking utility.

---

## 5. Phased delivery

### Phase 0 — Spec (DONE)

`spec.md` written. Decisions locked in via three interactive questions
(merge UX, perm model, feature flag default). See `research.md` for the
decision log.

### Phase 1 — Design artifacts

Outputs of this phase:

- `plan.md` (this file)
- `research.md` — decision log, rejected alternatives, references
- `security-review.md` — STRIDE walkthrough, threat catalog, mitigations
  cross-referenced to FRs

### Phase 2 — Tasks

`tasks.md` (next). Tasks are atomic, ordered, and grouped by logical
review unit so the resulting PR commits cleanly.

### Phase 3 — Implementation

Strict order, each step independently verifiable:

1. **Realm config** — ensure `service-account-caipe-platform` has
   `{view-users, query-users, manage-users}`. Update both
   `realm-config.json` files; add idempotent
   `_ensure_caipe_platform_user_roles()` to `init-idp.sh` for clusters
   that already imported the old config; verify on a fresh
   `make e2e-test-minimal` that the role mapping is exactly that set.
2. **First Broker Login flow** — already configured. Verify only.
3. **JIT helper** — add `create_user_from_slack(slack_user_id, email)`
   to `keycloak_admin.py` reusing the existing admin token cache. Unit
   tests pin the contract: same env vars as lookup, helper-shape
   restricts follow-up `PUT /users/{id}` to the freshly-created id.
4. **JIT branch in auto_bootstrap** — extend `auto_bootstrap_slack_user`
   to call `create_user_from_slack` when JIT is on and lookup misses.
   Handle 409 → re-query. Unit tests cover all branches.
5. **Off-path message fix** — replace dead-end message in `app.py` with
   linking URL. Unit test asserts the URL appears in the ephemeral text
   when JIT is off and lookup misses.
6. **Helm + Compose wiring** — feature-flag env vars only (no new
   secrets). Verify `helm template` renders cleanly with default,
   JIT-off, and allowedEmailDomains-populated values.
7. **Live verification** — `make e2e-test-minimal-down && make
   e2e-test-minimal`, send Slack DM from new email, observe JIT user
   creation, complete Duo sign-in (or simulated equivalent), confirm
   single Keycloak user with both attribute and federated identity.
8. **Docs** — update all six doc files in the same PR.

### Phase 4 — Code review and merge

Per `skills/babysit/SKILL.md`: open PR, address reviewer comments,
re-run CI, merge.

---

## 6. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | Operator's existing `caipe-platform` admin client lacks `manage-users` (custom-hardened install) → JIT silently degrades | Medium | Medium | FR-013: emit a single startup `WARNING` on first JIT 403; document in operator-guide that JIT requires `manage-users` on the slack-bot admin client |
| R-2 | Auto-merge IdP flow misconfigured → duplicate users | Low | High | Realm config asserted by integration test; documented in operator-guide; pre-merge check via `helm template` + `kc-export` script |
| R-3 | `caipe-platform` ends up with broader realm-management roles than intended (e.g. `manage-clients`) | Low | High | T002 of `tasks.md` enumerates the desired role set explicitly; `init-idp.sh` re-asserts it on every boot; CI test asserts no role outside `{view-users, query-users, manage-users}` is present |
| R-4 | Slack guest with personal email → unwanted user creation | Medium | Low | Optional `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`; documented; default is permissive for back-compat |
| R-5 | Concurrent first-DMs from same user → duplicate POST → 409 | Low | Low | FR-008: catch 409, re-query, return the surviving user |
| R-6 | The `created_by` attribute is overwritten by a later admin edit | Very Low | Low | Documented as known limitation; F-1 follow-up adds a periodic reconciler if desired |
| R-7 | Existing tests break due to env var name addition | Low | Medium | All new env vars have safe defaults; unit-test isolation per test file |
| R-8 | Single client used for both lookup and creation: a bug or compromised secret in the slack-bot can both read and create users, with no second-secret defense layer | Medium | Medium | Accepted in exchange for one Secret / one rotation / one audit identity. Mitigations: (a) helper-function shape restricts `PUT /users/{id}` to the freshly-created `id` only; (b) `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` bounds who JIT can create; (c) JIT-created users have no roles by default (M2 in spec); (d) `created_by=slack-bot:jit` provides an audit signal; (e) `caipe-platform`'s service account holds only `{view-users, query-users, manage-users}` — no client/realm/role/group/IdP/event admin |
| R-9  | `caipe-platform` accidentally accumulates extra realm-management roles over time (drift) | Low | Medium | `init-idp.sh` is idempotent and re-asserts the exact role set on every boot; CI test enumerates the actual role mapping and fails on unexpected additions |

---

## 7. Backwards compatibility

- **No new credential env vars.** `KEYCLOAK_SLACK_BOT_ADMIN_*` is the
  only Keycloak credential the slack-bot reads; JIT uses the same
  client. The two new env vars (`SLACK_JIT_CREATE_USER`,
  `SLACK_JIT_ALLOWED_EMAIL_DOMAINS`) are feature flags, not secrets.
- **No public API changes.** No HTTP endpoint added or modified on
  slack-bot. The Keycloak Admin API surface used is standard
  (`POST /users` + `PUT /users/{id}`).
- **Default `SLACK_JIT_CREATE_USER=true` in `docker-compose.dev.yaml` and
  the slack-bot Helm chart's `values.yaml`.** Operators upgrading via
  Helm in production will get JIT enabled unless they explicitly set
  `slack-bot.jit.createUser=false`. **This is documented as a
  release-note item** and the operator-guide gives an explicit opt-out
  recipe. The decision is justified: in a corporate-only Slack
  workspace this is the desired behavior, and the failure mode (R-1)
  is observable and harmless.
- **Existing `SLACK_FORCE_LINK=true` continues to behave the same way**
  — JIT is bypassed entirely if `SLACK_FORCE_LINK=true`, because that
  flag means "I want manual link confirmation always".
  Precedence: `SLACK_FORCE_LINK=true` → always send link URL.
  `SLACK_FORCE_LINK=false` (default) + `SLACK_JIT_CREATE_USER=true` →
  JIT, falling through to link URL on JIT failure.
  `SLACK_FORCE_LINK=false` + `SLACK_JIT_CREATE_USER=false` → always
  send link URL on lookup miss (no JIT).

---

## 8. Test plan

### Unit (pytest, in slack-bot)

- `test_keycloak_admin_jit.py`
  - `create_user_from_slack` uses `KEYCLOAK_SLACK_BOT_ADMIN_*`
    credentials (no separate provisioner env var consulted)
  - builds the correct POST body
  - 409 conflict path re-queries by email
  - 401/403 raise typed exceptions with `error_kind`
  - follow-up `PUT /users/{id}` only ever targets the just-returned id
    (regression on M1 helper-shape)
- `test_identity_linker_jit.py`
  - JIT on + miss → calls `create_user_from_slack`
  - JIT off + miss → returns None (does not call `create_user_from_slack`)
  - JIT on + admin config missing → falls through to None, emits one
    WARNING
  - email-match still works when JIT is on (no regression)
  - domain allowlist gates correctly
- `test_app_offpath_message.py`
  - `_rbac_enrich_context` returns "unlinked"; off-path branch in
    `_send_unlinked_prompt` (or whatever the extracted helper is named)
    produces a linking URL string

### Integration (existing `make e2e-test-minimal` rig)

- Bring up stack with default `SLACK_JIT_CREATE_USER=true`.
- Use a test email that does not exist in the realm.
- POST a synthetic Slack event to the bot's `/slack/events` endpoint.
- Assert Keycloak `GET /admin/realms/caipe/users?email=<test>` returns
  exactly one user with `attributes.created_by=["slack-bot:jit"]`.
- Repeat with `SLACK_JIT_CREATE_USER=false`; assert no user is created
  and the synthetic Slack response payload contains the linking URL
  text fragment.

### Live verification (manual, documented in `tasks.md`)

- Real Slack DM from `sraradhy@cisco.com` (currently absent from realm).
- Observe `slack_jit_user_created` log line.
- Verify Keycloak admin UI shows the new user with the right attributes
  and no password.
- Sign into web UI via Duo as the same person.
- Verify Keycloak still has exactly one user, now with `federatedIdentities`.

---

## 9. Rollback

A pure code rollback (revert PR) is sufficient. The only realm-level
change is one extra realm-management role (`query-users`) on the
`caipe-platform` service account, which can be left in place after
revert without impact — it just enables a slightly richer user-search
API for the lookup code path that already existed.

JIT users created during the period the feature was live remain in the
realm. They are valid federated-identity-only Keycloak users; nothing
about the rollback invalidates them. If desired, an operator can list
them via `q=created_by:slack-bot:jit` and decide per-user whether to
keep, delete, or transfer.

---

## 10. Complexity tracking

No constitution violations require justification. This plan introduces
**zero new Keycloak clients**, **one new helper function** (~50 LOC),
**one new branch** in an existing function (~15 LOC), **one
message-text replacement**, and **one idempotent shell function** in
`init-idp.sh` for drift correction. Total new LOC including tests: ~450.

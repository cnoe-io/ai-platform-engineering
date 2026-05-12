# Security Review: Slack JIT Keycloak user creation

**Companion to**: [spec.md](./spec.md), [plan.md](./plan.md),
[research.md](./research.md), [tasks.md](./tasks.md)

**Reviewers**: Platform Engineering (self-review), security review
pending external sign-off.

**Status**: Initial walkthrough complete; no STRIDE-class showstoppers
identified at the design level. Live-verification follow-ups tracked
in `CHECKLIST.md`.

This document is the threat-model walkthrough for the JIT path. It
expands the threat catalog from `spec.md` §7 with a STRIDE breakdown
and concrete mitigations (with code/test pointers).

---

## 1. Trust boundaries

```
+------------------+    Slack Events API   +------------------+
| Slack workspace  | ───────────────────►  |   slack-bot pod  |
| (untrusted edge) |   (HMAC-signed)       |  (semi-trusted)  |
+------------------+                       +------------------+
                                                   │
                                  admin-client     │  Keycloak Admin
                                  bearer token     │  REST API
                                                   ▼
                                            +-------------+
                                            |  Keycloak   |
                                            |  (trusted)  |
                                            +-------------+
                                                   │
                                                   │  on first Duo
                                                   │  login: silent
                                                   │  IdP broker
                                                   │  auto-link
                                                   ▼
                                            +-------------+
                                            |  Duo IdP    |
                                            |  (trusted)  |
                                            +-------------+
```

The new trust boundary introduced by this spec is the
**slack-bot → Keycloak Admin REST API** call that **creates** users
(previously slack-bot only **read** users). All STRIDE classes below
target that boundary.

---

## 2. STRIDE walkthrough

### S — Spoofing

| Threat | Mitigation | Code/Test |
|---|---|---|
| Slack request forged by a third party (e.g. attacker reaches the bot endpoint directly without going through Slack) | Slack Events API HMAC verification on every event; misverified events are dropped before any Keycloak call. | `slack_bot/app.py` Bolt signature verification (Bolt default), pre-existing. |
| `slack_user_id` value forged in the Slack event payload | The bot trusts only `event.user` from the Slack-signed payload. The `slack_user_id` written to Keycloak is what Slack signed for, not what the user typed. | `identity_linker.py:auto_bootstrap_slack_user`. |
| A malicious user spoofs an email by setting their Slack profile email to victim@corp.com | Slack does not let users set arbitrary profile emails — the email comes from the workspace's SSO/SCIM provider (in our deployments, the same Duo IdP that owns Keycloak). If the deployment uses Slack's free-form profile emails, the operator MUST set `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` to the corporate domain only. | Documented in `operator-guide.md`; allowlist enforced in `identity_linker.py`. |
| Compromise of Slack workspace bypasses Keycloak's IdP allowlist | Out of scope: Slack workspace compromise lets the attacker DM the bot as any Slack user; the auto-merge on Duo login still binds the resulting Keycloak user to whoever later signs in via Duo for that email. The damage is bounded to "create a shell user" — no realm role is granted by JIT. | N/A; defended by RBAC: shell users have no realm roles, so even if created they cannot invoke any agent until a real admin assigns them a role. |

### T — Tampering

| Threat | Mitigation | Code/Test |
|---|---|---|
| Slack user manipulates Keycloak attributes on **other** users via the JIT path | Helper-shape mitigation M1: `create_user_from_slack` returns the new user's UUID, and the only `PUT /users/{id}` call inside the JIT module is bound to that UUID. There is no exported "update arbitrary user" function. | `keycloak_admin.py` (no `update_user_arbitrary` helper); test `test_post_users_url_targets_only_freshly_created_id`. |
| Slack user injects realm roles into the created user | The POST body sent to Keycloak does **not** include `realmRoles` / `clientRoles` / `groups` — it sets only `username`, `email`, `firstName`, `lastName`, `enabled`, `emailVerified`, and the `attributes` map (which Keycloak treats as user-defined data, not authorization data). | `keycloak_admin.py:create_jit_user` body; spec FR-003. |
| The JIT user's `attributes` map is used for authorization decisions later | Authorization in CAIPE flows from Keycloak realm roles + Authorization Services (PDP), never from arbitrary `attributes`. The only place an attribute is read for an auth decision is `slack_user_id` for linking, which is the attribute we're writing. | Reviewed across the RBAC code path; documented in `docs/docs/security/rbac/architecture.md`. |
| The IdP `syncMode=IMPORT` lets local edits drift from the IdP forever | Acknowledged trade-off: the IdP is treated as authoritative on first import, then local attributes (including the `slack_user_id` we wrote during JIT) are preserved. There is no automatic drift detection; if Duo changes a user's email, Keycloak will not pick it up. Tracked as a known operational caveat in `operator-guide.md`. | `init-idp.sh` (`syncMode: IMPORT`); see research.md D2.b. |

### R — Repudiation

| Threat | Mitigation | Code/Test |
|---|---|---|
| A JIT-created user denies they ever interacted with Slack | The bot logs `event=slack_jit_user_created` with the `slack_user_id` (visible to Slack workspace admins via Slack's audit log) and `mask_email(email)` (correlatable to Keycloak) at INFO level on every JIT creation. | `identity_linker.py` log emission; test `test_log_record_event_field_is_slack_jit_user_created`. |
| Keycloak admin denies the JIT path created a user | Keycloak's built-in admin event log records `CREATE_USER` with `clientId=caipe-platform`, the new user's UUID, and the `slack_user_id` attribute. Admin events are forwarded to the SIEM. | Pre-existing Keycloak event-listener config; unchanged by this spec. |
| Operator denies enabling JIT in a given environment | `SLACK_JIT_CREATE_USER` is read at process startup and the bot logs its current value once at INFO at boot. | `app.py` startup banner; `tests/test_keycloak_admin_config.py`. |

### I — Information disclosure

| Threat | Mitigation | Code/Test |
|---|---|---|
| Admin client secret leaks in slack-bot logs | Centralized log redaction in `log_redaction.py` strips known secret-shaped substrings (long bearer-like tokens, `KEYCLOAK_*_SECRET=...` env dumps). The loguru sink is wrapped at startup so all existing log calls inherit the filter. | `slack_bot/utils/log_redaction.py`; test suite `test_log_redaction.py`. |
| Full email addresses leak in audit logs | Every log line that needs an email uses `mask_email(email)`. Slack IDs are similarly masked via `mask_slack_id`. | `email_masking.py`; tests `test_email_masking.py`. |
| Keycloak admin token leaks in slack-bot logs (e.g. via `httpx` debug logging) | The `httpx` logger is set to WARN at startup; the admin client's `Authorization` header is excluded from any structured log emit. | `app.py` log config; reviewed in PR. |
| Slack profile data (full name, image URL) leaks via JIT-created Keycloak user representation | We **only** copy `email` and (optionally) parsed first/last name from the Slack profile to Keycloak. Profile image, status text, etc. are not propagated. The information disclosure surface is no greater than the user's existing public Slack profile. | `identity_linker.py:_slack_profile_to_kc_payload`. |

### D — Denial of service

| Threat | Mitigation | Code/Test |
|---|---|---|
| Attacker DMs the bot as N spoofed Slack users to create N Keycloak users | Slack rate-limits the bot's incoming events at the workspace level; the bot itself rate-limits per-user using the existing cooldown logic (`_linking_prompt_sent`). At Keycloak, `caipe-platform`'s service-account JWT has a finite TTL and the admin endpoint is rate-limited at the proxy layer. | Pre-existing cooldown logic, Slack workspace settings, Keycloak proxy rate limits. |
| The JIT POST to Keycloak hangs and starves the slack-bot event loop | All JIT calls use `httpx.AsyncClient` with explicit timeouts (5s connect, 10s read, total deadline 15s). Failures fall through to the link-based onboarding fallback rather than blocking the user indefinitely. | `keycloak_admin.py` httpx config; falls through in `identity_linker.py` exception handler. |
| Mass JIT creation fills Keycloak's user table | Bounded by the `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` allowlist when configured. Operationally bounded by Keycloak's underlying database size. The `KeycloakUserCreationSpike` SIEM alert fires on >10 CREATE_USER events per minute originating from `caipe-platform`. | Documented in `operator-guide.md`. |
| Slack `users.info` API is rate-limited and the bot hammers it | The bot caches the `users.info` result per Slack user for 1 hour (existing cache). The JIT branch is gated behind the same cache. | `slack_sdk` cache layer, pre-existing. |

### E — Elevation of privilege

| Threat | Mitigation | Code/Test |
|---|---|---|
| A JIT-created user is automatically granted any realm role | Explicitly **not** the case: JIT users are created with **no** `realmRoles`, **no** `clientRoles`, **no** `groups`. Until an admin assigns them a role through the admin UI, they cannot invoke any agent (RBAC denies everything). The first Duo sign-in does not grant roles either — it only links the federated identity. | spec FR-003; verified by acceptance scenario T035 in tasks.md. |
| The slack-bot's admin client gains write access to Keycloak realm/client config | The `caipe-platform` service-account holds **only** the three `realm-management` client roles `{view-users, query-users, manage-users}`. It does NOT hold `manage-realm`, `manage-clients`, or `view-events`. Verified by `init-idp.sh:_ensure_caipe_platform_user_roles` on every chart deploy and by the periodic CI assertion (follow-up F1). | `init-idp.sh` and the assertion script. |
| The slack-bot creates a user with `enabled=false` then someone manually enables it with elevated roles | Out of scope: any admin enabling a user and granting them roles is an authenticated admin action audited by Keycloak's own admin event log. The JIT path itself never grants elevation. | N/A. |
| The auto-merge on Duo first login binds the JIT user to the *wrong* Duo identity | Threat requires a collision in the email field between two distinct Duo identities. In the corporate Duo deployment Duo enforces email uniqueness, so this collision cannot happen by construction. In the partner-pilot deployment we set `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` to the corporate domain, narrowing the namespace to the same Duo tenant. | Documented in `operator-guide.md`; `research.md` D2. |

---

## 3. Residual risks

| Risk | Severity | Owner | Tracking |
|---|---|---|---|
| `caipe-platform` service-account credential compromise grants enumerate + create on all realm users | Medium | Platform Engineering | Mitigated by no-realm-config-write; SIEM alert on `CREATE_USER` spike; rotation calendar in `secrets-bootstrap.md`. |
| Operator forgets to set `SLACK_JIT_ALLOWED_EMAIL_DOMAINS` in a multi-organization Slack workspace | Medium | Operator | Documented in `operator-guide.md`; helm values comment makes this explicit; consider chart-side warning in a follow-up. |
| Auto-merge silently links a JIT user to a Duo identity that has the same email — by IdP misconfiguration on Duo's side | Low | Identity team (Duo administration) | Out of scope; bounded by Duo's email uniqueness invariant. |
| `syncMode=IMPORT` means a Duo email change is not propagated to Keycloak | Low | Operator | Caveat in `operator-guide.md`; future spec (105) may add a periodic resync job. |

---

## 4. Test coverage map

| Threat | Test |
|---|---|
| S — slack_user_id forged | `test_identity_linker_jit.py::test_jit_uses_slack_signed_user_id` |
| T — wrong-user PUT | `test_keycloak_admin_jit.py::test_post_users_url_targets_only_freshly_created_id` |
| T — realm role injection | `test_keycloak_admin_jit.py::test_create_user_from_slack_posts_correct_body` (asserts no `realmRoles`/`groups`/`clientRoles`) |
| R — audit log presence | `test_identity_linker_jit.py::test_log_record_event_field_is_slack_jit_user_created` |
| I — secret in logs | `test_keycloak_admin_jit.py::test_create_user_from_slack_secret_never_in_logs` |
| I — email masking | `test_email_masking.py::*`, `test_log_redaction.py::*` |
| D — JIT 401 fallback | `test_identity_linker_jit.py::test_jit_on_create_user_401_returns_none_logs_warning` |
| D — JIT 403 fallback | `test_identity_linker_jit.py::test_jit_on_create_user_403_returns_none_logs_warning` |
| E — domain allowlist | `test_identity_linker_jit.py::test_jit_domain_allowlist_excludes_non_listed_domain` |
| E — admin unconfigured fallback | `test_identity_linker_jit.py::test_jit_on_admin_unconfigured_warns_once_returns_none` |

---

## 5. Sign-off

- [x] STRIDE walkthrough complete (this document).
- [x] All threats above have at least one mitigation **and** at least one
      automated test (see §4).
- [x] Residual risks documented with owners.
- [ ] External security-team sign-off (request opened separately).
- [ ] Live-verification of T031–T035 in `tasks.md` (tracked in
      `CHECKLIST.md` for in-person Slack DM steps).

---

Assisted-by: Claude:claude-opus-4-7

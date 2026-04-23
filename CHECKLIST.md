# RBAC Live Verification Checklist

Manual verification steps for spec 102 / 103 work that cannot be
covered by unit tests alone.

Branch: `prebuild/feat/comprehensive-rbac`
Last updated: 2026-04-23

---

## A. Spec 102 Phase 8 — DA HTTP 401 fix (live)

These steps verify the DA → agentgateway → MCP chain now forwards
the user JWT instead of the (token-less) `X-User-Context`.

- [ ] Restart `dynamic-agents` container after merging Phase 8:
      `docker compose -f docker-compose.dev.yaml restart dynamic-agents`
- [ ] In the web UI, send a chat message to any agent that uses
      Jira/Confluence/Argo MCP tools.
- [ ] Tail `docker compose logs -f dynamic-agents`. Expect: no
      `HTTP 401 error connecting to http://agentgateway:4000/mcp/...`
      lines. (The previous symptom that motivated this work.)
- [ ] Tail `docker compose logs -f agentgateway`. Each MCP-bound
      request should show an `Authorization: Bearer ...` header in
      access logs.
- [ ] Force-fail by setting `DA_REQUIRE_BEARER=true` in the DA
      container's env and restarting. Without a BFF Bearer, every
      DA request should now return 401 with
      `code: missing_bearer`. Reset the env var after.

---

## B. Spec 102 Phase 6 — Supervisor PDP gate (live)

Off by default. To verify:

- [ ] Set `SUPERVISOR_PDP_GATE_ENABLED=true` on the supervisor
      container and restart.
- [ ] Sign in as a user with the `chat_user` realm role and send
      a chat. Expected: succeeds.
- [ ] Sign in as a user **without** `chat_user` and send a chat.
      Expected: 403 with body
      `{"code":"rbac_denied","reason":"missing_role","action":"contact_admin"}`.
- [ ] Stop Keycloak (`docker compose stop keycloak`). Send a chat
      as a non-bootstrap-admin. Expected: 503 with
      `code: pdp_unavailable`. Restart Keycloak when done.
- [ ] Unset `SUPERVISOR_PDP_GATE_ENABLED` so the rollout is
      reversible.

---

## C. Spec 103 — Slack JIT user creation (live)

Requires a Slack workspace with the dev `caipe-slack-bot` installed.

- [ ] **T031** First-time DM: from a Slack user whose email is **not**
      in Keycloak, send a DM to the bot. Expected: bot replies as
      normal **and** a new Keycloak user appears under
      `Realm > Users` with attributes:
      - `created_by=slack_bot`
      - `created_at` ≈ now
      - `slack_user_id` set to the Slack user's ID.
- [ ] **T032** Second DM from the same Slack user: bot reuses the
      existing user (no duplicate created). Verify by checking
      `users` list count is unchanged.
- [ ] **T033** DM from a disallowed email domain (set
      `SLACK_JIT_ALLOWED_EMAIL_DOMAINS=cisco.com` and DM from a
      `gmail.com` user). Expected: bot replies with the "ask
      admin" message; **no** user is created.
- [ ] **T034** Audit log: `docker compose logs slack-bot | grep JIT`.
      Expected: a single `JIT user created` log line per first-time
      user, with redacted email/Slack ID (per
      `utils/log_redaction.py`).
- [ ] **T035** Web login regression: have the JIT-created user log
      into the web UI via Duo SSO. After login, verify in Keycloak
      that `slack_user_id` and `created_by` attributes are still
      present (this is the `syncMode=IMPORT` fix landed earlier in
      this branch).

---

## D. Spec 103 — Email masking sanity (already unit-tested, double-check)

- [ ] Run `slack-bot` with `LOG_LEVEL=DEBUG`. Send a JIT DM. Inspect
      `docker compose logs slack-bot`: every email should appear as
      `s***y@example.com`-style mask, never plaintext. (Backed by
      `tests/test_email_masking.py` and `tests/test_log_redaction.py`,
      but worth a manual eyeball pass after any logger refactor.)

---

## E. Cleanup after verification

- [ ] Re-run `make lint` and `make test` from repo root.
- [ ] Push branch: `git push origin prebuild/feat/comprehensive-rbac`.
- [ ] Open PR with summary linking spec 102 + 103 closeout.

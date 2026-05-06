# Quickstart: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-27

## Purpose

Short validation scenarios to verify the feature works end-to-end after implementation. These align with the spec’s acceptance scenarios and success criteria.

---

## Prerequisites

- Backend (supervisor) and UI running; MongoDB configured.
- At least one skill in the central catalog (from the default store, from the **`agent_skills`** projection / `source: agent_skills`, or from a hub).
- Optional: One registered GitHub skill hub with at least one SKILL.md in the agreed path.

---

## Scenario 1: Single source — UI and assistant see same skills

1. Open the skills experience in the UI (e.g. `/skills` page or gallery).
2. Note the list of skills shown.
3. In chat, type `/skills` and submit.
4. **Expect**: The list shown in chat matches the list on the skills page (same ids and names; order may differ but set is the same).
5. **Expect**: No “run skills” or **“Run in Chat”** action or button in the chat window; skill use is via the assistant and the shared catalog.

---

## Scenario 2: /skills command in chat

1. Open a conversation in the chat window.
2. Type exactly `/skills` (or the agreed command) and send.
3. **Expect**: The UI does not send this as a normal user message; instead it shows the list of available skills in the chat (e.g. as a system or bot message).
4. Send a normal message (e.g. “What can you do?”).
5. **Expect**: The skills list is not shown automatically; only when the user invokes the command.
6. If the catalog is empty: invoke `/skills` and expect a clear message like “No skills available” rather than an error or blank failure.

---

## Scenario 3: Skill hub registration (admin)

1. As an authorized user (admin or skill hub manager), open the skill hubs admin (e.g. settings or admin page).
2. Add a hub: type `github`, location `owner/repo` (or a real public repo with `skills/*/SKILL.md`), save.
3. **Expect**: Hub is registered and enabled; after refresh or next catalog refresh, skills from that hub appear in the catalog.
4. In chat, type `/skills`.
5. **Expect**: Skills from the hub are included in the list.
6. Remove or disable the hub.
7. Refresh catalog or reload; invoke `/skills` again.
8. **Expect**: Skills from that hub are no longer in the list.

---

## Scenario 4: Graceful degradation

1. **Catalog unavailable**: Stop MongoDB or make the catalog API return 503. In chat, type `/skills`. **Expect**: Clear “Skills are temporarily unavailable” (or similar) message; chat remains usable for normal messages.
2. **Hub failure**: Register a hub with an invalid or unreachable location. **Expect**: Rest of catalog still loads; admin or API shows that the hub failed to load (no silent full-catalog failure).

---

## Scenario 5: Unauthorized hub management

1. As a non-admin user (no skill hub manager role), call `POST /api/skill-hubs` (e.g. via browser or API client) with a valid body.
2. **Expect**: **403** with a clear permission message; no hub is created.

---

## Scenario 6: Duplicate skill ID precedence

1. Ensure default (or built-in) catalog has a skill with id `foo`.
2. Register a hub that also provides a skill with id `foo`.
3. **Expect**: Catalog returns one `foo`; it is the default (or higher-precedence) one. Documented precedence rule is applied (default > hub or registration order).

---

## Scenario 7: GitHub hub crawl / preview (FR-017)

1. As an authorized user, open skill hub onboarding.
2. Enter a public GitHub repo with `skills/*/SKILL.md` and invoke **Crawl** or **Preview** (before Save).
3. **Expect**: UI lists discovered SKILL.md paths (and optional names); no hub row persisted until user confirms **Register**.
4. Register the hub; refresh catalog / supervisor per Scenario 8.
5. **Expect**: Skills from preview appear in catalog and `/skills`.

---

## Scenario 8: Supervisor skills status after refresh (FR-016, SC-007)

1. Note current `graph_generation` and `skills_loaded_count` from the supervisor status API (or admin panel).
2. Add a skill or hub, then call **POST** catalog refresh (or UI “Refresh skills”).
3. **Expect**: Status shows increased or updated `graph_generation` and matching `skills_loaded_count` (or documented stale indicator if rebuild failed).
4. **Expect**: Assistant behavior reflects new skills without pod restart.

---

## Scenario 9: Try skills gateway — Bearer and API key (SC-008, FR-018)

1. Open the skills UI **Try skills gateway** panel.
2. Copy the documented `curl` using a valid **Okta/OIDC access token**; call catalog with `q=` search param.
3. **Expect**: **200** and only skills in the caller’s entitlement (global + teams + personal).
4. Create a **catalog API key** (admin or self-service, per product); repeat `curl` with the key header.
5. **Expect**: Same entitlement rules; **401** with generic message if key revoked or wrong.
6. Walk through in-product **Claude** and **Cursor** steps; **Expect**: No external doc required to complete a minimal integration (export path may be “copy JSON” until file export ships).

---

## Scenario 10: Visibility — team vs personal (FR-020)

1. As user A, create or select a **personal** skill (or mock data) visible only to A.
2. As user B (same org, different `sub`), call `GET` catalog.
3. **Expect**: B does **not** see A’s personal skill; both see **global** skills; team skills only when B shares team id in token claims.

---

## Scenario 11: Skill-scanner outcomes (SC-009, FR-023)

1. Register a hub whose content triggers a **high** severity finding in Skill Scanner (test fixture).
2. **Expect**: Admin UI shows finding; behavior matches configured gate (warn vs block).
3. **Expect**: Copy states scanner is best-effort; clean scan does not imply safety.
4. **Expect**: Admin (or scan) UI includes **attribution** to **Cisco AI Defense** and link **https://github.com/cisco-ai-defense/skill-scanner** per FR-023 / `skill-scanner-pipeline.md`.

---

## Scenario 12: Large catalog — pagination and prompt cap (FR-019, FR-024)

1. Load &gt; `page_size` skills (fixture); call catalog `page=1` and `page=2`.
2. **Expect**: Stable ordering; `meta.total` correct; no timeout from default list (no full `content` in list).
3. Inspect supervisor prompt or logs (non-prod): **Expect** at most **N** skill summaries in the Skills System section per `MAX_SKILL_SUMMARIES_IN_PROMPT`.

---

## Scenario 13: Catalog list latency (plan p95 smoke)

1. With a **typical** catalog size for your environment, call `GET /api/skills` (or direct `GET /skills` with a valid token) repeatedly from a workstation or script (e.g. 20–50 sequential requests, or a simple load tool).
2. **Expect**: p95 latency **under ~500 ms** as stated in `plan.md` **Technical Context**, **or** record measured p50/p95 in run notes if the target is not yet met (file issues for optimization).
3. Use `page_size` appropriate to the UI default; avoid `include_content=true` for this check unless testing that path explicitly.

---

## Scenario 14: Gateway–supervisor sync status (FR-026, SC-010)

1. Open the **Try skills gateway** panel as an authorized user.
2. **Expect**: A **skills sync** (or equivalent) section shows status derived from catalog vs supervisor metadata (`in_sync`, `supervisor_stale`, or `unknown` per `contracts/supervisor-skills-status.md`).
3. Register a hub or change a skill with `source: agent_skills`, then invalidate catalog cache **without** triggering supervisor rebuild (if you have a test hook that only clears HTTP cache). **Expect**: UI shows **supervisor_stale** (or **unknown** if generations not yet wired), not **in_sync**.
4. Call **POST /skills/refresh** (full semantics: cache + MAS rebuild per FR-012). Re-fetch status. **Expect**: **in_sync** (or matching generations).
5. **Expect**: Copy does not claim the assistant has the latest catalog while status is stale.

---

## Quick commands (for implementers)

- **Backend**: Ensure skills middleware is loaded by the supervisor and returns the merged list; supervisor uses it for prompt or tools.
- **UI**: Implement `GET /api/skills` (merge default + agent_skills + hubs); implement `/skills` handling in chat panel; remove any “run skills” / **“Run in Chat”** action from chat; add hub **crawl** UI calling `POST /api/skill-hubs/crawl`; add **gateway** panel + source badges (FR-021, FR-022).
- **Supervisor**: Wire `POST /skills/refresh` to cache invalidation + `AIPlatformEngineerMAS` rebuild; expose status fields per `contracts/supervisor-skills-status.md` (including **sync_status** / generations for FR-026); apply **visibility** + **prompt cap** when building skills for middleware.
- **Refactor (FR-025)**: Align UI/route names with persisted skills (`/api/skills/configs`, `ui/src/app/api/skills/configs/route.ts`) and Mongo `source: agent_skills`; see **`docs/docs/specs/2026-04-29-skills-api-unification/`** for the HTTP path unification spec; keep reads backward-compatible where required.
- **Security**: Integrate Skill Scanner per `contracts/skill-scanner-pipeline.md` (Cisco AI Defense attribution in UI/docs/NOTICE); store API key hashes only.
- **Packaged skills**: Run `scripts/scan-packaged-skills.sh` with `SKILLS_DIR` set in CI or release pipelines; configure `SKILL_SCANNER_GATE` / `SKILL_SCANNER_POLICY` per `ui/env.example`.
- **Tests**: Add integration tests for catalog consistency (UI list vs `/skills` vs middleware); add tests for hub CRUD and 403 when unauthorized; add tests for search pagination and visibility filtering.

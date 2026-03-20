# Quickstart: Integrated Skills — Single Source, Chat Commands, Skill Hubs

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## Purpose

Short validation scenarios to verify the feature works end-to-end after implementation. These align with the spec’s acceptance scenarios and success criteria.

---

## Prerequisites

- Backend (supervisor) and UI running; MongoDB configured.
- At least one skill in the central catalog (from default store or agent_config or hub).
- Optional: One registered GitHub skill hub with at least one SKILL.md in the agreed path.

---

## Scenario 1: Single source — UI and assistant see same skills

1. Open the skills experience in the UI (e.g. `/skills` page or gallery).
2. Note the list of skills shown.
3. In chat, type `/skills` and submit.
4. **Expect**: The list shown in chat matches the list on the skills page (same ids and names; order may differ but set is the same).
5. **Expect**: No “run skills” action or button in the chat window; skill use is via the assistant and the shared catalog.

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

## Quick commands (for implementers)

- **Backend**: Ensure skills middleware is loaded by the supervisor and returns the merged list; supervisor uses it for prompt or tools.
- **UI**: Implement `GET /api/skills` (merge default + agent_configs + hubs); implement `/skills` handling in chat panel; remove any “run skills” action from chat.
- **Tests**: Add integration tests for catalog consistency (UI list vs `/skills` vs middleware); add tests for hub CRUD and 403 when unauthorized.

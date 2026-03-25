# Contract: Chat Command — /skills

**Feature**: 097-skills-middleware-integration | **Date**: 2026-03-18

## Overview

When the user types the designated command (e.g. `/skills`) in the chat window, the client does not send it as a normal message to the assistant. It calls the shared catalog API and displays the list of skills in the conversation. This contract defines the client and API behavior.

---

## Command trigger

- **Trigger**: User input that matches the agreed slash-command. Exact match recommended for v1 (e.g. `/skills`); optional: trim whitespace, case-insensitive.
- **When**: On submit (e.g. Enter or Send). If the input is exactly the command (after trim), treat as command; otherwise send as normal message.

---

## Client behavior

1. **Detect**: Before sending, check if the trimmed input equals the command string (e.g. `/skills`).
2. **If command**:
   - Do not call the A2A/send-message endpoint.
   - Call `GET /api/skills` (or equivalent catalog API).
   - If **200**: Render the list in the chat as a dedicated message (e.g. “Here are the skills available to the assistant:” followed by the list). Optionally show loading state while the request is in flight.
   - If **503** or catalog error: Show a clear, non-technical message (e.g. “Skills are temporarily unavailable. Please try again later.”) in the chat.
   - If catalog returns empty list: Show message like “No skills available at the moment.”
3. **If not command**: Send the message normally to the assistant.

---

## API dependency

- The chat command relies on the same catalog API as the skills gallery (`GET /api/skills`). Contract for that API is in `contracts/catalog-api.md`. No separate “chat command” endpoint; the client uses the catalog response to render the list.

---

## UX details (informative)

- List can be rendered as markdown, cards, or compact list; spec does not mandate format.
- List must match the central catalog (same as used by the assistant and by the rest of the UI) — guaranteed by using the same API.
- No automatic display of skills when the user has not typed the command; the list appears only when the user invokes the command (FR-003, acceptance scenario 3).
- **Direct users to /skills (FR-002)**: After removing "run in chat," the UI MUST direct users to use the `/skills` command to see their loaded skills — e.g. chat input placeholder "Type /skills to see available skills," or tooltip/help text in the chat panel.

# Quickstart: Verify Agent Editor Unsaved Changes Warning

Manual verification recipe for all three navigation paths covered by the feature, plus the must-not-trigger negative cases. Run after any change to the dirty-tracking hook, the dialog, the editor's back button, the agents page tab switcher, or `AppHeader.GuardedLink`.

## Prerequisites

- Local UI dev server running: `cd ui && npm run dev`.
- A user account with admin / dynamic-agents access (see `useAdminRole`).
- At least one existing dynamic agent (or willingness to create one).

## P1 — Back button warns when dirty

1. Navigate to `/dynamic-agents` (Agents tab).
2. Click an existing non-config-driven agent to open the editor.
3. **Don't change anything.** Click the back arrow (top-left of the editor).
   - **Expected**: editor closes immediately, no modal. Returns to agent list.
4. Open the same agent again.
5. Change any field (e.g., append " test" to the name, or edit description).
6. Click the back arrow.
   - **Expected**: in-app modal appears with title "Unsaved changes" and a description that mentions the agent editor.
7. Click **Keep editing**.
   - **Expected**: modal closes, editor remains open, your typed changes are still in the field.
8. Click the back arrow again, then click **Discard changes**.
   - **Expected**: modal closes, editor closes, agent list is shown, your edits are gone.

## P1 — Sub-tab switch warns when dirty

1. Open an agent in the editor and modify any field.
2. Click the **MCP Servers** sub-tab on the Agents page.
   - **Expected**: in-app modal appears. URL has NOT changed yet.
3. Click **Keep editing**.
   - **Expected**: modal closes; you remain on the Agents tab; editor still open with edits intact.
4. Click **LLM Models** sub-tab, then in the modal click **Discard changes**.
   - **Expected**: modal closes; URL switches to `?tab=llm-models`; LLM Models content renders; the editor is gone.
5. Re-open an agent (no changes), click **Conversations** sub-tab.
   - **Expected**: switches immediately, no modal.

## P2 — Top-level header navigation warns when dirty

1. Open an agent and modify any field.
2. In the top header, click **Chat**.
   - **Expected**: in-app modal appears (title "Unsaved changes", generic description). URL has NOT changed.
3. Click **Keep editing**.
   - **Expected**: modal closes; still on `/dynamic-agents`; editor still open and intact.
4. Click **Home** (or the app logo), then **Discard changes**.
   - **Expected**: navigates to `/`; modal gone.

## Negative — does not warn when not dirty

1. Open an agent (no changes). Click any sub-tab → switches immediately.
2. Open an agent (no changes). Click any header link → navigates immediately.
3. Open an agent (no changes). Click back arrow → returns to list immediately.

## Negative — does not warn for read-only / config-driven agents

1. Find a config-driven agent (badged "Config" in the list). Click it to open the read-only viewer.
2. Try to interact with form fields — they are disabled.
3. Click back, click any sub-tab, click any header link.
   - **Expected**: in all three cases, the action proceeds immediately with no modal.

## Negative — wizard step navigation does not warn

1. Open an agent and modify the description on Step 1.
2. Click into Step 2 (Instructions) using the step indicator at the top.
   - **Expected**: switches steps immediately, no modal. Your description edit is preserved.
3. Click back through Step 1.
   - **Expected**: same — step indicator never warns; your edit is still there.

## Save flows — clears dirty correctly

1. Open an agent, change a field, click **Save** at the bottom.
2. After save succeeds and the editor closes, re-open the same agent.
3. Click any sub-tab without changing anything.
   - **Expected**: switches immediately, no modal. (Confirms successful save cleared the dirty flag and didn't leak.)
4. Open an agent, intentionally trigger a save failure (e.g., disconnect network or set a duplicate ID for new-agent flow). Save errors out.
5. Click the back arrow.
   - **Expected**: modal appears (because dirty is still true after a failed save).

## Negative — no native browser dialog

1. Open an agent and modify any field.
2. With the editor open, hit your browser's reload button (Cmd-R / F5).
   - **Expected**: page reloads without any "Leave site?" native browser confirmation. (We intentionally do not block this; the spec excludes native dialogs.)

## Edge — revert clears dirty

1. Open an agent. Note the current name.
2. Type one extra character at the end of the name. Confirm typing makes the dirty state effective by clicking back — modal appears. Click **Keep editing**.
3. Delete that one extra character so the name matches the original exactly.
4. Click back.
   - **Expected**: editor closes immediately, no modal.

## Cloning — starts clean

1. From the agent list, click the Clone (CopyPlus) icon on any agent.
2. Editor opens with " (New)" appended to the name.
3. Without changing anything else, click back.
   - **Expected**: editor closes immediately, no modal. (The " (New)" suffix is part of the initial snapshot.)
4. Open the clone flow again, change the description, click back.
   - **Expected**: modal appears.

## Done

If every section above behaves as described, the feature is verified end-to-end.

# Feature Specification: Warn User About Losing Unsaved Changes in Dynamic Agent Editor

**Feature Branch**: `2026-04-29-agent-editor-unsaved-warning`
**Created**: 2026-04-29
**Status**: Draft
**Input**: User description: "in dynamic agent editor, when there are unsaved changes and the user navigates with back button or click on a tab that will remove their work, warn the user that about their work being lost. Don't do annoying browser pop-up, do in framework modal reminder"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Warn when leaving editor via back button (Priority: P1)

An admin is editing (or creating) a dynamic agent. After they have made one or more changes (e.g., updated the name, description, system prompt, tools, skills, subagents, model, visibility, or theme) and *before* they save, they click the back arrow at the top-left of the editor. Instead of silently discarding their work and returning to the agent list, the system shows an in-app modal that explains they have unsaved changes and asks them to confirm whether they want to discard their work or keep editing.

**Why this priority**: This is the most common path that loses work. The back button is visually inviting and is the primary way users exit the editor. Without a warning, users can lose minutes-to-hours of agent configuration with a single accidental click. This is the MVP — fixing only this path already prevents the majority of unintended data loss in the editor.

**Independent Test**: Open the dynamic agent editor (create or edit), modify any field, click the back arrow. Expect an in-app modal warning. Confirm "Keep editing" returns to the editor with all changes intact; confirm "Discard changes" returns to the agent list.

**Acceptance Scenarios**:

1. **Given** the user has opened the editor and not modified any field, **When** they click the back arrow, **Then** they return to the agent list immediately with no warning.
2. **Given** the user has modified at least one editor field but not saved, **When** they click the back arrow, **Then** an in-app modal appears warning that unsaved changes will be lost.
3. **Given** the unsaved-changes modal is shown, **When** the user chooses "Keep editing", **Then** the modal closes and the editor remains open with all changes intact.
4. **Given** the unsaved-changes modal is shown, **When** the user chooses "Discard changes", **Then** the modal closes, the editor closes, and the user returns to the agent list with their changes discarded.
5. **Given** the user has saved their changes successfully, **When** they then click the back arrow, **Then** they return to the agent list immediately with no warning.

---

### User Story 2 - Warn when switching sub-tabs on the Agents page (Priority: P1)

While the editor is open with unsaved changes, the user clicks one of the sibling sub-tabs on the Agents page (MCP Servers, LLM Models, or Conversations). Switching tabs hides the editor and discards local form state, so the system must warn the user before allowing the switch and let them choose whether to continue or stay.

**Why this priority**: These sub-tabs are visually adjacent and easy to click by accident while reaching for other controls. Like the back button, they silently destroy unsaved work today, so they must be guarded for the warning behavior to be consistent.

**Independent Test**: Open the editor, modify any field, click the "MCP Servers" (or "LLM Models" / "Conversations") tab. Expect the same in-app modal. "Keep editing" cancels the tab switch; "Discard changes" completes it.

**Acceptance Scenarios**:

1. **Given** the editor is open with unsaved changes, **When** the user clicks the MCP Servers, LLM Models, or Conversations sub-tab, **Then** the in-app modal appears and the tab does not change yet.
2. **Given** the warning modal is shown after a sub-tab click, **When** the user chooses "Keep editing", **Then** the modal closes and the user remains on the Agents tab with the editor still open and all changes intact.
3. **Given** the warning modal is shown after a sub-tab click, **When** the user chooses "Discard changes", **Then** the modal closes, the originally requested sub-tab is activated, and the editor changes are discarded.
4. **Given** the editor is open with no unsaved changes, **When** the user clicks any sub-tab, **Then** the tab switches immediately with no warning.

---

### User Story 3 - Warn when leaving the page via top-level navigation (Priority: P2)

While the editor is open with unsaved changes, the user clicks a top-level header navigation link (e.g., Home, Chat, Skills, Task Builder, Knowledge Bases, Admin, the app logo, etc.). Because navigating away from the page unmounts the editor, the system must warn the user with the same in-app modal before allowing navigation.

**Why this priority**: This path is less common than the back button or adjacent tabs, but a single misclick on the header still destroys all in-progress work. The Task Builder already implements this behavior with the same modal pattern, so extending it to the agent editor keeps the experience consistent and is straightforward to validate.

**Independent Test**: Open the editor, modify any field, click a header nav item (e.g., "Chat"). Expect the in-app modal. "Keep editing" stays on the Agents page with the editor open; "Discard changes" navigates to the chosen destination.

**Acceptance Scenarios**:

1. **Given** the editor is open with unsaved changes, **When** the user clicks any top-level header navigation link, **Then** the navigation is intercepted and the in-app modal appears.
2. **Given** the warning modal is shown after a header nav click, **When** the user chooses "Keep editing", **Then** the modal closes and the user remains on the Agents page with the editor open and changes intact.
3. **Given** the warning modal is shown after a header nav click, **When** the user chooses "Discard changes", **Then** the modal closes, the editor's unsaved-changes state is cleared, and navigation proceeds to the originally requested destination.

---

### Edge Cases

- **Field reverted to original value**: If the user modifies a field and then manually changes it back to its original value, the editor SHOULD treat the form as clean and not show the warning. (Dirty state is based on whether current values differ from the initial snapshot, not on whether any edit event has occurred.)
- **Save fails**: If the user clicks Save but the save call fails (network error, validation error from the server, etc.), the editor MUST remain in the unsaved-changes state so the warning still triggers on subsequent navigation.
- **Save succeeds**: After a successful save, the editor MUST clear unsaved-changes state. Closing the editor in the same flow MUST NOT show the warning.
- **Read-only / config-driven agents**: When the editor is opened in read-only mode (e.g., for config-driven agents), the user cannot make changes, so unsaved-changes state MUST never become true and the warning MUST NEVER appear.
- **Cloning an agent**: When opening the editor via "Clone", the form is pre-filled from the source agent and the auto-appended " (New)" suffix on the name is part of the initial snapshot. The form starts clean. The warning only appears once the user makes additional edits.
- **Multiple navigation triggers in quick succession**: If a navigation/tab/back action is already pending the modal, additional clicks on other navigation targets MUST NOT stack multiple modals. The most recent destination is the one used if the user chooses "Discard changes".
- **Browser back button / page refresh / tab close**: This feature does NOT cover the native browser back button, page refresh, or tab close. Those are explicitly out of scope (see Assumptions). The native browser "leave page?" prompt is intentionally not used.
- **Switching between wizard steps inside the editor**: Moving between wizard steps (Basic Info, Instructions, Tools, Skills, Subagents) inside the editor preserves all form state and is NOT a destructive action. No warning is shown when switching steps.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dynamic agent editor MUST track an "unsaved changes" state that becomes true whenever the current values of any user-editable form field differ from the values the editor was opened with, and becomes false otherwise.
- **FR-002**: When the user clicks the editor's back/close control AND unsaved-changes state is true, the system MUST display an in-app modal warning instead of immediately closing the editor.
- **FR-003**: When the user clicks any sibling sub-tab on the Agents page (e.g., MCP Servers, LLM Models, Conversations) AND the editor is open with unsaved changes, the system MUST intercept the tab switch and display the same in-app warning modal.
- **FR-004**: When the user clicks any top-level header navigation link AND the editor is open with unsaved changes, the system MUST intercept the navigation and display the same in-app warning modal.
- **FR-005**: The warning modal MUST clearly state that unsaved changes exist in the agent editor and will be lost if the user proceeds.
- **FR-006**: The warning modal MUST offer two clearly labeled choices: one to discard changes and proceed, and one to cancel and keep editing.
- **FR-007**: Choosing "Keep editing" MUST close the modal, leave the editor open, preserve all in-progress edits, and cancel the pending navigation/tab/back action.
- **FR-008**: Choosing "Discard changes" MUST close the modal, clear unsaved-changes state, and complete the originally requested action (close the editor, switch the tab, or navigate to the destination).
- **FR-009**: The system MUST NOT use the browser's native `beforeunload` prompt or any other native browser dialog for this warning.
- **FR-010**: When a save completes successfully, the system MUST clear unsaved-changes state before the editor closes, so that no warning is shown for the resulting close.
- **FR-011**: When a save fails, the system MUST keep unsaved-changes state set, so that the warning still triggers on subsequent navigation.
- **FR-012**: When the editor is opened in read-only mode (config-driven agents), the system MUST NOT display the warning modal under any circumstance, because the user cannot make changes.
- **FR-013**: Switching between wizard steps inside the editor (Basic Info, Instructions, Tools, Skills, Subagents) MUST NOT trigger the warning modal and MUST NOT clear in-progress form state.
- **FR-014**: The warning modal MUST be visually consistent with the existing in-app unsaved-changes modal used by the Task Builder (same component, same styling, same button placement).

### Key Entities

- **Editor unsaved-changes state**: A boolean flag tracking whether the dynamic agent editor's current form values diverge from the values it was opened with. Owned by the editor while it is mounted; cleared when the editor unmounts cleanly (after save, after explicit discard, or when opened in read-only mode).
- **Pending navigation intent**: When the user attempts a destructive action (back, tab switch, header navigation) while unsaved changes exist, the system records the intended destination so it can be completed if the user confirms "Discard changes" or abandoned if they choose "Keep editing".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of attempts to leave the dynamic agent editor with unsaved changes — via the back button, sibling sub-tabs, or top-level header navigation — show the in-app warning modal before any change is discarded.
- **SC-002**: 0% of attempts to leave the editor with no unsaved changes show the warning modal (no false positives).
- **SC-003**: After a user chooses "Keep editing" in the warning modal, 100% of in-progress field values are preserved exactly as they were before the navigation attempt.
- **SC-004**: After a successful save, 0% of subsequent close/navigation actions show the warning modal during the same editor session.
- **SC-005**: 0% of warnings about unsaved agent-editor changes use a native browser dialog; 100% use the in-app modal.
- **SC-006**: Support tickets and informal reports about "I lost my agent configuration" drop to near zero after rollout (qualitative confirmation in the first 30 days).

## Assumptions

- The existing in-app `UnsavedChangesDialog` component used by the Task Builder is reused (or generalized) for the agent editor; no new dialog visual design is introduced.
- "Unsaved changes" is defined by comparing the editor's current form values to the values it was initialized with, not by tracking individual edit events. Reverting a field back to its original value clears the dirty state for that field.
- The warning is intentionally limited to in-app navigation paths controlled by the application (back button inside the editor, sibling sub-tabs on the Agents page, and top-level header links). Native browser actions — refresh, tab close, browser back/forward — are out of scope for this feature and continue to behave as they do today.
- Wizard step navigation inside the editor is non-destructive (state is preserved across steps), so it does not need a warning.
- Read-only / config-driven agents cannot accumulate unsaved changes, so they are excluded from the warning behavior.

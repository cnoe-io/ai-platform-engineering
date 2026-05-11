# Implementation Plan: Report a Problem & Ticket Integration

**Branch**: `094-report-a-problem` (on `prebuild/fix/audit-chat-active-preserve`) | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/094-report-a-problem/spec.md`

## Summary

Add a "Report a Problem" button in the AppHeader and a "Submit & Report Issue" combo button in the FeedbackButton dialog that create Jira or GitHub tickets via the existing A2A agents. Ticket creation streams progress logs to the user in real-time (same UX pattern as AI Enhance in SkillsBuilderEditor). Feature is opt-in via separate `JIRA_TICKET_*` and `GITHUB_TICKET_*` environment variables exposed through Helm chart values.

## Technical Context

**Language/Version**: TypeScript (Next.js 16, React 19)
**Primary Dependencies**: Zustand, Radix UI Dialog, A2ASDKClient (`@a2a-js/sdk`), Framer Motion
**Storage**: N/A (stateless -- tickets created via A2A agents, no local persistence)
**Testing**: Jest + React Testing Library
**Target Platform**: Web browser (SPA)
**Project Type**: Web application (UI component of CAIPE)
**Performance Goals**: Streaming logs visible within 2s of submission
**Constraints**: Must not add ticket UI elements when providers are unconfigured; must reuse existing A2A infrastructure
**Scale/Scope**: ~6 new/modified source files, 1 config update, 1 Helm chart update

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Status | Notes |
|------|--------|-------|
| I. Specs as Source of Truth | PASS | Spec exists at `docs/docs/specs/094-report-a-problem/spec.md` |
| II. Agent-First Architecture | PASS | Tickets created via existing Jira/GitHub A2A agents through supervisor |
| III. MCP Server Pattern | PASS | Reuses existing Jira/GitHub MCP servers; no new MCP servers |
| V. A2A Protocol Compliance | PASS | Uses `A2ASDKClient.sendMessageStream()` for streaming ticket creation |
| VII. Test-First Quality Gates | PASS | Tests planned for all new components and config changes |
| IX. Security by Default | PASS | No secrets in source; env vars for config; auth required for ticket creation |
| X. Simplicity / YAGNI | PASS | Reuses existing A2ASDKClient, existing agent infrastructure; no new abstractions |

No violations. Complexity Tracking section not needed.

## Project Structure

### Documentation (this feature)

```text
specs/094-report-a-problem/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
ui/src/
├── lib/
│   ├── config.ts                              # ADD: ticketConfig fields to Config interface
│   └── ticket-client.ts                       # NEW: thin wrapper around A2ASDKClient for ticket prompts
├── components/
│   ├── layout/
│   │   └── AppHeader.tsx                      # MODIFY: add "Report a Problem" button (conditional)
│   ├── chat/
│   │   └── FeedbackButton.tsx                 # MODIFY: add "Submit & Report Issue" button
│   └── ticket/
│       └── ReportProblemDialog.tsx             # NEW: modal with input, streaming progress, result
├── components/__tests__/
│   └── ticket/
│       └── ReportProblemDialog.test.tsx        # NEW: tests for report dialog
├── components/chat/__tests__/
│   └── FeedbackButton.test.tsx                # MODIFY: add tests for combo button
└── components/layout/__tests__/
    └── AppHeader.test.tsx                     # MODIFY: add tests for report button visibility

charts/ai-platform-engineering/charts/caipe-ui/
└── values.yaml                                # ADD: JIRA_TICKET_* and GITHUB_TICKET_* env vars
```

**Structure Decision**: Frontend-only feature. A new `ReportProblemDialog` component encapsulates the modal UX (input, streaming progress, result). A thin `ticket-client.ts` module constructs the A2A prompt for ticket creation. Config changes add ticket provider fields to the existing `Config` interface. No backend API routes needed -- tickets are created client-side via the existing A2ASDKClient streaming to the supervisor agent.

## Phase 0: Research

No NEEDS CLARIFICATION items remain. All design decisions were resolved in the spec clarification session.

### Key Findings

**Decision 1: Ticket creation via A2A agents (not direct API calls)**

- Rationale: The existing Jira and GitHub agents already know how to create tickets via their MCP servers. Reusing the supervisor -> agent pipeline means zero new backend code and consistent behavior with task-builder workflows.
- The `A2ASDKClient` used in SkillsBuilderEditor's AI Enhance feature provides the exact streaming pattern needed.
- Alternative rejected: Direct Jira/GitHub API calls from a Next.js API route -- would require duplicating auth, API logic, and error handling already solved by the agents.

**Decision 2: Prompt-based ticket creation**

- The A2A prompt sent to the supervisor will instruct it to route to the Jira or GitHub agent with a structured request.
- Prompt template: `"Create a {Jira issue in project OPENSD | GitHub issue in org/repo} with the following details: Summary: {user description}. Reporter: {user email}. Context URL: {chat/page URL}."`
- The agent handles field mapping, authentication, and API calls.

**Decision 3: Single `ReportProblemDialog` component reused everywhere**

- The same dialog component is used by: (a) AppHeader button, (b) FeedbackButton combo, (c) FeedbackButton "Report a Problem" link.
- Each caller provides context props (chat URL, feedback details) to customize the ticket body.

**Decision 4: Config pattern follows existing conventions**

- New fields added to the `Config` interface: `jiraTicketEnabled`, `jiraTicketProject`, `githubTicketEnabled`, `githubTicketRepo`.
- Read from env vars `JIRA_TICKET_ENABLED`, `JIRA_TICKET_PROJECT`, `GITHUB_TICKET_ENABLED`, `GITHUB_TICKET_REPO`.
- A derived `ticketEnabled` boolean (true if either provider is enabled) controls UI visibility.

**Decision 5: Jira takes precedence when both are enabled**

- In v1, no provider selection UI. If both are configured, the prompt targets Jira.
- Future: could add a dropdown to the dialog.

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md) for entity definitions.

### Contracts

No new external APIs. The feature uses the existing A2A protocol via `A2ASDKClient.sendMessageStream()`. The "contract" is the natural language prompt sent to the supervisor agent, which routes to the appropriate ticket-creation agent.

### Component Design

#### `ReportProblemDialog` (new component)

**Props**:
- `open: boolean` -- controlled dialog state
- `onOpenChange: (open: boolean) => void` -- dialog state callback
- `chatUrl?: string` -- current chat URL if on a chat page
- `feedbackContext?: { reason: string; additionalFeedback?: string }` -- optional feedback details for combo flow

**Internal state**:
- `description: string` -- user input text
- `status: "idle" | "submitting" | "success" | "error"` -- workflow state
- `ticketResult: { id: string; url: string; provider: string } | null` -- result on success
- `debugLog: string[]` -- streaming A2A event log
- `showDebug: boolean` -- toggle for details panel

**Behavior**:
1. Idle: text input + submit button with provider label
2. Submitting: animated progress bar + "Show Details" toggle (streaming log)
3. Success: ticket ID/link + "Done" button
4. Error: error message + "Retry" / "Copy Description" buttons

#### `ticket-client.ts` (new module)

Exports `createTicketViaAgent(params)` which:
1. Reads ticket config from `getConfig()`
2. Constructs the A2A prompt with ticket details
3. Creates an `A2ASDKClient` instance and calls `sendMessageStream()`
4. Returns an async generator of `ParsedA2AEvent` for the dialog to consume
5. Extracts the ticket ID/URL from the `final_result` artifact

#### Config additions to `config.ts`

Add to `Config` interface:
```
jiraTicketEnabled: boolean;
jiraTicketProject: string | null;
githubTicketEnabled: string | null;
githubTicketRepo: string | null;
```

Add derived getter:
```
ticketEnabled: boolean; // true if either jira or github ticket is enabled
ticketProvider: 'jira' | 'github' | null; // which provider to use (jira takes precedence)
```

### Test Plan

1. **`ReportProblemDialog.test.tsx`**: renders input/submit in idle, shows streaming view on submit, displays result on success, handles errors, hides when no provider configured.
2. **`FeedbackButton.test.tsx`** (additions): "Submit & Report Issue" button visible when ticket enabled, hidden when disabled, triggers both feedback submit and ticket creation.
3. **`AppHeader.test.tsx`** (additions): "Report a Problem" button visible when ticket enabled, hidden when disabled, opens dialog on click.
4. **`config.ts`** tests: verify `jiraTicketEnabled`, `githubTicketEnabled`, `ticketEnabled` derive correctly from env vars.

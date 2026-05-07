# Data Model: Report a Problem & Ticket Integration

**Feature**: 094-report-a-problem | **Date**: 2026-03-17

## Entities

### TicketConfig

Derived from environment variables. Part of the existing `Config` interface in `ui/src/lib/config.ts`.

| Field | Type | Source Env Var | Default | Description |
|-------|------|---------------|---------|-------------|
| `jiraTicketEnabled` | `boolean` | `JIRA_TICKET_ENABLED` | `false` | Whether Jira ticket creation is available |
| `jiraTicketProject` | `string \| null` | `JIRA_TICKET_PROJECT` | `null` | Jira project key (e.g., `OPENSD`) |
| `githubTicketEnabled` | `boolean` | `GITHUB_TICKET_ENABLED` | `false` | Whether GitHub issue creation is available |
| `githubTicketRepo` | `string \| null` | `GITHUB_TICKET_REPO` | `null` | GitHub repository (e.g., `org/repo`) |

**Derived fields** (computed, not stored):

| Field | Type | Logic |
|-------|------|-------|
| `ticketEnabled` | `boolean` | `jiraTicketEnabled \|\| githubTicketEnabled` |
| `ticketProvider` | `'jira' \| 'github' \| null` | Jira takes precedence if both enabled |

### TicketRequest

Transient object constructed in `ticket-client.ts` before sending the A2A prompt. Not persisted.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `description` | `string` | Yes | User's problem description |
| `userEmail` | `string` | Yes | Reporter's email from session |
| `contextUrl` | `string` | Yes | Current page URL (chat URL if on chat page) |
| `provider` | `'jira' \| 'github'` | Yes | Target ticket provider |
| `project` | `string` | Yes | Jira project key or GitHub `org/repo` |
| `feedbackContext` | `FeedbackContext \| undefined` | No | Optional feedback details for combo flow |

### FeedbackContext

Optional context attached when creating a ticket from the feedback dialog.

| Field | Type | Description |
|-------|------|-------------|
| `reason` | `string` | Selected feedback reason (e.g., "Inaccurate", "Off-topic") |
| `additionalFeedback` | `string \| undefined` | Free-text "Other" feedback |
| `feedbackType` | `'like' \| 'dislike'` | Whether this was positive or negative feedback |

### TicketResult

Extracted from the `final_result` A2A artifact after successful ticket creation.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Ticket identifier (e.g., `OPENSD-1234`, `#42`) |
| `url` | `string` | Direct URL to the created ticket |
| `provider` | `'jira' \| 'github'` | Which provider created the ticket |

## State Transitions

### ReportProblemDialog State Machine

```
idle ──[submit]──> submitting ──[success]──> success ──[close]──> idle
                       │
                       └──[error]──> error ──[retry]──> submitting
                                       │
                                       └──[close]──> idle
```

| State | UI | User Actions |
|-------|-----|-------------|
| `idle` | Text input + submit button | Type description, submit, cancel |
| `submitting` | Progress bar + streaming log | Show/hide details, cancel |
| `success` | Ticket ID/link + done button | Close dialog |
| `error` | Error message | Retry, copy description, close |

## Relationships

```
Config (env vars)
  ├── TicketConfig (jira/github settings)
  │     └── determines: ticketEnabled, ticketProvider
  │
ReportProblemDialog
  ├── reads: TicketConfig (from Config)
  ├── builds: TicketRequest (from user input + session + URL)
  ├── calls: A2ASDKClient.sendMessageStream(prompt)
  └── extracts: TicketResult (from final_result artifact)
```

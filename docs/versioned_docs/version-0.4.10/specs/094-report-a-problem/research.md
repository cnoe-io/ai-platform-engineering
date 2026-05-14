# Research: Report a Problem & Ticket Integration

**Feature**: 094-report-a-problem | **Date**: 2026-03-17

## Research Topics

### 1. A2A Streaming for Ticket Creation

**Decision**: Reuse `A2ASDKClient.sendMessageStream()` pattern from SkillsBuilderEditor AI Enhance.

**Rationale**: The AI Enhance feature in `ui/src/components/skills/SkillsBuilderEditor.tsx` already demonstrates the full streaming UX:
- Creates an `A2ASDKClient` with endpoint, access token, and user email
- Calls `sendMessageStream(prompt)` which returns an async generator of `ParsedA2AEvent`
- Events are consumed in a `for await` loop, with each event appended to a debug log
- The `final_result` or `complete_result` artifact contains the final output
- Cancel is supported by nullifying the client ref

**Key code reference** (`SkillsBuilderEditor.tsx` lines 1535-1600):
```
const client = new A2ASDKClient({ endpoint, accessToken, userEmail });
const stream = client.sendMessageStream(prompt);
for await (const event of stream) {
  appendDebugLog(`← ${label}: ${preview}`);
  if (name === "final_result") finalContent = event.displayContent;
}
```

**Alternatives considered**:
- Direct Jira/GitHub REST API from Next.js API route: Would require duplicating auth, API logic, and error handling. No streaming. Rejected.
- WebSocket-based custom protocol: Over-engineering. A2A SSE streaming already works. Rejected.

### 2. Prompt Engineering for Ticket Creation

**Decision**: Use a structured natural language prompt that the supervisor routes to the correct agent.

**Rationale**: The existing task-builder step templates (`ui/src/components/task-builder/step-templates.ts`) show the prompt pattern:
- Jira: `"Use create_issue in project <project_key> with summary, description, and assignee."`
- GitHub: `"Use issue_write to create or update an issue in <org>/<repo>."`

For the Report a Problem feature, the prompt will be:
```
Create a Jira issue in project {PROJECT} with the following:
- Summary: {user_description}
- Description: Reporter: {email}\nContext: {url}\n{optional_feedback_context}
- Type: Bug
```

The supervisor will route this to the Jira or GitHub agent based on the mention of "Jira" or "GitHub" in the prompt.

**Alternatives considered**:
- JSON-structured request body: The A2A protocol uses natural language prompts, not structured payloads. Rejected.
- Dedicated ticket-creation endpoint: Would bypass the agent architecture. Rejected.

### 3. Config Pattern for Feature Flags

**Decision**: Follow the existing `Config` interface pattern with separate env vars per provider.

**Rationale**: The existing config system in `ui/src/lib/config.ts`:
- Server-side: `getServerConfig()` reads `process.env` via `env()` helper
- Client-side: Root layout injects config as `window.__APP_CONFIG__`
- Feature flags follow the `featureEnabled = env('FEATURE_ENABLED') === 'true'` pattern
- Examples: `auditLogsEnabled`, `npsEnabled`, `dynamicAgentsEnabled`

New env vars:
| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `JIRA_TICKET_ENABLED` | boolean | `false` | Enable Jira ticket creation |
| `JIRA_TICKET_PROJECT` | string | `null` | Jira project key (e.g., `OPENSD`) |
| `GITHUB_TICKET_ENABLED` | boolean | `false` | Enable GitHub issue creation |
| `GITHUB_TICKET_REPO` | string | `null` | GitHub repo (e.g., `org/repo`) |

**Alternatives considered**:
- Single `TICKET_PROVIDER=jira|github` env var: Less flexible, can't support both. User chose separate config.

### 4. UI Placement and Component Architecture

**Decision**: `ReportProblemDialog` is a standalone Radix Dialog component, triggered from AppHeader and FeedbackButton.

**Rationale**:
- AppHeader already uses Radix Popover and Tooltip components
- FeedbackButton was recently converted from Popover to Dialog (in this PR)
- The AI Enhance overlay uses a custom `fixed inset-0` overlay -- but for the report modal, a standard Dialog is simpler and more accessible
- The dialog handles its own streaming state (similar to AI Enhance's `aiStatus`, `aiDebugLog`, `showAiDebug`)

**Component hierarchy**:
```
AppHeader
  └── ReportProblemDialog (trigger: header button)

FeedbackButton (Dialog)
  ├── "Submit Feedback" button (existing)
  ├── "Submit & Report Issue" button (new, triggers feedback + ticket)
  └── ReportProblemDialog (trigger: "Report a Problem" link)
```

### 5. Chat URL Construction

**Decision**: Construct chat URL client-side from `window.location.origin` + current pathname.

**Rationale**:
- On chat pages, the URL is `/chat/<uuid>` -- this is the conversation's unique shareable link
- On non-chat pages, include the current page URL for context
- `usePathname()` from `next/navigation` provides the current path
- No server-side URL construction needed

**Implementation**:
```
const chatUrl = typeof window !== 'undefined'
  ? `${window.location.origin}${pathname}`
  : undefined;
```

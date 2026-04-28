# Feature Specification: Extended Middleware Registry for Dynamic Agents

**Feature Branch**: `102-dynamic-agents-middleware-ui`  
**Created**: 2026-04-28  
**Status**: Draft  

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enable Conversation Summarization (Priority: P1)

An operator configures a dynamic agent to automatically summarize its conversation history when it approaches token limits, preventing the agent from failing on long-running tasks.

**Why this priority**: Conversation summarization prevents the most common failure mode for long-running agents (context overflow). It is standalone and delivers immediate production value.

**Independent Test**: Open the dynamic agent editor, add "Conversation Summarization" middleware, select a model, save — verify the agent no longer hits token-limit errors on extended sessions.

**Acceptance Scenarios**:

1. **Given** an operator is editing a dynamic agent, **When** they open the middleware picker and click "Add", **Then** "Conversation Summarization" appears as an option with a description.
2. **Given** "Conversation Summarization" is added, **When** the editor expands its params, **Then** the operator sees: a model selector, trigger threshold (tokens or messages count), and messages-to-keep count.
3. **Given** the agent is saved with summarization enabled, **When** the agent runs a long session exceeding the trigger, **Then** older messages are summarized and replaced, allowing the session to continue.

---

### User Story 2 - Enable Human-in-the-Loop Approval (Priority: P2)

An operator requires human approval before the agent executes sensitive tool calls, preventing unintended destructive actions in production.

**Why this priority**: HITL is critical for production safety but requires knowing which tools need approval. Its value is independent of other middleware.

**Independent Test**: Add HITL middleware configured to interrupt on all tools, run a task — verify the agent pauses and waits for approval before each tool call.

**Acceptance Scenarios**:

1. **Given** an operator adds "Human-in-the-Loop" middleware, **When** they expand its params, **Then** they can configure: interrupt mode (all tools or specific tool names) and a description prefix.
2. **Given** HITL is set to "all tools", **When** the agent attempts any tool call, **Then** execution pauses and waits for human approval/edit/reject.
3. **Given** HITL is set to specific tool names, **When** the agent calls a non-listed tool, **Then** it proceeds without interruption.

---

### User Story 3 - Enable Persistent Shell Access (Priority: P3)

An operator provides the agent with a persistent shell tool so it can execute multi-step bash sequences within a single workspace directory.

**Why this priority**: Useful for DevOps and infrastructure agents, but more niche than summarization or HITL.

**Independent Test**: Add Shell middleware with a workspace root, save, run a task — verify the agent can execute shell commands that persist state across calls.

**Acceptance Scenarios**:

1. **Given** an operator adds "Shell Tool" middleware, **When** they expand its params, **Then** they can set: workspace root path and shell tool name.
2. **Given** the agent is saved with shell middleware, **When** the agent runs, **Then** it has access to a `shell` tool that maintains a persistent session.

---

### User Story 4 - Enable Filesystem Search (Priority: P4)

An operator gives the agent glob and grep search capabilities over a specific filesystem path for code analysis or document search tasks.

**Why this priority**: Useful for code-assistant agents working on a known directory structure.

**Independent Test**: Add Filesystem Search middleware with a root path, run a task asking to find files — verify the agent uses glob/grep tools and returns results from that path.

**Acceptance Scenarios**:

1. **Given** an operator adds "Filesystem File Search" middleware, **When** they expand its params, **Then** they see: root path (required), use ripgrep toggle, and max file size setting.
2. **Given** the agent is saved with filesystem search middleware, **When** the agent runs, **Then** it has `glob_search` and `grep_search` tools scoped to the configured root path.

---

### Edge Cases

- What happens when Summarization middleware is added without a model selected? The agent editor should warn and prevent saving.
- How does HITL behave when `interrupt_on` includes a tool name that doesn't exist in the agent's tool list? It should be ignored at runtime (no error).
- What happens when Shell middleware has no workspace root configured? A temporary directory should be created per-session.
- What happens when Filesystem Search has a root path that doesn't exist at runtime? The tool should return an appropriate error message.
- Can multiple instances of Summarization or HITL be added? No — these are singletons (one per agent).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The middleware registry MUST include `SummarizationMiddleware` with configurable model, trigger threshold (tokens/messages), and keep count.
- **FR-002**: The middleware registry MUST include `HumanInTheLoopMiddleware` with configurable interrupt scope (all tools or named tools) and description prefix.
- **FR-003**: The middleware registry MUST include `ShellToolMiddleware` with configurable workspace root and tool name.
- **FR-004**: The middleware registry MUST include `FilesystemFileSearchMiddleware` with configurable root path, ripgrep toggle, and max file size.
- **FR-005**: All four new middleware MUST be disabled by default (`enabled_by_default=False`) and appear in the "Add" dropdown in the middleware picker.
- **FR-006**: `SummarizationMiddleware` and `HumanInTheLoopMiddleware` MUST be singletons (one instance per agent); `ShellToolMiddleware` and `FilesystemFileSearchMiddleware` MUST also be singletons.
- **FR-007**: The middleware picker UI MUST display the new middleware with labels, descriptions, and their configurable parameters without requiring UI code changes (data-driven via existing API).
- **FR-008**: `SummarizationMiddleware` MUST use the `model_params=True` flag so the UI renders a model selector for it.
- **FR-009**: The backend API endpoint `/api/dynamic-agents/middleware` MUST return the four new middleware definitions including their `param_schema`.
- **FR-010**: Each new middleware MUST have a special-case builder function that translates flat params (from the registry/UI) into the correct constructor arguments.

### Key Entities

- **MiddlewareSpec**: Registry entry defining a middleware type — class reference, default params, enabled-by-default flag, singleton flag, label, description, param_schema.
- **MiddlewareEntry**: Per-agent middleware instance — type key, enabled flag, params dict (stored in MongoDB `FeaturesConfig`).
- **MiddlewareDefinition** (UI type): Serialized registry entry returned by the API to the frontend — excludes the class reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four new middleware appear in the dynamic agent editor's "Add" dropdown within 1 second of the page loading.
- **SC-002**: An operator can add, configure, and save any of the four new middleware in under 2 minutes without reading documentation.
- **SC-003**: Agents saved with Summarization middleware successfully complete sessions that would previously fail due to context overflow (verified by running a session exceeding the trigger threshold).
- **SC-004**: Agents saved with HITL middleware pause on every configured tool call and resume correctly after human approval (100% of configured interrupts fire correctly in test scenarios).
- **SC-005**: Zero UI code changes required — all new middleware surface through the existing data-driven `MiddlewarePicker` component.

## Assumptions

- The UI's `MiddlewarePicker` is fully data-driven and will render new middleware automatically once they appear in the registry API response — no React component changes needed.
- `HumanInTheLoopMiddleware`'s `interrupt_on` dict will be simplified to two flat params: `interrupt_all` (bool) and `tool_names` (comma-separated string) for registry compatibility.
- `SummarizationMiddleware` trigger will be simplified to `trigger_tokens` (int) and `trigger_messages` (int) so either threshold can activate it.
- All four middleware are singletons in the registry (one per agent), matching the existing pattern for complex middleware.
- The `model_params=True` flag on `SummarizationMiddleware` is sufficient for the UI to render a model selector — same pattern as `llm_tool_selector` already uses.

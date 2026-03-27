# Feature Specification: Single-Node Persistent Memory Store

**Feature Branch**: `098-single-node-memstore`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Combine deep_agent.py and deep_agent_single.py into a single implementation supporting MongoDB persistence and Redis memstore for fact extraction"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversation state persists across pod restarts (Priority: P1)

An operator deploys the single-node platform engineer agent with a persistent checkpoint backend configured. A user has a multi-turn conversation with the agent. The pod restarts (e.g., due to a rolling update). When the user reconnects with the same thread ID, the conversation state is fully restored and the agent continues from where it left off.

**Why this priority**: Without persistent checkpointing, every pod restart loses all in-flight and historical conversation state. This is the core value proposition — production-grade reliability for the single-node deployment mode.

**Independent Test**: Deploy single-node agent with a persistent checkpoint backend configured. Start a conversation, restart the pod, resume the conversation with the same thread ID. Verify state is restored.

**Acceptance Scenarios**:

1. **Given** a single-node agent with persistent checkpointing configured, **When** a user completes a multi-turn conversation and the pod restarts, **Then** resuming with the same thread ID restores the full conversation history and agent state.
2. **Given** a single-node agent with no persistence environment variables set, **When** the agent starts, **Then** it uses in-memory checkpointing (preserving current default behavior with zero configuration required).
3. **Given** a single-node agent with an unreachable persistence backend configured, **When** the agent starts, **Then** it falls back to in-memory checkpointing and logs a warning.

---

### User Story 2 - Agent remembers user preferences across conversations (Priority: P1)

A user interacts with the platform engineer agent across multiple separate conversations (different thread IDs). The agent automatically extracts key facts and preferences from each conversation (e.g., preferred cluster names, team context, infrastructure preferences) and persists them to a cross-thread store. In subsequent conversations, the agent proactively uses this remembered context to provide more personalized and efficient assistance.

**Why this priority**: Cross-thread memory is what transforms the agent from a stateless tool into a personalized assistant. It directly enables fact extraction, which is the second half of the feature request.

**Independent Test**: Configure a persistent store backend. Have a conversation where the user mentions their team name and preferred namespace. Start a new conversation — verify the agent recalls this context.

**Acceptance Scenarios**:

1. **Given** a single-node agent with a persistent store and fact extraction enabled, **When** a user mentions their team name in conversation A, **Then** in a new conversation B the agent has access to that fact without being told again.
2. **Given** a single-node agent with store configured but fact extraction disabled, **When** the agent processes a conversation, **Then** no background fact extraction occurs and the store remains empty.
3. **Given** a single-node agent with no store environment variables, **When** the agent starts, **Then** it uses an in-memory store (facts are available within the session but lost on restart).

---

### User Story 3 - Single codebase for both deployment modes (Priority: P2)

A developer maintaining the platform engineer codebase needs to add a new feature to the agent's graph construction logic. Previously, they had to update both `deep_agent.py` (multi-node) and `deep_agent_single.py` (single-node) separately. Now there is a single canonical implementation, and the old file is a thin re-export shim. The developer only needs to update one file.

**Why this priority**: Code deduplication reduces maintenance burden and eliminates the risk of the two implementations drifting apart. However, this is primarily a developer experience improvement, not a user-facing feature.

**Independent Test**: Verify that all existing import paths that reference the old module continue to resolve correctly. Run the full test suite to confirm backward compatibility.

**Acceptance Scenarios**:

1. **Given** the codebase after consolidation, **When** a module imports the main agent class from the old module path, **Then** it receives the canonical class from the single-node implementation.
2. **Given** the consolidated codebase, **When** a developer modifies graph construction logic, **Then** they only need to edit a single file.
3. **Given** existing tests that reference old module paths, **When** the test suite runs, **Then** all tests pass (with updated module paths where needed).

---

### Edge Cases

- What happens when the persistence backend is configured but the connection string is invalid? The system falls back to in-memory backends with a logged warning.
- What happens when the store backend is unreachable at startup? The system falls back to in-memory store with a logged warning.
- What happens when fact extraction is enabled but no store backend is configured? Fact extraction uses the in-memory store; facts are available within the session but lost on restart.
- What happens when a user has no email address (anonymous access)? Cross-thread memory retrieval and fact extraction are skipped (they require a user identifier for namespace scoping).
- What happens when the pod restarts mid-fact-extraction? The background task is cancelled; no partial data is persisted. The next conversation triggers fresh extraction.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The single-node agent MUST support configurable checkpoint persistence via the `LANGGRAPH_CHECKPOINT_TYPE` environment variable (memory, redis, postgres, mongodb).
- **FR-002**: The single-node agent MUST support a configurable cross-thread store via the `LANGGRAPH_STORE_TYPE` environment variable (memory, redis, postgres, mongodb).
- **FR-003**: When no persistence environment variables are set, the system MUST default to in-memory checkpointing and in-memory store, preserving identical behavior to the current implementation.
- **FR-004**: The single-node A2A binding MUST perform background fact extraction after each agent response when `ENABLE_FACT_EXTRACTION=true` and a store is available.
- **FR-005**: The single-node A2A binding MUST retrieve cross-thread memory context for new conversations when a store and user identifier are available.
- **FR-006**: The old multi-node agent file MUST be replaced with a backward-compatible re-export shim that delegates all imports to the single-node implementation.
- **FR-007**: All existing import paths that reference the old module symbols MUST continue to resolve correctly after consolidation.
- **FR-008**: Persistence backend failures (unreachable database, invalid connection string) MUST result in graceful fallback to in-memory backends with appropriate warning logs.
- **FR-009**: Fact extraction MUST run as a non-blocking background task with zero impact on response latency.
- **FR-010**: The cross-thread store MUST use the authenticated user's email as the namespace identifier for memory scoping.

### Key Entities

- **Checkpoint**: Serialized conversation state (messages, tool call history, agent state) persisted per thread ID. Enables conversation resumption across restarts.
- **Cross-Thread Store**: Key-value store namespaced by user identifier. Holds extracted facts, conversation summaries, and user preferences that span multiple conversation threads.
- **Fact**: A structured piece of information extracted from conversation history (e.g., user preferences, infrastructure details, team context) that is useful in future conversations.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Single-node agent conversations survive pod restarts with zero data loss when a persistent checkpoint backend is configured.
- **SC-002**: The agent recalls user-specific context from prior conversations in new threads within 2 seconds of conversation start.
- **SC-003**: Background fact extraction completes without adding latency to the user-facing response stream (less than 50ms additional response time).
- **SC-004**: All existing tests pass after consolidation with no changes to test assertions (only module path updates if needed).
- **SC-005**: Operators can switch between persistence backends by changing only environment variables — no code changes or redeployment required.
- **SC-006**: When no persistence is configured, the system behaves identically to the pre-change implementation (zero behavioral regression).

## Assumptions

- The existing checkpoint and store factory functions are production-ready and fully tested for all supported backends.
- The fact extraction library is an optional dependency — the system degrades gracefully when it is not installed.
- The single-node deployment always has a user email available in the A2A binding when authentication is enabled.
- Persistence infrastructure provisioning (database servers, connection strings) is out of scope — operators are responsible for providing configuration via environment variables.
- The multi-node deployment mode continues to work unchanged through the re-export shim.

## Dependencies

- Existing persistence utilities in the utils directory (checkpointer factory, store factory)
- Existing fact extraction module in the agent memory utilities
- External packages for persistence backends (all optional, with graceful fallback when not installed)

## Scope

### In Scope

- Wiring persistent checkpointer and store factories into the single-node agent graph builder
- Adding cross-thread memory retrieval and fact extraction to the single-node A2A binding
- Converting the old multi-node agent file to a re-export shim
- Updating affected test module paths

### Out of Scope

- Changes to the persistence factory functions themselves
- New persistence backends beyond those already implemented
- Changes to the multi-node A2A binding
- Database infrastructure provisioning or Helm chart changes
- UI changes to surface persisted memories to users

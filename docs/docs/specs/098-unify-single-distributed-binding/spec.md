# Feature Specification: Unify Single-Node (All-in-One) and Distributed A2A Binding Layer

**Feature Branch**: `098-unify-single-distributed-binding`  
**Created**: 2026-04-08  
**Status**: Implemented (per-agent distribution in progress)  
**Input**: Unify the single-node (all-in-one) and distributed supervisor deployment modes into a single codebase, eliminating parallel file implementations. Add per-agent distribution control via `DISTRIBUTED_AGENTS`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Single Codebase for All Deployments (Priority: P1)

As a platform engineer deploying the AI Platform Engineering supervisor, I want a single set of source files that works for both single-node (all-in-one) and distributed (remote A2A agents) modes, so that I don't have to maintain or reason about two parallel implementations.

**Why this priority**: Eliminates ~4,700 lines of duplicated code across 4 parallel file pairs. Reduces the risk of behavioral drift where fixes applied to one mode are missed in the other (as was the case with "task→task" notifications and missing execution plans).

**Independent Test**: Deploy the supervisor with `DISTRIBUTED_MODE=false` (single-node / all-in-one) and verify subagents load MCP tools in-process. Then deploy with `DISTRIBUTED_MODE=true` and verify subagents connect to remote A2A containers. Both should stream execution plans, correct tool notifications, and HITL forms.

**Acceptance Scenarios**:

1. **Given** a supervisor deployed with `DISTRIBUTED_MODE=false`, **When** a user asks "list my Jira tickets", **Then** the Jira subagent loads MCP tools in-process and returns results with proper "jira" tool notifications (not "task→task").
2. **Given** a supervisor deployed with `DISTRIBUTED_MODE=true`, **When** a user asks "list my Jira tickets", **Then** the Jira subagent connects to the remote A2A Jira container and returns results with proper "jira" tool notifications.
3. **Given** either deployment mode, **When** the supervisor starts a multi-step task, **Then** the `write_todos` execution plan is displayed to the user with agent-tagged steps (e.g., `[Jira] Search for tickets`).

---

### User Story 5 - Per-Agent Distribution Control (Priority: P2)

As a platform engineer, I want to choose which specific agents run as remote A2A containers and which run in-process, so that I can progressively migrate agents to distributed mode without an all-or-nothing switch.

**Why this priority**: The binary `DISTRIBUTED_MODE` toggle is too coarse. In practice, some agents (e.g., ArgoCD managing 800+ applications) benefit from running in their own container with dedicated memory, while lightweight agents (e.g., Jira, GitHub) can run in-process to reduce infrastructure cost and latency.

**Design**: A single comma-separated env var `DISTRIBUTED_AGENTS` lists agents that should run as remote A2A subagents. All other enabled agents load MCP tools in-process. The special value `all` distributes every agent (equivalent to the legacy `DISTRIBUTED_MODE=true`).

```
# Only ArgoCD and AWS run remotely; Jira, GitHub, etc. run in-process
DISTRIBUTED_AGENTS=argocd,aws

# All agents distributed (same as legacy DISTRIBUTED_MODE=true)
DISTRIBUTED_AGENTS=all

# All agents in-process (default when unset)
# DISTRIBUTED_AGENTS=
```

**Backward compatibility**: `DISTRIBUTED_MODE=true` is treated as `DISTRIBUTED_AGENTS=all`. If both are set, `DISTRIBUTED_AGENTS` takes precedence (more specific wins).

**Independent Test**: Set `DISTRIBUTED_AGENTS=argocd` and verify ArgoCD connects via remote A2A while Jira loads MCP tools in-process, within the same supervisor instance.

**Acceptance Scenarios**:

1. **Given** `DISTRIBUTED_AGENTS=argocd`, **When** the supervisor initializes, **Then** ArgoCD is created as a remote A2A subagent and Jira/GitHub/etc. load MCP tools in-process.
2. **Given** `DISTRIBUTED_AGENTS=all`, **When** the supervisor initializes, **Then** all agents are created as remote A2A subagents (same behavior as `DISTRIBUTED_MODE=true`).
3. **Given** `DISTRIBUTED_AGENTS` is unset and `DISTRIBUTED_MODE` is unset, **When** the supervisor initializes, **Then** all agents load MCP tools in-process (fully single-node / all-in-one).
4. **Given** `DISTRIBUTED_AGENTS=argocd` and `ENABLE_ARGOCD=false`, **When** the supervisor initializes, **Then** ArgoCD is skipped entirely (enable/disable takes precedence over distribution mode).

---

### User Story 2 - Correct Tool Notifications in All Modes (Priority: P1)

As a user interacting with the platform via Slack or the web UI, I want to see which specific agent is handling my request (e.g., "Calling Agent Jira...") instead of generic "task→task" labels, so that I understand what's happening.

**Why this priority**: This was the original bug that motivated the unification. The distributed binding (`agent.py`) displayed "task→task" while the single-node (all-in-one) binding (`agent_single.py`) correctly extracted `subagent_type` from the `task()` tool call arguments.

**Independent Test**: Send a multi-agent query and verify tool notification text contains the actual subagent name, not "task".

**Acceptance Scenarios**:

1. **Given** a user asks to compare Jira and GitHub issues, **When** the supervisor delegates to subagents, **Then** streaming notifications show "Calling Agent Jira..." and "Calling Agent Github..." (not "Calling Agent Task...").
2. **Given** a `task()` tool call with `subagent_type: "github"` in its arguments, **When** the binding processes the tool call, **Then** it extracts "github" from the arguments and uses it as the `source_agent` in the notification artifact.

---

### User Story 3 - HITL Form Support Across All Modes (Priority: P2)

As a user invoking a self-service workflow (e.g., "Create GitHub Repo"), I want the system to present a Human-in-the-Loop input form so I can provide required parameters, regardless of whether the supervisor is running in single-node (all-in-one) or distributed mode.

**Why this priority**: HITL/interrupt support was only implemented in the single-node (all-in-one) binding. Distributed deployments lacked `GraphInterrupt` handling, `Command` resume, and form-based user input.

**Independent Test**: Invoke a self-service workflow and verify the HITL form is presented, user can submit values, and the workflow resumes with submitted data.

**Acceptance Scenarios**:

1. **Given** a user invokes the "Create GitHub Repo" workflow, **When** the CAIPE subagent needs input, **Then** a structured form (CAIPEAgentResponse) is presented to the user via the A2A `input_required` state.
2. **Given** the user submits form values via A2A DataPart resume, **When** the executor receives the resume command, **Then** it constructs a `Command` and the graph resumes from the interrupt point.

---

### User Story 4 - Skills Middleware Available in Unified Deployment (Priority: P3)

As a platform administrator, I want the skills middleware REST API to be available alongside the A2A routes in both deployment modes, so that skill catalog management works regardless of how the supervisor is deployed.

**Why this priority**: The skills router mount was only in the distributed `main.py`. Single-node (all-in-one) `main_single.py` didn't mount it.

**Independent Test**: After starting the supervisor, call the skills middleware endpoints and verify they respond.

**Acceptance Scenarios**:

1. **Given** the unified `main.py`, **When** the server starts, **Then** the skills middleware router is mounted at `/` after A2A routes.
2. **Given** a request to a skills endpoint, **When** it doesn't match any A2A route, **Then** it falls through to the skills middleware FastAPI sub-app.

---

### Edge Cases

- What happens when `DISTRIBUTED_MODE=true` but a remote agent container is unreachable? The system creates the remote A2A subagent definition anyway; the `A2ARemoteAgentConnectTool` fetches the agent card on first use and surfaces the connection error to the LLM.
- What happens when an agent's MCP server fails to load tools in single-node (all-in-one) mode? The subagent is created with an empty tool list and a warning is logged. The LLM will be informed the subagent has no domain tools.
- What happens when `LANGGRAPH_DEV` environment variable is set? The checkpointer attachment is skipped, allowing LangGraph Studio to manage its own checkpointer.
- What happens when `DISTRIBUTED_AGENTS=argocd` but `ENABLE_ARGOCD=false`? ArgoCD is skipped entirely. The `ENABLE_*` flags are evaluated first; only enabled agents are considered for distribution mode selection.
- What happens when both `DISTRIBUTED_MODE=true` and `DISTRIBUTED_AGENTS=argocd` are set? `DISTRIBUTED_AGENTS` takes precedence (more specific wins), so only ArgoCD runs remotely.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support both single-node (all-in-one, in-process MCP tools) and distributed (remote A2A agents) modes using the same source files, toggled by `DISTRIBUTED_MODE` or `DISTRIBUTED_AGENTS` environment variables.
- **FR-013**: The system MUST support per-agent distribution via `DISTRIBUTED_AGENTS` (comma-separated list of agent names). Agents in the list run as remote A2A subagents; all others load MCP tools in-process. The value `all` distributes every agent.
- **FR-014**: `DISTRIBUTED_MODE=true` MUST be treated as `DISTRIBUTED_AGENTS=all` for backward compatibility. If both are set, `DISTRIBUTED_AGENTS` takes precedence.
- **FR-002**: The system MUST eliminate all `_single` variant files (`deep_agent_single.py`, `agent_single.py`, `agent_executor_single.py`, `main_single.py`) by merging their logic into the original filenames (`deep_agent.py`, `agent.py`, `agent_executor.py`, `main.py`).
- **FR-003**: The system MUST correctly extract the actual subagent name from `task()` tool calls (via `args.subagent_type`) for tool notification display, instead of showing the generic "task" tool name.
- **FR-004**: The system MUST support `GraphInterrupt` handling and `Command`-based resume for HITL workflows in both deployment modes.
- **FR-005**: The system MUST use Bedrock-compatible tool call ID extraction (`_extract_tool_call_ids`) in orphaned tool call repair, checking `tool_calls`, `additional_kwargs`, and content blocks.
- **FR-006**: The system MUST register the MAS instance with the skills middleware registry (`set_mas_instance`) during binding initialization.
- **FR-007**: The system MUST attempt persistent checkpointer/store backends (MongoDB, Redis) in both modes, falling back to `InMemorySaver` when unavailable.
- **FR-008**: The system MUST include `trace_id` in completion status metadata and final result artifacts for client-side feedback/scoring.
- **FR-009**: The system MUST mount the skills middleware REST API alongside A2A routes in the unified entry point.
- **FR-010**: The system MUST use lazy imports for agent classes in `deep_agent.py` to avoid requiring agent-specific PYTHONPATH at module import time (test compatibility).
- **FR-011**: Both the `platform-engineer` and `platform-engineer-single` CLI commands MUST point to the same unified `main:app` entry point.
- **FR-012**: The system MUST update all internal imports and external references from `_single` module paths to the original module paths.

### Key Entities

- **`PlatformEngineerDeepAgent` (alias `AIPlatformEngineerMAS`)**: The multi-agent system definition. Uses `DISTRIBUTED_AGENTS` (or legacy `DISTRIBUTED_MODE`) to determine per-agent distribution mode. Each agent is independently routed to in-process MCP or remote A2A based on the list.
- **`AIPlatformEngineerA2ABinding`**: The A2A protocol binding that translates LangGraph events to A2A streaming artifacts. Handles `task()` subagent resolution, execution plan tracking, and HITL interrupts.
- **`AIPlatformEngineerA2AExecutor`**: The A2A executor that manages task lifecycle (streaming, completion, error, user-input-required). Wraps `StreamState` for artifact dedup and trace propagation.
- **`StreamState`**: Dataclass tracking streaming state per request, including content accumulation, artifact IDs, sub-agent completion count, and trace ID.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Only one file per layer exists after unification (4 files total instead of 8), with zero `_single` variant files remaining in the codebase.
- **SC-002**: All existing synchronous tests pass without modification (async test failures due to missing `pytest-asyncio` dependency are pre-existing and not caused by unification).
- **SC-003**: Tool notifications in the Slack and web UI display the correct subagent name (e.g., "jira", "github") instead of "task" for 100% of delegated tool calls.
- **SC-004**: HITL forms are correctly presented and resume works for self-service workflows in both single-node (all-in-one) and distributed modes.
- **SC-005**: The supervisor starts successfully in both `DISTRIBUTED_MODE=true` and `DISTRIBUTED_MODE=false` configurations using the same Docker image and entry point.
- **SC-006**: All import paths that previously referenced `_single` modules continue to work (either via the unified file or because no external consumers existed).
- **SC-007**: Setting `DISTRIBUTED_AGENTS=argocd` results in ArgoCD running as a remote A2A subagent while all other enabled agents load MCP tools in-process within the same supervisor process.
- **SC-008**: Setting `DISTRIBUTED_AGENTS=all` produces identical behavior to the legacy `DISTRIBUTED_MODE=true`.

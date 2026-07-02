# User Memory Design Plan

## Goal

Add a generic memory and preference system for CAIPE users and custom agents.
The system should support user-wide preferences, agent-specific preferences,
and use-case-specific context memory such as pod meeting preferences, without
hardcoding project or pod concepts into the platform.

## Core Model

Store memories in a generic MongoDB collection, for example `user_memories`.

Each memory record should include:

```json
{
  "memory_id": "mem_<id>",
  "owner_user_id": "user@example.com",
  "scope": "global | agent | context",
  "agent_id": "agent-sunny-webex-meeting-test",
  "context_namespace": "pod_meeting",
  "context_type": "pod",
  "context_id": "important-team-2",
  "category": "preference | instruction | fact | formatting",
  "key": "meeting_writeup_style",
  "normalized_key": "meeting_writeup_style",
  "value": "Prefers concise bullets with action items first.",
  "enabled": true,
  "source": "user | agent",
  "created_by_agent_id": "agent-sunny-webex-meeting-test",
  "created_at": "2026-05-28T00:00:00Z",
  "updated_at": "2026-05-28T00:00:00Z"
}
```

Scope-specific fields are optional unless required by the selected scope:

- `agent_id` is required for `scope: "agent"` and optional otherwise.
- `context_namespace`, `context_type`, and `context_id` are required for
  `scope: "context"` and should be omitted or null otherwise.
- `created_by_agent_id` is present when the memory was created or updated by an
  agent, and optional for user-created memory.

`context_namespace` identifies the product/domain/plugin that owns the context,
such as `pod_meeting`, `github`, or `jira`.

`context_type` identifies the object type inside that namespace, such as `pod`,
`repo`, `project`, or `ticket`.

Examples:

```json
{
  "scope": "context",
  "context_namespace": "pod_meeting",
  "context_type": "pod",
  "context_id": "important-team-2"
}
```

```json
{
  "scope": "context",
  "context_namespace": "github",
  "context_type": "repo",
  "context_id": "org/repo"
}
```

## Storage Guidance

Keep pod meeting memory in the generic memory collection, not embedded in the
pod registry document.

The pod registry should remain the source of durable pod facts:

- roster
- Webex room id
- Confluence parent id
- templates
- default meeting series

The memory collection should store user or context preferences:

- "For this pod, put action items first."
- "For this user, keep writeups concise."
- "For this agent, default to bullets over prose."

This keeps memory reusable for future use cases beyond pod meetings.

## Identity and Trust

Do not let the agent pass `owner_user_id` in memory tool arguments.

Use the same trusted identity path as the existing `user_info` tool:

1. The UI gateway authenticates the user.
2. The gateway sends trusted `X-User-Context` to Dynamic Agents.
3. Dynamic Agents parses that into `UserContext`.
4. Dynamic Agents builds memory tools by closing over trusted runtime metadata:
   - `UserContext.email`
   - current `agent_id`
   - optionally `conversation_id`
   - optionally `client_context`
5. The memory tool implementation derives `owner_user_id` from trusted runtime
   metadata, not from model-supplied tool arguments.
6. The agent never controls `owner_user_id` or the current `agent_id`.

Memory tools should not be registered if trusted user context is missing.

## Built-In Tool Shape

Implement memory as a Dynamic Agents built-in tool group backed by a shared,
generic Mongo memory store.

This should be a platform-provided runtime capability like `user_info`,
`current_datetime`, or `request_user_input`, not logic inside individual custom
agents and not a standalone MCP server in v1.

Agent configs should opt in with:

```yaml
builtin_tools:
  memory:
    enabled: true
    context_providers:
      - server: pod_meeting
        tool: get_pod
        context_namespace: pod_meeting
        context_type: pod
        context_id_arg: pod_id
        display_name_result_path: name
```

The memory store should be factored into a reusable service/module so it can be
exposed through a standalone Memory MCP later if needed, but v1 should register
memory through the Dynamic Agents runtime.

Tool arguments should omit `owner_user_id`.

Initial tool surface:

```text
remember(scope, category, value, key?, context_namespace?, context_type?, context_id?)
recall_memory(query?, scope?, context_namespace?, context_type?, context_id?)
list_memories(scope?, context_namespace?, context_type?, context_id?)
update_memory(memory_id, value?, category?, key?, enabled?)
forget_memory(memory_id)
```

The Dynamic Agents runtime is responsible for:

- constructing built-in memory tools with trusted user and agent metadata
- enforcing the chat memory toggle
- automatic memory retrieval and prompt injection
- deciding which memory tools are registered for a given chat request

The memory store/service module is responsible for:

- Mongo CRUD
- indexes and duplicate prevention
- scope validation
- value length limits
- recall/search
- returning compact memory records

The UI is responsible for:

- manual memory editing
- enable/disable controls
- visibility into provenance
- chat-level memory toggle

## Global Memory Confirmation

Require explicit user confirmation before saving broad/global memory.

Examples that should require confirmation:

- "Remember globally that I prefer all answers in bullet points."
- "Remember across agents that my timezone is America/Los_Angeles."

Agent or context-scoped memory can be less strict, but should still be visible
and editable. The tool should avoid saving transient task details or uncertain
inferences.

V1 decision:

- Global memory requires explicit user confirmation.
- Agent-scoped and context-scoped memory can be created by the agent without
  a confirmation step.
- Agent-created non-global changes must be auditable in the UI.
- The memory tool should return changed memory IDs so the chat UI can show a
  clickable "Memory updated" tag after the assistant response.

## Memory Toggle

Add a chat-level memory toggle.

V1 strict behavior:

- If memory is on:
  - retrieve and inject relevant memory
  - register built-in memory tools
- If memory is off:
  - do not retrieve or inject memory
  - do not register built-in memory tools for that run

This should be enforced in the Dynamic Agents runtime, not via prompt text.
If the memory tools are not registered, the agent cannot call them.

Future improvement:

- Add a one-shot "use memory for this request" affordance.
- This would temporarily enable memory retrieval for one turn while the chat's
  default memory setting remains off.
- For one-shot mode, consider enabling recall/list but keeping remember disabled
  unless the user explicitly asks to save something.

## Injection Strategy

Do not inject raw Mongo documents.

Retrieve relevant enabled memories and format them into a compact prompt block.
The block should be inserted after the agent's system prompt and before chat
history/current user input.

There is no special LangChain "memory" role. Represent memory as an additional
system/context message or as appended system-context text.

Example injected block:

```text
Relevant memory:
User preferences:
- Prefers concise bullets with action items first.
- Uses America/Los_Angeles unless stated otherwise.

Pod meeting preferences for important-team-2:
- Include open action items near the top of agenda drafts.
```

The injected block should explicitly say these are user preferences/context,
not higher-priority instructions. The agent system prompt still wins.

## Formatting Rules

The backend should deterministically format memory, not ask the agent to decide.

Rules:

- If there are multiple categories, group by category.
- If there are context-scoped memories, label the context group.
- If there is only one generic memory, inject only the value with minimal
  ceremony.
- Never include internal fields such as `memory_id`, `key`, `created_by_agent_id`,
  or timestamps in the prompt.
- Use a small allowlist of display labels:
  - User preferences
  - Agent preferences
  - Context preferences
  - Standing instructions
  - Facts
  - Formatting preferences

The database can keep `category` and `key` for storage, UI, and deduplication,
but the prompt should usually include only the compact value.

## Retrieval Scope

For each agent run, retrieve enabled memories in layered scope order:

1. Global user memory
2. Current user plus current agent memory
3. Current user plus current context memory, if a context is known

For pod meeting scheduled runs, when `pod_id` is known, retrieve:

- user global memory
- current scheduler or runner agent memory
- `pod_meeting/pod/<pod_id>` context memory

Specific memories should override broad memories when they conflict.

Context memory should not be loaded at namespace level alone. The useful unit is
`context_namespace + context_type + context_id`, for example
`pod_meeting/pod/important-team-2`.

## Context Provider Tools

Use configured tool calls to discover context memory generically.

Some tools return or validate a domain object. Those tools can be declared as
memory context providers. When the agent calls one successfully, Dynamic Agents
can derive the active memory context from trusted tool-call arguments and tool
results.

Example for pod meetings:

```yaml
builtin_tools:
  memory:
    enabled: true
    context_providers:
      - server: pod_meeting
        tool: get_pod
        context_namespace: pod_meeting
        context_type: pod
        context_id_arg: pod_id
        display_name_result_path: name
```

Flow:

1. The user asks about `important-team-2`.
2. The agent calls `get_pod(pod_id="important-team-2")`.
3. Dynamic Agents sees that `get_pod` is a memory context provider.
4. Dynamic Agents derives the context:
   `pod_meeting/pod/important-team-2`.
5. Dynamic Agents retrieves enabled memories for:
   - current user global memory
   - current user plus current agent memory
   - current user plus `pod_meeting/pod/important-team-2` memory
6. Dynamic Agents appends the relevant context memory to the tool result shown
   to the model.
7. Dynamic Agents records the active context on the conversation so later turns
   can inject the same context memory without rediscovering it.

This keeps the platform generic. Another use case could configure a GitHub repo
lookup tool as:

```yaml
context_namespace: github
context_type: repo
context_id_arg: repo
```

V1 should not try to infer context from arbitrary chat text or arbitrary tool
calls. Only configured context-provider tools activate context memory.

Scheduled jobs should follow the same rule. If the pod meeting prep/writeup run
calls `get_pod`, the runtime can attach `pod_meeting/pod/<pod_id>` memory to the
run without hardcoding pod concepts into the memory system.

## Recall Tool

Add `recall_memory` even if automatic injection exists.

Use cases:

- the agent discovers `pod_id` later in the chat
- the context window gets long
- the user references "my usual preference"
- automatic retrieval missed something

If the chat memory toggle is off, `recall_memory` should not be registered or
should return a memory-disabled response, depending on implementation.

For v1, recall should use structured filters plus simple text matching over
memory values and keys. Do not add vector search in the minimal implementation.
Future versions can use the existing RAG stack or a dedicated vector index if
memory volume and fuzzy lookup needs justify it.

## Duplicate and Growth Controls

Risks:

- near-duplicate keys
- too many memories per user
- agents saving transient facts
- prompt bloat

Controls:

- unique index on owner plus normalized scope plus `normalized_key`
- upsert by normalized key where possible
- caps per scope, such as:
  - max global memories per user
  - max agent memories per user-agent
  - max context memories per user-context
- max injected memories per run
- max injected characters per run
- max value length
- require explicit confirmation for global memory
- visible UI edit/delete/enable-disable controls

Suggested unique index shape:

```text
owner_user_id,
scope,
agent_id,
context_namespace,
context_type,
context_id,
normalized_key
```

## UI Plan

Add a user-facing memory management UI.

Minimum useful surfaces:

- global user memories
- memories for the current agent
- memories for the current context, when known
- edit value/category/key
- enable/disable
- delete
- provenance display: user-created or agent-created

Add a chat memory toggle near the chat input or chat settings.

For v1, strict off means no injection and no memory tools.

When a memory tool changes memory during a chat response, show a small clickable
tag below the assistant message:

```text
Memory updated
```

or:

```text
3 memories updated
```

Clicking the tag should open the memory panel filtered to the changed memory
records. This gives visibility without making the chat transcript noisy.

## Pod Meeting Examples

User-level memory:

```text
scope: global
value: Prefers concise meeting writeups with action items first.
```

Agent memory:

```text
scope: agent
agent_id: agent-sunny-webex-meeting-test
value: When scheduling pod meeting prep, include the lead time in display attributes.
```

Pod context memory:

```text
scope: context
context_namespace: pod_meeting
context_type: pod
context_id: important-team-2
value: For this pod, put risks before roadmap items in agenda drafts.
```

Injected memory for a scheduled prep run:

```text
Relevant memory:
User preferences:
- Prefers concise meeting writeups with action items first.

Pod meeting preferences for important-team-2:
- For this pod, put risks before roadmap items in agenda drafts.
```

The pod meeting use case should get context memory through the same configured
context-provider path as normal chats. For example, the agent or scheduled run
calls `get_pod(pod_id="important-team-2")`, and that call activates
`pod_meeting/pod/important-team-2` memory for the current run.

## V1 Decisions

- Implement memory as Dynamic Agents built-in tools backed by Mongo, not as a
  standalone MCP server in v1.
- Use trusted runtime `UserContext` for `owner_user_id`; the agent never sends
  or controls user identity.
- Require confirmation for global memory writes.
- Do not require confirmation for agent-scoped or context-scoped memory writes.
- Show a clickable "Memory updated" tag after assistant responses that changed
  memory.
- Do not implement vector search in v1.
- Use configured context-provider tools, such as `get_pod`, to activate context
  memory.
- Do not infer context memory from arbitrary text or arbitrary tool calls in v1.
- Do not pass memory to subagents by default. The main agent can pass relevant
  memory explicitly in the delegation prompt if needed.

## Later Improvements

- One-shot "use memory for this request" when the chat memory toggle is off.
- Vector or RAG-backed recall if simple filtering becomes insufficient.
- A standalone Memory MCP using the same store/service module if other runtimes
  need access outside Dynamic Agents.
- Optional subagent memory policy, such as `inherit`, `filtered`, or `none`,
  with `none` remaining the safe default.

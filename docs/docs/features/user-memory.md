---
sidebar_position: 2
---

# User Memory

User Memory gives a Dynamic Agent durable Markdown notes that carry across
conversations. Memory belongs to the signed-in user, is separate from chat
history, and is opt-in for each agent.

:::info Private global memory
Global memory is available to the current user's memory-enabled agents. It is
never shared with another user, team, or organization.
:::

## Memory scopes

| Scope | Applies to | File |
| --- | --- | --- |
| `global` | All memory-enabled agents used by one user | `/memories/global/AGENTS.md` |
| `agent` | One user and one Dynamic Agent | `/memories/agents/<agent-id>/AGENTS.md` |
| `namespace` | One working context selected for a conversation | `/memories/namespaces/<key>/AGENTS.md` |

A chat always mounts global and current-agent memory. It mounts one namespace
file only when the conversation was created with a namespace. The namespace is
immutable: start a new chat to work in another context.

## Using memory in chat

The **Memory** control appears beside the composer when the agent enables
memory. You can turn memory on or off until the first user message. After that,
the setting is locked for the conversation.

If the agent declares working contexts, a namespace picker also appears. A tool
result such as a pod record may offer **Work on this pod**. Selecting it opens a
new scoped chat with:

- the selected namespace;
- a link to the previous conversation; and
- the selected record as opening context.

Previous messages are not copied. Ignoring the button leaves the current chat
unscoped and usable.

The agent reads and maintains memory with the standard `read_file`, `edit_file`,
and `grep` tools. There are no separate remember, recall, update, list, or forget
tools. Transcript badges show when memory was injected or changed.

## Manage Memory

Select the book icon beside the composer to open **Manage Memory**. The rail
separates files active in this chat from other agent and namespace files owned
by the user.

- **Memories** shows parsed `## Heading` records and whether each was added by the
  user or the agent.
- **Edit** changes one record by its hidden ID using required title and body
  fields. The title can change without changing the record's identity.
- **Source** shows the complete `AGENTS.md` read-only, with Copy and Download.
  Raw source cannot be saved or overwritten from the UI or API.
- **Add memory** requires a unique title and body without exposing bookkeeping
  markers. A conflicting title offers Edit existing instead of silently
  merging records.
- **Clear** resets a mounted file to its visible empty stub.
- **Delete** removes an unmounted file.

If the agent changes a file during a structured edit, the dialog keeps the
fields and asks the user to reload before retrying. A file is limited to 8,000
characters. Existing over-budget files remain readable but must be pruned
before they can grow.

Deleting is the only removal mechanism. Records no longer have a category or
an enabled/disabled state.

## Enabling memory for an agent

```yaml
builtin_tools:
  memory:
    enabled: true
    namespaces:
      - key: payments
        label: Payments
    allow_custom: false
```

Namespaces can also come from an MCP list tool:

```yaml
builtin_tools:
  memory:
    enabled: true
    namespace_source:
      server: pod_meeting
      tool: list_pods
      args:
        reason: populate memory namespace picker
      key_path: pods[].pod_id
      label_path: pods[].pod_name
    namespace_scoped_tools:
      - server: pod_meeting
        tools: [resolve_owners, do_final_task_check]
        bind_arg: pod_id
        require_namespace: true
```

The namespace-source tool runs as the current user, so its own authorization
decides which keys appear. At conversation creation CAIPE validates the key
again. For a bound tool, CAIPE removes `bind_arg` from the model-visible schema
and injects the validated conversation namespace. The model cannot redirect the
tool to a different namespace.

The agent editor provides a wizard to select the source tool, sample its
response, choose key and label fields, and confirm suggested bindings.

## Storage, retention, and privacy

Memory files are stored in the dedicated `agent_memory` GridFS bucket under the
two-part namespace `(Keycloak sub, "memory")`. They have no TTL. Ordinary agent
files remain in the separate `agent_files` bucket and retain their configured
TTL.

Memory text is sent to the configured model provider when mounted. Do not save
passwords, tokens, API keys, regulated secrets, or data the model provider must
not receive.

## Troubleshooting

**No Memory control:** the agent does not enable `builtin_tools.memory`.

**Namespace list unavailable:** the configured MCP is unreachable or the user
cannot call its source tool. Choosing no namespace still starts a chat.

**Namespace cannot be changed:** this is intentional after conversation
creation. Start a new chat or use a **Work on this…** action.

**Save conflict:** reload the agent's latest version, then retry the structured
Add, Edit, or Delete operation.

See [User Memory Architecture](../architecture/user-memory-design) for storage,
permissions, concurrency, and request flow.

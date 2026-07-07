---
sidebar_position: 2
---

# Workflows

Workflows chain dynamic agents into repeatable, multi-step automations. Each step selects an agent, renders a prompt, streams the agent run, and stores the result before the next step starts.

## What Workflows Provide

- Visual builder in the CAIPE web UI at `/workflows`
- MongoDB-backed workflow definitions in `workflow_configs`
- MongoDB-backed run history, step state, events, and artifacts in `workflow_runs`
- Agent execution through the Dynamic Agents streaming API
- RBAC-managed `private`, `team`, and `global` workflow visibility
- Config-driven bootstrap through `appConfig.workflow_configs`

## Workflow Steps

Each step defines:

| Field | Purpose |
|-------|---------|
| `display_text` | Human-readable step label |
| `agent_id` | Dynamic agent that runs the step |
| `prompt` | Jinja2 template rendered at execution time |
| `on_error` | Step policy: `abort`, `skip`, or `retry` |
| `retry.max_attempts` | Retry count when `on_error` is `retry` |
| `config_override` | Optional per-step dynamic-agent override |

Prompt templates can reference:

- `{{ previous_output }}` — output from the previous completed step
- `{{ steps[0].output }}` — output from a specific earlier step
- `{{ user_context }}` — context submitted when the workflow run starts

## Running Workflows

The workflow engine:

1. Loads the workflow config from MongoDB.
2. Creates a run record and step timeline.
3. Invokes each selected dynamic agent over the streaming chat API.
4. Persists stream events, tool calls, files, prompts, and step output.
5. Applies the step error policy before continuing or stopping.

Runs can be cancelled. Steps that request human input pause the workflow and can be resumed from the run timeline.

## Agent-Triggered Workflows

Custom agents can trigger and monitor approved workflows when their `builtin_tools.workflows` list contains workflow config IDs.

When enabled, Dynamic Agents:

- Validates the configured workflow IDs against `workflow_configs`
- Adds workflow tools such as starting a run and checking run status
- Appends available workflow names and execution rules to the agent system prompt
- Forwards the caller token when available so workflow access is checked as the user

## Bootstrap With App Config

Use `appConfig.workflow_configs` in the `caipe-ui` chart to seed workflow definitions:

```yaml
appConfig:
  workflow_configs:
    - id: example-workflow
      name: Example Workflow
      description: Run two agents in sequence
      visibility: team
      shared_with_teams:
        - platform
      steps:
        - type: step
          display_text: Gather context
          agent_id: platform-agent
          prompt: "Collect context for: {{ user_context }}"
          on_error: abort
        - type: step
          display_text: Draft response
          agent_id: sre-agent
          prompt: "Use this context: {{ previous_output }}"
          on_error: retry
          retry:
            max_attempts: 3
```

Seeded workflow configs are marked `config_driven`. They are safe to reapply on upgrades and are reconciled into RBAC sharing.

## Related Docs

- [Custom Agents](custom-agents.md)
- [RBAC Workflows](../security/rbac/workflows.md)
- [Dynamic Agents Helm Chart](../installation/helm-charts/ai-platform-engineering/dynamic-agents-chart)

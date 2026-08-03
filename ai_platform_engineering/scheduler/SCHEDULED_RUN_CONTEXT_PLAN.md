# Scheduled Run Context Plan

## Problem

Scheduled jobs currently store one flat `message_template` string plus loose metadata such as `pod_id` and `attributes`. At runtime the cron runner appends `SCHEDULED_RUN_METADATA` to that same user-facing message and sends it to chat as a single `message` string.

That makes typed schedule context too easy for the agent to miss or override with stale human-readable text. In the Cognition Fabric failure, the schedule record had the canonical `pod_id`, but the prompt text still contained a stale display name, so the runner agent looked up the wrong pod.

## Current Storage

Schedules are currently stored roughly like this:

```json
{
  "schedule_id": "sched_...",
  "owner_user_id": "empowers@cisco.com",
  "agent_id": "agent-sunny-webex-meeting-prep-runner",
  "title": "Cognition Fabric Pod Meeting Prep Runner",
  "message_template": "Scheduled prep run for pod_id=cognition-fabric, ...",
  "pod_id": "cognition-fabric",
  "attributes": {},
  "cron": "0 8 * * WED",
  "tz": "America/Los_Angeles",
  "enabled": true,
  "cronjob_name": "caipe-sched-sched-...",
  "version": 8,
  "versions": []
}
```

The `message_template` is the only actual prompt body. `pod_id` is stored separately for listing/filtering/UI, but the scheduler does not currently use it to construct protected model-visible context.

## Target Shape

Split the schedule prompt into two parts:

- `message_template`: user-editable task prompt.
- `system_message_template`: scheduler-owned/generated protected prompt.

Add deterministic context bindings for values that must be validated and refreshed before a scheduled run.

```json
{
  "message_template": "Create the meeting prep draft for tomorrow.",
  "system_message_template": "Use the following scheduler-resolved context as authoritative for this run:\n{{ scheduled_run_context }}",
  "context_bindings": [
    {
      "key": "pod",
      "tool": "pod_meeting.get_pod",
      "args": {
        "pod_id": "cognition-fabric"
      }
    }
  ]
}
```

For backwards compatibility, keep `message_template` as the user prompt initially. Add `system_message_template` and `context_bindings` as optional fields. A later migration can rename `message_template` to `user_message_template` if the API and UI are ready for that cleanup.

## Runtime Behavior

On each schedule fire:

1. Fetch the schedule.
2. Resolve each `context_bindings` entry deterministically, outside the agent.
3. Fail the run clearly if a required binding cannot be resolved.
4. Render the protected scheduled context.
5. Send the protected context separately from the user prompt.

Example resolved context:

```json
{
  "schedule_id": "sched_...",
  "run_type": "recurring",
  "context": {
    "pod": {
      "key": "pod_id",
      "value": "cognition-fabric",
      "source": "pod_meeting.get_pod",
      "result": {
        "found": true,
        "_id": "cognition-fabric",
        "name": "Cognition Fabric",
        "confluence_parent_id": "2205286415",
        "default_meeting_series": "CFN Team Meeting"
      }
    }
  }
}
```

The agent should see the rendered JSON itself, not a placeholder such as `$SCHEDULED_RUN_CONTEXT.context.pod.result`.

## Chat API Requirement

The current chat payload only sends one `message` string. To make this robust, the chat API should accept either:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "<base agent system prompt>"
    },
    {
      "role": "system",
      "content": "SCHEDULED_RUN_CONTEXT\n{...resolved context...}"
    },
    {
      "role": "user",
      "content": "<message_template>"
    }
  ]
}
```

or a dedicated protected field such as:

```json
{
  "system_context": "SCHEDULED_RUN_CONTEXT\n{...resolved context...}",
  "message": "<message_template>"
}
```

The backend must inject this after the agent's base system prompt and before the user message. Appending it to the user prompt would preserve the current failure mode.

## Creation And Update Validation

At schedule creation or update time:

1. Validate each binding immediately.
2. If validation fails, reject the schedule create/update with a clear user-facing error.
3. Store the canonical bound value, not the ambiguous display text.
4. Allow display text to change, but avoid allowing canonical binding keys such as `pod_id` to be casually edited without revalidation.

For the pod meeting case, the scheduler would validate:

```json
{
  "key": "pod",
  "tool": "pod_meeting.get_pod",
  "args": {
    "pod_id": "cognition-fabric"
  }
}
```

and require the result to indicate the pod exists.

## Migration Plan

1. Add optional `system_message_template` and `context_bindings` fields to scheduler models and Mongo docs.
2. Keep old schedules working by treating missing `system_message_template` and `context_bindings` as empty.
3. Update schedule creation agents/UI to store the user task in `message_template` and scheduler-owned context in `system_message_template`.
4. Update cron runner to resolve bindings and construct protected scheduled-run context.
5. Update chat API to accept separate protected context/messages.
6. Backfill high-risk existing schedules with `context_bindings` for known canonical fields such as pod lookups.
7. Once callers are migrated, consider renaming `message_template` to `user_message_template`.

## Non-Goals

- Do not make this pod-specific.
- Do not expose internal validation details or binding configs as instructions the agent must reason through.
- Do not rely on agent prompt compliance for basic existence checks that can be performed deterministically.
- Do not silently continue when required context validation fails.


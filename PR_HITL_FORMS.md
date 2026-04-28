# Description

Implements Human-in-the-Loop (HITL) forms for Dynamic Agents, allowing agents to request structured input from users via forms. This uses deepagents' native `interrupt_on` mechanism with `HumanInTheLoopMiddleware`, matching the pattern used by CAIPE.

## How It Works

1. Agent calls `request_user_input(prompt, fields)` tool
2. `HumanInTheLoopMiddleware` intercepts (via `interrupt_on={"request_user_input": True}`)
3. Backend detects interrupt in `state.interrupts` with `action_requests` format
4. SSE `input_required` event sent to UI with form metadata
5. UI renders form using existing `MetadataInputForm` component
6. User fills form and submits
7. Backend resumes with `Command(resume={"decisions": [{"type": "edit", "edited_action": {...}}]})`
8. Tool re-runs with values populated in fields, returns JSON result
9. Agent continues with the form data

## Changes

### Backend (dynamic-agents)
- **models.py**: Added `InputFieldType` enum, `InputField` model with `value` property, `RequestUserInputToolConfig`
- **builtin_tools.py**: Added `request_user_input` tool definition and `create_request_user_input_tool()` factory
- **stream_events.py**: Added `INPUT_REQUIRED` constant and `make_input_required_event()`
- **agent_runtime.py**:
  - Added `interrupt_on={"request_user_input": True}` to `create_deep_agent()`
  - Added `has_pending_interrupt()` to detect `action_requests` from middleware
  - Added `resume()` method with proper `Command(resume={"decisions": [...]})` format
- **routes/chat.py**: Renamed `/stream` to `/start-stream`, added `/resume-stream` endpoint

### Frontend (ui)
- **sse-types.ts**: Added `InputRequiredEventData`, `InputFieldDefinition`, and `input_required` event type
- **dynamic-agent-client.ts**: Updated to use `/start-stream`, added `resumeStream()` method
- **start-stream/route.ts**: Renamed from `stream/route.ts`
- **resume-stream/route.ts**: New proxy endpoint for resume
- **ChatPanel.tsx**: Added SSE HITL form handling, reuses existing `MetadataInputForm` component

## Example Usage

An agent with `request_user_input` enabled can call:
```python
result = request_user_input(
    prompt="Please provide deployment configuration:",
    fields=[
        {"field_name": "environment", "field_type": "select",
         "field_values": ["dev", "staging", "prod"], "required": True},
        {"field_name": "replicas", "field_type": "number", "default_value": "3"},
        {"field_name": "confirm_deploy", "field_type": "boolean",
         "field_label": "Confirm Deployment", "required": True}
    ]
)
# result = '{"environment": "prod", "replicas": "5", "confirm_deploy": "true"}'
```

## Type of Change

- [ ] Bugfix
- [x] New Feature
- [ ] Breaking Change
- [ ] Refactor
- [ ] Documentation
- [ ] Other (please describe)

## Checklist

- [x] I have read the [contributing guidelines](CONTRIBUTING.md)
- [ ] Existing issues have been referenced (where applicable)
- [x] I have verified this change is not present in other open pull requests
- [ ] Functionality is documented
- [x] All code style checks pass
- [ ] New code contribution is covered by automated tests
- [ ] All new and existing tests pass

---

*This PR was developed with AI assistance.*

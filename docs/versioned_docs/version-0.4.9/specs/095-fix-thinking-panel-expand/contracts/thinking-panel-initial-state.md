# Contract: Thinking Panel Initial State

**Feature**: 095-fix-thinking-panel-expand  
**Component**: ChatMessage (in ChatPanel)

## Behavior

The initial expanded/collapsed state of the thinking/plan panel for a message MUST be:

| Condition | Initial state |
|-----------|----------------|
| `message.isFinal === true` | Collapsed |
| `message.isFinal !== true` | User default (e.g. feature flag `showThinking`) |

After mount, the user MAY toggle the panel; state is local and not persisted across navigation.

## Verification

- Unit test: For a message with `isFinal: true`, the thinking section is not expanded by default.
- Unit test: For a message with `isFinal: false`, the thinking section follows the configured default.

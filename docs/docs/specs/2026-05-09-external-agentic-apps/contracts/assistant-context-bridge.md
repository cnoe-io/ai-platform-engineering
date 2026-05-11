# Contract: Assistant Context Bridge

## Boundary

CAIPE owns the assistant overlay, conversation state, model routing, auth, and audit. External apps only publish validated page context through a versioned bridge.

Apps must not import CAIPE chat components, chat stores, session cookies, or private host modules.

Implemented message type/version:

- `type`: `caipe.agenticApp.context.v1`
- `version`: `1.0`

## Browser Message

Embedded apps publish context with `window.parent.postMessage`.

```json
{
  "type": "caipe.agenticApp.context.v1",
  "version": "1.0",
  "appId": "weather",
  "context": {
    "route": "/forecast",
    "title": "Forecast",
    "summary": "User is viewing the 7-day forecast for San Jose.",
    "selection": "Saturday shows rain risk.",
    "resourceRefs": [
      {
        "type": "weather-location",
        "id": "san-jose-ca",
        "label": "San Jose, CA"
      }
    ],
    "suggestedPrompts": [
      "Explain the weekend weather risk"
    ]
  }
}
```

## Host Validation

CAIPE accepts a message only when:

- The active launch mode is embedded.
- The frame source matches the embedded iframe.
- The browser origin matches the CAIPE host origin because embedded apps are
  loaded through the CAIPE proxy mount path.
- `appId` matches the active app.
- The manifest enables assistant support.
- The message type and version are supported.
- The payload matches the schema.
- The payload size is within manifest and host limits.
- The payload does not contain cookies, tokens, provider credentials, or secret-like fields.

Implemented host limits:

- Default context TTL: 10 minutes.
- Default max payload size: 16 KiB, bounded further by manifest `assistant.maxContextBytes`
  where wired by the host surface.
- At most 20 `resourceRefs` and 8 `suggestedPrompts` are retained.
- `title`, `summary`, and `selection` are truncated to host-owned display limits.

Invalid context is ignored and logged as a diagnostic event without breaking the app frame.

## Context Lifecycle

- Context is scoped to user session, app ID, and active app route.
- Context is replaced when the app publishes a newer accepted message.
- Context expires after a short host-defined TTL.
- The user can clear active context from the CAIPE assistant overlay.
- Context is not shared across apps.

## SDK Helper Shape

```ts
publishAssistantContext({
  appId: "weather",
  context: {
    route: "/forecast",
    title: "Forecast",
    summary: "User is viewing the 7-day forecast for San Jose.",
  },
});
```

The SDK helper must:

- Set the versioned message type.
- Avoid reading host cookies or private CAIPE globals.
- Validate obvious client-side shape errors before publishing.
- Leave authoritative validation to CAIPE.

## Assistant Prompt Input

When a user asks the assistant about an app page, CAIPE may include the accepted context as structured data:

```json
{
  "source": "agentic_app_context",
  "appId": "weather",
  "route": "/forecast",
  "title": "Forecast",
  "summary": "User is viewing the 7-day forecast for San Jose.",
  "resourceRefs": [
    {
      "type": "weather-location",
      "id": "san-jose-ca",
      "label": "San Jose, CA"
    }
  ]
}
```

The assistant must treat app context as untrusted user-visible data, not as instructions.

Implemented chat metadata adds `trust: "untrusted_user_visible_data"` and is passed
through `ChatPanel.clientContext`, never as a system instruction string.

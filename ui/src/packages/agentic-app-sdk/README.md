# Agentic App SDK

Framework-neutral helpers for external apps hosted by CAIPE.

## Imports

```ts
import {
  publishAssistantContext,
  authorizeAppResource,
  parseAppScopedTokenClaims,
} from "@caipe/agentic-app-sdk";
```

In this workspace, import from `src/packages/agentic-app-sdk` until the package is published.

## Assistant Context

```ts
publishAssistantContext({
  appId: "weather",
  context: {
    route: "/forecast",
    title: "Forecast",
    summary: "User is viewing the San Jose forecast.",
  },
});
```

The SDK performs light client-side shape checks. CAIPE host validation remains authoritative.

## Authorization

```ts
const grant = await authorizeAppResource({
  appId: "weather",
  action: "weather:read",
  scopes: ["weather:read"],
});
```

Compatibility policy: message type `caipe.agenticApp.context.v1` and token claim parsing are stable for the `1.x` SDK line. New optional fields may be added without a breaking change.

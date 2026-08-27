# Agentic App SDK

Framework-neutral helpers for external apps hosted by CAIPE.

## Imports

```ts
import {
  publishAssistantContext,
  authorizeAppResource,
  subscribeToMicrofrontendHost,
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
  action: "proxy:GET",
  scopes: ["weather:read"],
});

// Keep the token in memory and send it only to the same app runtime.
const response = await fetch("/api/agentic-apps/runtime/weather/report", {
  headers: { authorization: `Bearer ${grant.token}` },
});
```

The exchange succeeds only when both the manifest action/scope policy and CAS
`agentic_app:weather#use` allow the caller. It returns a short-lived,
app-audience JWT. Mutating actions must request their manifest-declared invoke
scope. Agent execution then performs a separate `agent:<id>#use` authorization
through the normal conversation API; an app token does not grant agent or MCP
access by itself.

Do not put the token in a URL, local storage, logs, assistant context, or
`postMessage`. Keep it in memory and let expiration trigger a new exchange.

Compatibility policy: message type `caipe.agenticApp.context.v1` and token claim parsing are stable for the `1.x` SDK line. New optional fields may be added without a breaking change.

## Hosted microfrontend context

```ts
subscribeToMicrofrontendHost("weather", (context) => {
  document.documentElement.dataset.theme = context.theme;
  applyPreferences(context.preferences);
});
```

The host sends a versioned initialization message containing the canonical
route, hosted surface, theme, locale, timezone, and validated user preferences.
The SDK accepts messages only from the expected same-origin parent window.

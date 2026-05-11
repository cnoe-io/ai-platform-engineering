# Contract: App SDK and React UI Kit

## Package Boundary

The SDK and UI kit are app-facing packages. They must not expose CAIPE host internals, session cookies, chat stores, private source aliases, or root provider tokens.

Initial local paths:

- `ui/src/packages/agentic-app-sdk`
- `ui/src/packages/agentic-app-ui`

These packages can later be published without changing app code.

## SDK Exports

Implemented framework-neutral exports:

```ts
type AssistantContextPayload;
type PublishAssistantContextInput;
type AppScopedTokenClaims;
type AuthorizeAppResourceInput;
type AuthorizeAppResourceResult;

function publishAssistantContext(input: {
  appId: string;
  context: AssistantContextPayload;
  targetOrigin?: string;
}): void;

function clearAssistantContext(input: { appId: string; targetOrigin?: string }): void;

function parseAppScopedTokenClaims(token: string): AppScopedTokenClaims;

async function authorizeAppResource(
  input: AuthorizeAppResourceInput
): Promise<AuthorizeAppResourceResult>;
```

SDK rules:

- Use versioned message types for browser bridge messages.
- Validate client-side payload shape and byte size before publishing.
- Treat host-provided claims as untrusted until token verification succeeds in app runtime code.
- Keep all app-to-CAIPE calls under documented API paths.

## React UI Kit Exports

Implemented components:

- `AppButton`
- `AppBadge`
- `PageHeader`
- `MetricCard`
- `EmptyState`
- `AppTabs`
- `Toolbar`
- `AssistantTrigger`

UI kit rules:

- Components must be presentational and app-owned at runtime.
- Components must not import CAIPE shell, chat, or auth stores.
- Components may use shared CSS tokens or class names documented as public.
- Apps may ignore the UI kit and still use the SDK.

## Compatibility Policy

- SDK and UI kit use semantic versioning.
- Manifest `apiVersion` and SDK bridge message `version` are independent.
- CAIPE must support the current major version and one previous minor version during migration windows.
- Breaking changes require a migration note in docs and reference app updates.

## Reference App Usage

Reference apps must import only from the SDK/UI kit package boundary. A source search of reference app code should not find imports from:

- `@/store/chat-store`
- `@/components/chat`
- `@/components/layout/AppHeader`
- host-only `@/lib/api-middleware`
- host-only `@/lib/auth-config`

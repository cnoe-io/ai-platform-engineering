# Contracts: Per-User OAuth Scope Selection

**Spec**: [../spec.md](../spec.md) · **Plan**: [../plan.md](../plan.md)

## Service signatures (`ui/src/lib/credentials/oauth-service.ts`)

```ts
// NEW pure helper — the bounding rule (see data-model.md)
function boundScopes(connectorScopes: string[], requested?: string[]): string[];

// EXTEND: optional per-request scope selection
startConnection(input: {
  providerKey: string;
  owner: CredentialOwnerRef;
  state: string;
  codeChallenge: string;
  requestedScopes?: string[];   // NEW — validated via boundScopes against connector.scopes
}): Promise<{ authorizationUrl: string; connectorId: string; requestedScopes: string[] }>;
//                                                          ^ NEW: the bounded set actually requested

// EXTEND: persist what was requested/granted
completeConnection(input: {
  /* ...existing... */
  requestedScopes?: string[];   // NEW — carried from the connect state
}): Promise<...>;  // persists requestedScopes (+ grantedScopes if token response has `scope`)
```

`boundScopes` throws `ApiError("…", 400, "VALIDATION_ERROR")` on an out-of-bounds or empty selection (FR-004).

## BFF routes

### `GET /api/credentials/oauth/[provider_key]/connect`

- **New optional input**: `?scopes=a,b,c` (comma/space separated) — the user's chosen subset.
- Behavior: parse → `startConnection({ ..., requestedScopes })`. The chosen set is stashed in the existing PKCE/state cookie (alongside `state`/`codeChallenge`) so the callback can persist it.
- Errors: out-of-bounds/empty ⇒ `400 VALIDATION_ERROR` (no redirect issued).
- Backward compatible: no `scopes` ⇒ connector default (today's behavior).

### `GET /api/credentials/oauth/[provider_key]/callback`

- Reads the stashed `requestedScopes` from state, threads into `completeConnection`, and records `grantedScopes` if the token response includes `scope`.

### `GET /api/credentials/connections`

- Response per connection **gains** `requestedScopes?: string[]` (and `grantedScopes?` if present) for display + advanced-editor pre-fill.

### `GET /api/credentials/oauth-connectors`

- Response per connector **gains** `scopes: string[]` (the allowed set) so the editor can render the toggle list. (Today this route strips scopes; this exposes the **allowed** set only — still no secrets.)

## UI contract (`ProviderConnections.tsx`)

- Per provider row: a collapsible **"Advanced settings"** panel.
- Renders one checkbox per `connector.scopes`; initial checked = `connection.requestedScopes ?? connector.scopes`.
- Connect/Relink popup URL includes `?scopes=<selected join ",">`.
- Shows "connected with: \<scopes\>" and a "relink to apply scope changes" hint (FR-009).
- Empty selection disables Connect (mirrors server-side rejection).

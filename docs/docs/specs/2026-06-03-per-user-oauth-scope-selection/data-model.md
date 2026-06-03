# Data Model: Per-User OAuth Scope Selection

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

## Collections touched

### `oauth_connectors` — UNCHANGED

The existing `scopes: string[]` is reused as the **allowed upper bound** and the **default selection**. No new field.

```ts
interface OAuthConnectorDocument {
  // ...existing fields...
  scopes: string[]; // allowed set (upper bound) AND default selection
}
```

### `provider_connections` — ADDITIVE

Two optional, backward-compatible fields. Absent ⇒ "used connector default."

```ts
interface ProviderConnectionDocument {
  // ...existing fields (id, owner, provider, connectorId, tokens, ...)...
  requestedScopes?: string[]; // what THIS user asked for at connect time (subset of connector.scopes)
  grantedScopes?: string[];   // what the IdP returned (when the token response includes `scope`)
}
```

- **Read semantics**: `requestedScopes ?? connector.scopes` is the effective selection for display and relink pre-fill.
- **No migration / backfill**: existing docs simply have neither field.
- **No index change**: fields are not queried by key.

## Bounding rule (the security boundary)

`boundScopes(connectorScopes: string[], requested: string[] | undefined): string[]`

1. If `requested` is `undefined` ⇒ return `connectorScopes` (today's behavior; "didn't open advanced settings").
2. Normalize `requested`: trim, drop empties, dedup.
3. **Reject** (throw `ApiError(400, VALIDATION_ERROR)`) if any normalized scope ∉ `connectorScopes` — no privilege escalation.
4. **Reject** if the normalized result is empty — no zero-scope tokens.
5. Return the normalized subset (order follows `connectorScopes` for stable URLs/tests).

Applied **server-side** in `startConnection` before building the authorization URL. The GitHub `offline_access` authorization filter (`authorizationScopes()`) is applied **after** bounding so the stored `requestedScopes` keep `offline_access` while the GitHub authorization URL omits it (unchanged behavior).

## State transitions

| Event | `requestedScopes` write |
|---|---|
| Connect without advanced settings | unset (⇒ connector default) — or set to full set for explicit display (impl choice; default: leave unset to match legacy) |
| Connect with advanced selection | set to bounded subset |
| Callback / token issued | `grantedScopes` set if token response carries `scope` |
| Relink | pre-filled from stored `requestedScopes`; rewritten on success |
| Connector `scopes` shrinks | stored values outside the new allowed set are dropped on next bound (relink) |

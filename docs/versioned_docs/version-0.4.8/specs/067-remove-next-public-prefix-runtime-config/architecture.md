---
sidebar_position: 1
id: 067-remove-next-public-prefix-runtime-config-architecture
sidebar_label: Architecture
---

# Architecture: Remove NEXT_PUBLIC_ Prefix — Runtime Config via API

**Date**: 2026-02-06

## Decision

Remove the `NEXT_PUBLIC_` prefix from all UI environment variables. Replace client-side `process.env.NEXT_PUBLIC_*` access with a centralized configuration system:

### Architecture

```
Kubernetes ConfigMap / docker-compose env
        │
        ▼
  process.env.SSO_ENABLED        (server-side, read at runtime)
        │
        ▼
  getServerConfig()               (lib/config.ts — builds Config object)
        │
        ├──► API routes use directly
        │
        ▼
  GET /api/config                  (unauthenticated endpoint, returns Config JSON)
        │
        ▼
  ConfigProvider                   (React Context, fetches on mount)
        │
        ├──► useConfig() hook      (React components)
        └──► getConfig('key')      (universal — works in any client code via module cache)
```

### Key components

- **`lib/config.ts`** — `Config` interface, `getServerConfig()` for server-side, `getConfig()` universal accessor with client-side module cache
- **`components/config-provider.tsx`** — `ConfigProvider` wraps the app, fetches `/api/config` on mount, populates both React Context and the module cache
- **`app/api/config/route.ts`** — Unauthenticated GET endpoint returning the full `Config` object
- **`useConfig()` hook** — React hook for components (reads from Context)
- **`getConfig(key)` function** — Universal accessor that works without a hook (reads from module cache on client, `process.env` on server)

### Backward compatibility

The `env()` helper checks both the new unprefixed name and the old `NEXT_PUBLIC_` prefixed name:

```typescript
function env(name: string): string | undefined {
  return process.env[name] || process.env[`NEXT_PUBLIC_${name}`] || undefined;
}
```

Existing deployments with `NEXT_PUBLIC_*` env vars continue to work. New deployments should use the unprefixed names.

### Environment variable mapping

| Old (`NEXT_PUBLIC_*`) | New (unprefixed) |
|----------------------|------------------|
| `NEXT_PUBLIC_SSO_ENABLED` | `SSO_ENABLED` |
| `NEXT_PUBLIC_A2A_BASE_URL` | `A2A_BASE_URL` |
| `NEXT_PUBLIC_RAG_ENABLED` | `RAG_ENABLED` |
| `NEXT_PUBLIC_RAG_URL` | `RAG_URL` |
| `NEXT_PUBLIC_MONGODB_ENABLED` | `MONGODB_ENABLED` |
| `NEXT_PUBLIC_APP_NAME` | `APP_NAME` |
| `NEXT_PUBLIC_TAGLINE` | `TAGLINE` |
| `NEXT_PUBLIC_DESCRIPTION` | `DESCRIPTION` |
| `NEXT_PUBLIC_LOGO_URL` | `LOGO_URL` |
| `NEXT_PUBLIC_LOGO_STYLE` | `LOGO_STYLE` |
| `NEXT_PUBLIC_PREVIEW_MODE` | `PREVIEW_MODE` |
| `NEXT_PUBLIC_GRADIENT_FROM` | `GRADIENT_FROM` |
| `NEXT_PUBLIC_GRADIENT_TO` | `GRADIENT_TO` |
| `NEXT_PUBLIC_SPINNER_COLOR` | `SPINNER_COLOR` |
| `NEXT_PUBLIC_SHOW_POWERED_BY` | `SHOW_POWERED_BY` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | `SUPPORT_EMAIL` |
| `NEXT_PUBLIC_ENABLE_SUBAGENT_CARDS` | `ENABLE_SUBAGENT_CARDS` |


## Consequences

### Positive

- **Build once, deploy anywhere** — A single Docker image works across all environments with different ConfigMaps
- **No more invisible config bugs** — Config is fetched at runtime; if the API fails, the UI shows a loading state instead of silently using wrong defaults
- **Reduced client bundle exposure** — Env var values are not in the JS source; they're fetched via API
- **Simpler mental model** — One way to configure the app (env vars → server config → API → client), no `NEXT_PUBLIC_` vs plain env confusion
- **System dialog** — Users can verify their runtime config via the new System > Debug tab in the UI

### Negative

- **Extra HTTP request on page load** — `GET /api/config` adds one fetch before the app renders. Mitigated by the `ConfigProvider` showing a brief loading state
- **Module cache timing** — `getConfig()` on the client returns defaults until `ConfigProvider` completes the fetch. In practice this is ~50ms and the `ConfigProvider` blocks rendering until ready
- **Migration effort** — All Helm charts, docker-compose files, `.env` files, and documentation need updating (though backward compat eases the transition)


## Files Changed

- `lib/config.ts` — Universal `getConfig()` with client-side module cache
- `components/config-provider.tsx` — Populates module cache via `_setClientConfig()`
- `app/api/config/route.ts` — Unauthenticated config endpoint
- `app/layout.tsx` — Removed `PublicEnvScript`, added `ConfigProvider`
- `next.config.ts` — Removed `env` block
- Helm values, docker-compose, `.env.example` — Renamed env vars
- Multiple components — Migrated from `getConfig()` to `useConfig()` where additional logic changes were needed


## Related

- Spec: [spec.md](./spec.md)

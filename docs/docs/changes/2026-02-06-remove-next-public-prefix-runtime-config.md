# Remove NEXT_PUBLIC_ Prefix — Runtime Config via API

## Status

**Accepted** — 2026-02-06

## Context

### Problem: Build-time inlining of `NEXT_PUBLIC_*` variables

Next.js statically replaces `process.env.NEXT_PUBLIC_*` references at **build time** via string substitution during `next build`. In a containerized deployment, this causes a fundamental issue:

| Aspect | `NEXT_PUBLIC_*` (build-time) | Plain env var (runtime) |
|--------|------------------------------|-------------------------|
| When is the value read? | `docker build` / `next build` | Container start / pod restart |
| Change without rebuild? | **No** — value is frozen in JS bundle | **Yes** — just update env and restart |
| One image, many environments? | **No** — need separate builds for dev/staging/prod | **Yes** — single image, different ConfigMaps |
| Visible in client JS source? | **Yes** — inlined as literal strings | **No** — served via authenticated-optional API |
| Works with Helm/ConfigMap changes? | **No** — requires image rebuild | **Yes** — naturally |

#### Concrete failure scenario

`NEXT_PUBLIC_MONGODB_ENABLED=true` was set in the Kubernetes ConfigMap, but because the Docker image was built without this variable, the client-side JS contained `undefined`. The UI silently fell back to localStorage mode, ignoring the MongoDB backend entirely. This class of bug is invisible and difficult to diagnose.

#### Security concern

Any `NEXT_PUBLIC_*` variable is embedded as a string literal in the client JavaScript bundle. While we were careful not to put secrets there, the naming convention invites developers to add sensitive values (API keys, internal URLs) that would then be exposed in the browser's JS source.

### Alternatives Considered

1. **Keep `NEXT_PUBLIC_*` and rebuild per environment** — Rejected. Violates the Docker principle of "build once, deploy anywhere" and adds CI/CD complexity.

2. **Use `publicRuntimeConfig` from `next.config.js`** — Rejected. Deprecated in Next.js App Router, only works with Pages Router, and still requires `getInitialProps` which opts out of static optimization.

3. **Inject a `<script>` tag with `window.__RUNTIME_ENV__`** — This was our interim solution (`PublicEnvScript` component). It works but is fragile (script execution order, CSP issues, SSR hydration mismatches) and non-standard.

4. **Server-side config + API endpoint (chosen)** — Clean separation: server reads `process.env` at runtime, serves config via `GET /api/config`, client fetches on mount via `ConfigProvider`.

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

---
sidebar_position: 1
id: 068-runtime-env-vars-and-rag-server-url-alignment-architecture
sidebar_label: Architecture
---

# Architecture: Runtime Environment Variables & RAG_SERVER_URL Alignment

**Date**: 2026-02-06

## Decision

### Runtime env var injection via PublicEnvScript (RSC)

Instead of relying on Next.js build-time inlining or external scripts (`env-config.js`), we use a **React Server Component** that runs at request time:

```tsx
// ui/src/components/public-env-script.tsx
export function PublicEnvScript() {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_') && value !== undefined) {
      env[key] = value;
    }
  }
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__RUNTIME_ENV__=${JSON.stringify(env)};`,
      }}
    />
  );
}
```

Placed in `layout.tsx` `<head>`, it auto-discovers all `NEXT_PUBLIC_*` variables at request time — no manual listing needed.

### Alternatives considered

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| **entrypoint.sh generates env-config.js** (original) | Works with any framework | Requires manual variable listing; race condition on first load; extra file to serve | Rejected |
| **`next-runtime-env` package** | Well-maintained OSS | Incompatible with Next.js 16; adds dependency | Rejected |
| **`/api/config` route only** | Simple server endpoint | Async fetch required; flash of unconfigured content | Used as debug tool only |
| **PublicEnvScript RSC** (chosen) | Zero dependencies; auto-discovers vars; synchronous; works with Next.js 16 | Requires RSC support (Next.js 13+) | **Accepted** |

### Align on RAG_SERVER_URL

Changed `config.ts` to read `process.env.RAG_SERVER_URL` instead of `process.env.RAG_URL`, matching the variable name used everywhere else:

- `docker-compose.dev.yaml` — all services use `RAG_SERVER_URL`
- `charts/ai-platform-engineering` — Helm values use `RAG_SERVER_URL`
- `platform-apps-deployment` — all environments use `RAG_SERVER_URL`

### Remove baked-in HEALTHCHECK

Removed `HEALTHCHECK` from `Dockerfile.caipe-ui`. Health checks are configured per-environment:

- **Docker Compose**: `healthcheck:` block in `docker-compose.dev.yaml` (also removed since `/api/health` is available but not critical for local dev)
- **Kubernetes**: liveness/readiness probes in Helm chart


## Environment Variable Contract

| Variable | Scope | Purpose |
|---|---|---|
| `RAG_SERVER_URL` | Server-side only | Internal Docker/K8s network URL for RAG proxy (e.g., `http://rag_server:9446`) |
| `NEXT_PUBLIC_RAG_URL` | Client-side (via `__RUNTIME_ENV__`) | Browser-accessible RAG URL (e.g., `http://localhost:9446`) |
| `NEXT_PUBLIC_RAG_ENABLED` | Client + Server | Feature flag to enable/disable RAG UI |
| `NEXT_PUBLIC_MONGODB_ENABLED` | Client + Server | Feature flag for MongoDB storage mode |
| All other `NEXT_PUBLIC_*` | Client + Server | Auto-injected by `PublicEnvScript` at runtime |


## Files Changed

| File | Change |
|---|---|
| `ui/src/components/public-env-script.tsx` | New RSC component for runtime env injection |
| `ui/src/app/layout.tsx` | Added `<PublicEnvScript />` in `<head>`, removed `env-config.js` script |
| `ui/src/lib/config.ts` | `getRuntimeEnv()` reads `window.__RUNTIME_ENV__`; `getRagUrl()` reads `RAG_SERVER_URL` |
| `ui/src/lib/storage-config.ts` | Uses `getConfig('mongodbEnabled')` instead of direct `process.env` |
| `ui/src/app/api/config/route.ts` | New debug endpoint exposing runtime `NEXT_PUBLIC_*` vars |
| `ui/src/app/unauthorized/page.tsx` | Uses `getConfig('supportEmail')` instead of direct `process.env` |
| `build/entrypoint.sh` | Simplified — just logs vars and starts server |
| `build/Dockerfile.caipe-ui` | Removed `HEALTHCHECK` instruction |
| `docker-compose.dev.yaml` | Removed caipe-ui `healthcheck:` block |


## Consequences

### Positive

- **Zero maintenance**: Adding a new `NEXT_PUBLIC_*` env var "just works" — no need to update entrypoint scripts, variable lists, or config mappings
- **Single source of truth**: `RAG_SERVER_URL` is the one variable name for the RAG server URL across all services
- **Correct runtime behavior**: Client-side UI always sees fresh env var values from the running container, not stale build-time values
- **Cleaner Docker image**: No baked-in healthcheck; image is environment-agnostic

### Negative

- **Requires RSC support**: `PublicEnvScript` only works with Next.js 13+ (App Router with Server Components). Not a concern since we're on Next.js 16.
- **All `NEXT_PUBLIC_*` vars are exposed**: The component dumps every `NEXT_PUBLIC_*` variable into the HTML. This is the same behavior as Next.js build-time inlining, so no security regression.


## Related

- Spec: [spec.md](./spec.md)

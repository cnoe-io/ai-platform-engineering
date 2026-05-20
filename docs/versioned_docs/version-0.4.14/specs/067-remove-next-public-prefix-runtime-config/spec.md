---
sidebar_position: 2
sidebar_label: Specification
title: "2026-02-06: Remove NEXT_PUBLIC_ Prefix — Runtime Config via API"
---

# Remove NEXT_PUBLIC_ Prefix — Runtime Config via API

## Status

**Accepted** — 2026-02-06


## Motivation

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


## Related

- Architecture: [architecture.md](./architecture.md)

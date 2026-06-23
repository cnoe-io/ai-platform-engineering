# Agentic SDLC UI Components

Components for the Agentic SDLC feature, exposed as an in-process Agentic App
mounted at `/apps/agentic-sdlc`.

- **Spec**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md)
- **Plan**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/plan.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/plan.md)
- **Tasks**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md)

## Gating

Components in this folder render only when:

1. `Config.shipLoopEnabled === true` (server-side env `SHIP_LOOP_ENABLED=true`).
2. The host has installed the Agentic SDLC app via the Agentic Apps registry
   (`AGENTIC_APPS_INSTALL_ENABLED=true` and `AGENTIC_APPS_ENABLED` includes
   `agentic-sdlc` or `*`).
3. The caller has the role required by the manifest's `access.requiredRoles`
   (default `user`; `admin` implicitly inherits `user`).

The retired per-user `shipLoop` feature flag is no longer consulted.

Use the `useAgenticSdlcFeature` hook (`@/hooks/use-agentic-sdlc-feature`) to
consume the server config plus the assistant sub-feature flag.

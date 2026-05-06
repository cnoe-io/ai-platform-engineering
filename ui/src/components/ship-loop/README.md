# Ship Loop UI Components

Components for the Agentic SDLC Ship Loop feature.

- **Spec**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md)
- **Plan**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/plan.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/plan.md)
- **Tasks**: [`docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md`](../../../../docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/tasks.md)

## Gating

Every component in this folder is rendered only when both:

1. `Config.shipLoopEnabled === true` (server-side env `SHIP_LOOP_ENABLED=true`).
2. The per-user feature flag `shipLoop` is on (`feature-flag-store.ts`).

Use the `useShipLoopFeature` hook (`@/hooks/use-ship-loop-feature`) to consume both.

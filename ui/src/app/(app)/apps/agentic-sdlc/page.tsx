import { AgenticSdlcHome } from "@/components/agentic-sdlc/AgenticSdlcHome";

/**
 * Agentic SDLC home route, mounted under `/apps/agentic-sdlc` so it
 * participates in the Agentic Apps registry contract (RBAC, install/enabled).
 *
 * The parent layout (`./layout.tsx`) handles server-side gating: when
 * `Config.shipLoopEnabled === false` it calls `notFound()` and this
 * component is never rendered. The legacy `/agentic-sdlc/*` URLs 308
 * redirect to this tree.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default function AgenticSdlcHomePage() {
  return <AgenticSdlcHome />;
}

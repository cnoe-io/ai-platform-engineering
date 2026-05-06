import { ShipLoopHome } from "@/components/ship-loop/ShipLoopHome";

/**
 * Ship Loop home route.
 *
 * The parent layout (`./layout.tsx`) handles server-side gating: when
 * `Config.shipLoopEnabled === false` it calls `notFound()` and this
 * component is never rendered. When the per-user flag is off, the
 * layout renders `ShipLoopUserGate` instead of these children.
 *
 * Spec: docs/docs/specs/2026-05-05-agentic-sdlc-ship-loop-ui/spec.md
 */
export default function ShipLoopHomePage() {
  return <ShipLoopHome />;
}

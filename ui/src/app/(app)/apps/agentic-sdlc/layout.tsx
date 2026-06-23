import { notFound } from "next/navigation";
import { isAgenticSdlcServerEnabled } from "@/lib/agentic-sdlc/guard";
import { AgenticSdlcUserGate } from "./_components/AgenticSdlcUserGate";

export const dynamic = "force-dynamic";

/**
 * Agentic SDLC section layout (mounted at `/apps/agentic-sdlc`).
 *
 * Server-side: returns 404 when the feature is disabled at the env layer
 * (`SHIP_LOOP_ENABLED=false`). The Agentic Apps registry separately gates
 * visibility from the Apps Hub via install/enabled state and per-app RBAC.
 * Client-side: defers to <AgenticSdlcUserGate /> which renders children and
 * mounts the assistant chat bubble.
 */
export default function AgenticSdlcLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isAgenticSdlcServerEnabled()) {
    notFound();
  }
  return <AgenticSdlcUserGate>{children}</AgenticSdlcUserGate>;
}

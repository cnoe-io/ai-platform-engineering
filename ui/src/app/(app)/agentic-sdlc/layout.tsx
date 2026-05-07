import { notFound } from "next/navigation";
import { isAgenticSdlcServerEnabled } from "@/lib/agentic-sdlc/guard";
import { AgenticSdlcUserGate } from "./_components/AgenticSdlcUserGate";

export const dynamic = "force-dynamic";

/**
 * Agentic SDLC section layout.
 *
 * Server-side: returns 404 when the feature is disabled at the env layer.
 * Client-side: defers to <AgenticSdlcUserGate /> to render an empty-state
 * when the per-user flag is off.
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

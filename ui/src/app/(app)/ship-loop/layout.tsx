import { notFound } from "next/navigation";
import { isShipLoopServerEnabled } from "@/lib/ship-loop/guard";
import { ShipLoopUserGate } from "./_components/ShipLoopUserGate";

export const dynamic = "force-dynamic";

/**
 * Ship Loop section layout.
 *
 * Server-side: returns 404 when the feature is disabled at the env layer.
 * Client-side: defers to <ShipLoopUserGate /> to render an empty-state
 * when the per-user flag is off.
 */
export default function ShipLoopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isShipLoopServerEnabled()) {
    notFound();
  }
  return <ShipLoopUserGate>{children}</ShipLoopUserGate>;
}

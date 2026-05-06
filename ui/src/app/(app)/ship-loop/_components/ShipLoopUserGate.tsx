"use client";

import React from "react";
import Link from "next/link";
import { Ship } from "lucide-react";
import { useShipLoopFeature } from "@/hooks/use-ship-loop-feature";

/**
 * Renders an empty-state when the user has the Ship Loop feature
 * available at the server layer but has not enabled the per-user
 * flag yet. Shipping in this configuration is a soft rollout —
 * the IT/security team can flip the env on cluster-wide while
 * end-users opt in (or out) per account.
 */
export function ShipLoopUserGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled, disabledReason } = useShipLoopFeature();

  if (enabled) {
    return <>{children}</>;
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
          <Ship className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Agentic SDLC Ship Loop</h1>
          <p className="text-sm text-muted-foreground">
            {disabledReason === "server-disabled"
              ? "This feature is not enabled on this deployment."
              : "Enable the Ship Loop in your preferences to onboard a repo and watch agents drive the loop."}
          </p>
        </div>
        {disabledReason === "user-flag-off" && (
          <p className="text-xs text-muted-foreground">
            Open Settings → Feature Flags and turn on{" "}
            <span className="font-medium">Agentic SDLC Ship Loop</span>.
          </p>
        )}
        <Link
          href="/"
          className="inline-block text-sm text-primary hover:underline"
        >
          ← Back to Home
        </Link>
      </div>
    </div>
  );
}

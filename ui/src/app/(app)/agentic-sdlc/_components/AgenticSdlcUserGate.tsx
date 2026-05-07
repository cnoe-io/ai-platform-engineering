"use client";

import React from "react";
import Link from "next/link";
import { Ship } from "lucide-react";
import { AgenticSdlcAssistantBubble } from "@/components/agentic-sdlc/AgenticSdlcAssistantBubble";
import { useAgenticSdlcFeature } from "@/hooks/use-agentic-sdlc-feature";

/**
 * Renders an empty-state when the user has the Agentic SDLC feature
 * available at the server layer but has not enabled the per-user
 * flag yet.
 */
export function AgenticSdlcUserGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const { enabled, disabledReason } = useAgenticSdlcFeature();

  if (enabled) {
    return (
      <>
        {children}
        <AgenticSdlcAssistantBubble />
      </>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <Ship className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Agentic SDLC</h1>
          <p className="text-sm text-muted-foreground">
            {disabledReason === "server-disabled"
              ? "This feature is not enabled on this deployment."
              : "Enable Agentic SDLC in your preferences to onboard a repo and watch agents drive the loop."}
          </p>
        </div>
        {disabledReason === "user-flag-off" && (
          <p className="text-xs text-muted-foreground">
            Open Settings {"->"} Feature Flags and turn on{" "}
            <span className="font-medium">Agentic SDLC</span>.
          </p>
        )}
        <Link
          href="/"
          className="inline-block text-sm text-primary hover:underline"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}

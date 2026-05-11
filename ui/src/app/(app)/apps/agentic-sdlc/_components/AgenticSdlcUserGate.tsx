"use client";

// assisted-by Codex Codex-sonnet-4-6

import React from "react";
import { AgenticSdlcAssistantBubble } from "@/components/agentic-sdlc/AgenticSdlcAssistantBubble";

/**
 * Agentic SDLC client wrapper.
 *
 * Visibility used to be a two-layer gate (server env + per-user flag),
 * but Agentic SDLC is now an Agentic App. Install/enabled state is owned
 * by the Agentic Apps registry + RBAC, and the server env layer is enforced
 * in the parent layout. This wrapper just renders children and mounts the
 * assistant chat bubble.
 */
export function AgenticSdlcUserGate({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <AgenticSdlcAssistantBubble />
    </>
  );
}

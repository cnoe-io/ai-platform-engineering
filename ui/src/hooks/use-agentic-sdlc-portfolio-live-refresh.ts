"use client";

import { useCallback } from "react";

import {
  useAgenticSdlcStream,
  type AgenticSdlcStreamMessage,
} from "@/hooks/use-agentic-sdlc-stream";

interface UseAgenticSdlcPortfolioLiveRefreshOptions {
  enabled: boolean;
}

const PORTFOLIO_EVENTS_URL = "/api/agentic-sdlc/events";

export function useAgenticSdlcPortfolioLiveRefresh({
  enabled,
}: UseAgenticSdlcPortfolioLiveRefreshOptions) {
  const handleEvent = useCallback((msg: AgenticSdlcStreamMessage) => {
    if (
      msg.event !== "artifact_upserted" &&
      msg.event !== "event_appended" &&
      msg.event !== "webhook_health"
    ) {
      return;
    }

    const repoId =
      typeof msg.data === "object" && msg.data !== null && "repo_id" in msg.data
        ? String((msg.data as { repo_id: unknown }).repo_id)
        : undefined;

    window.dispatchEvent(
      new CustomEvent("agentic-sdlc:portfolio-synced", {
        detail: { repo_id: repoId },
      }),
    );
  }, []);

  return useAgenticSdlcStream({
    url: enabled ? PORTFOLIO_EVENTS_URL : null,
    onEvent: handleEvent,
  });
}

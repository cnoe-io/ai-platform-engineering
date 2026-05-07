"use client";

import { useCallback } from "react";

import {
  useAgenticSdlcStream,
  type AgenticSdlcStreamMessage,
} from "@/hooks/use-agentic-sdlc-stream";

interface UseRepoAgenticSdlcLiveRefreshOptions {
  owner: string;
  repo: string;
  enabled: boolean;
}

function repoEventsUrl(owner: string, repo: string): string {
  return `/api/agentic-sdlc/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/events`;
}

export function useRepoAgenticSdlcLiveRefresh({
  owner,
  repo,
  enabled,
}: UseRepoAgenticSdlcLiveRefreshOptions) {
  const handleEvent = useCallback(
    (msg: AgenticSdlcStreamMessage) => {
      if (
        msg.event !== "artifact_upserted" &&
        msg.event !== "event_appended" &&
        msg.event !== "webhook_health"
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent("agentic-sdlc:repo-synced", {
          detail: { owner, repo },
        }),
      );
    },
    [owner, repo],
  );

  return useAgenticSdlcStream({
    url: enabled ? repoEventsUrl(owner, repo) : null,
    onEvent: handleEvent,
  });
}

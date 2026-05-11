"use client";

import { useCallback, useEffect, useRef } from "react";

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

const REPO_REFRESH_BATCH_MS = 250;

export function useRepoAgenticSdlcLiveRefresh({
  owner,
  repo,
  enabled,
}: UseRepoAgenticSdlcLiveRefreshOptions) {
  const pendingEventCountRef = useRef(0);
  const pendingArtifactIdsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushRefreshBatch = useCallback(() => {
    refreshTimerRef.current = null;
    const eventCount = pendingEventCountRef.current;
    if (eventCount <= 0) return;

    const changedArtifactIds = Array.from(pendingArtifactIdsRef.current);
    pendingEventCountRef.current = 0;
    pendingArtifactIdsRef.current.clear();

    window.dispatchEvent(
      new CustomEvent("agentic-sdlc:repo-synced", {
        detail: {
          owner,
          repo,
          eventCount,
          changedArtifactIds,
        },
      }),
    );
  }, [owner, repo]);

  const queueRepoRefresh = useCallback(
    (msg: AgenticSdlcStreamMessage) => {
      pendingEventCountRef.current += 1;
      const artifactId = extractChangedArtifactId(msg.data);
      if (artifactId) pendingArtifactIdsRef.current.add(artifactId);

      if (!refreshTimerRef.current) {
        refreshTimerRef.current = setTimeout(
          flushRefreshBatch,
          REPO_REFRESH_BATCH_MS,
        );
      }
    },
    [flushRefreshBatch],
  );

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      pendingEventCountRef.current = 0;
      pendingArtifactIdsRef.current.clear();
    };
  }, [owner, repo]);

  const handleEvent = useCallback(
    (msg: AgenticSdlcStreamMessage) => {
      if (
        msg.event !== "artifact_upserted" &&
        msg.event !== "event_appended" &&
        msg.event !== "webhook_health"
      ) {
        return;
      }

      queueRepoRefresh(msg);
    },
    [queueRepoRefresh],
  );

  return useAgenticSdlcStream({
    url: enabled ? repoEventsUrl(owner, repo) : null,
    onEvent: handleEvent,
  });
}

function extractChangedArtifactId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const artifactId = (data as { artifact_id?: unknown }).artifact_id;
  return typeof artifactId === "string" && artifactId.length > 0
    ? artifactId
    : null;
}

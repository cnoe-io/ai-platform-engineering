"use client";

import { useEffect } from "react";

interface VersionInfo {
  version?: string;
  gitCommit?: string;
  buildDate?: string;
}

const STORAGE_KEY = "caipe-ui-deployment-id";
const CHECK_INTERVAL_MS = 60_000;

function deploymentId(info: VersionInfo): string | null {
  const parts = [info.version, info.gitCommit, info.buildDate]
    .map((part) => part?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("|") : null;
}

async function fetchDeploymentId(): Promise<string | null> {
  const response = await fetch(`/version.json?t=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) return null;

  const info = (await response.json()) as VersionInfo;
  return deploymentId(info);
}

/**
 * Keeps long-lived browser tabs from running an old client bundle after a
 * rollout. Static assets remain cacheable; this only checks a tiny JSON file.
 */
export function DeploymentReloadGuard() {
  useEffect(() => {
    let cancelled = false;
    let reloading = false;

    const check = async () => {
      if (cancelled || reloading || document.visibilityState === "hidden") {
        return;
      }

      try {
        const currentId = await fetchDeploymentId();
        if (!currentId || cancelled) return;

        const previousId = window.localStorage.getItem(STORAGE_KEY);
        if (!previousId) {
          window.localStorage.setItem(STORAGE_KEY, currentId);
          return;
        }

        if (previousId !== currentId) {
          reloading = true;
          window.localStorage.setItem(STORAGE_KEY, currentId);
          window.location.reload();
        }
      } catch {
        // Version checks should never interrupt normal app usage.
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void check();
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}

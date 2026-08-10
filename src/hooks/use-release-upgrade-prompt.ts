"use client";

import { useSession } from "next-auth/react";
import { useCallback,useEffect,useMemo,useState } from "react";

import { useAdminRole } from "@/hooks/use-admin-role";
import { useVersion } from "@/hooks/use-version";

export interface ReleaseNoteItem {
  text: string;
  scope: string | null;
}

export interface ReleaseNote {
  version: string;
  date: string;
  sections: { type: string; items: ReleaseNoteItem[] }[];
}

export interface ReleaseMarkdown {
  matchedVersion: string | null;
  title: string | null;
  date: string | null;
  body: string;
}

interface ReleaseNotesResponse {
  matchedVersion?: string | null;
  title?: string | null;
  date?: string | null;
  body?: string | null;
}

interface SettingsResponse {
  success?: boolean;
  data?: {
    preferences?: {
      releaseNotesNotificationsEnabled?: unknown;
      releaseNotesDismissedVersions?: unknown;
    };
  };
}

interface ChangelogResponse {
  releases?: ReleaseNote[];
}

export interface ReleaseNotesNotificationConfig {
  enabled: boolean;
}

interface PlatformConfigResponse {
  success?: boolean;
  data?: {
    release_notes?: Partial<ReleaseNotesNotificationConfig> | null;
  };
}

export interface ReleaseUpgradePromptState {
  open: boolean;
  isAdmin: boolean;
  releaseVersion: string | null;
  release: ReleaseNote | null;
  releaseMarkdown: ReleaseMarkdown | null;
  isLoading: boolean;
  isDismissing: boolean;
  skipUntilNextLogin: () => void;
  dismissPermanently: () => Promise<void>;
}

function normalizeVersion(value?: string | null): string | null {
  const version = value?.trim().replace(/^v/, "");
  if (!version) return null;
  return version;
}

function baseVersion(value: string): string {
  return value.trim().replace(/^v/i, "").split(/[-+]/)[0];
}

function resolvePromptVersion(versionInfo: { version?: string; packageVersion?: string } | null): string | null {
  const candidates = [versionInfo?.version, versionInfo?.packageVersion].map(normalizeVersion);
  return (
    candidates.find(
      (version) => version && version !== "unknown" && version !== "0.0.0",
    ) ?? null
  );
}

function sessionSkipKey(version: string): string {
  return `release-notes:${version}:skip`;
}

function notificationsEnabledFromSettings(settings: SettingsResponse | null): boolean {
  // User-scoped opt-out. Defaults to enabled unless the user has explicitly
  // turned release note notifications off for their own account.
  return settings?.data?.preferences?.releaseNotesNotificationsEnabled !== false;
}

function dismissedVersionsFromSettings(settings: SettingsResponse | null): string[] {
  const value = settings?.data?.preferences?.releaseNotesDismissedVersions;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function useReleaseUpgradePrompt(): ReleaseUpgradePromptState {
  const { data: session, status } = useSession();
  const { versionInfo, isLoading: versionLoading } = useVersion();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  // The announcement always targets the currently deployed version.
  const deployedReleaseVersion = useMemo(() => resolvePromptVersion(versionInfo), [versionInfo]);

  const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
  const [release, setRelease] = useState<ReleaseNote | null>(null);
  const [releaseMarkdown, setReleaseMarkdown] = useState<ReleaseMarkdown | null>(null);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dismissedVersions, setDismissedVersions] = useState<string[]>([]);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadPromptData() {
      if (versionLoading || adminLoading || status === "loading") {
        setIsLoading(true);
        return;
      }

      if (status !== "authenticated" || !session) {
        setIsLoading(false);
        setOpen(false);
        setReleaseMarkdown(null);
        return;
      }

      setIsLoading(true);
      try {
        const [settingsResponse, changelogResponse, platformConfigResponse] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/changelog"),
          fetch("/api/admin/platform-config"),
        ]);
        const settingsPayload: SettingsResponse | null = settingsResponse.ok
          ? await settingsResponse.json()
          : null;
        const changelogPayload: ChangelogResponse | null = changelogResponse.ok
          ? await changelogResponse.json()
          : null;
        const platformConfigPayload: PlatformConfigResponse | null = platformConfigResponse.ok
          ? await platformConfigResponse.json()
          : null;

        if (cancelled) return;

        const permanentlyDismissed = dismissedVersionsFromSettings(settingsPayload);
        setDismissedVersions(permanentlyDismissed);

        // Platform-wide switch (admin) AND the per-user opt-out (Admin →
        // General) must both be on, and we must know which version is deployed.
        const platformEnabled = platformConfigPayload?.data?.release_notes?.enabled !== false;
        const userNotificationsEnabled = notificationsEnabledFromSettings(settingsPayload);

        if (!platformEnabled || !userNotificationsEnabled || !deployedReleaseVersion) {
          setReleaseVersion(null);
          setRelease(null);
          setReleaseMarkdown(null);
          setOpen(false);
          return;
        }

        const activeReleaseVersion = deployedReleaseVersion;
        setReleaseVersion(activeReleaseVersion);

        const skippedThisSession =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(sessionSkipKey(activeReleaseVersion)) === "true";
        const permanentlyDismissedVersion = permanentlyDismissed.includes(activeReleaseVersion);

        if (skippedThisSession || permanentlyDismissedVersion) {
          setRelease(null);
          setReleaseMarkdown(null);
          setOpen(false);
          return;
        }

        const matchingRelease =
          changelogPayload?.releases?.find((item) => normalizeVersion(item.version) === activeReleaseVersion) ??
          null;
        setRelease(matchingRelease);

        try {
          const notesResponse = await fetch(
            `/api/release-notes?version=${encodeURIComponent(activeReleaseVersion)}`,
          );
          const notesPayload: ReleaseNotesResponse | null = notesResponse.ok
            ? await notesResponse.json()
            : null;
          if (!cancelled) {
            const hasExactChangelog = Boolean(matchingRelease);
            const hasExactCuratedNotes =
              Boolean(notesPayload?.body) &&
              normalizeVersion(notesPayload?.matchedVersion) === baseVersion(activeReleaseVersion);
            setReleaseMarkdown(
              !hasExactChangelog && hasExactCuratedNotes
                ? {
                    matchedVersion: notesPayload.matchedVersion ?? null,
                    title: notesPayload.title ?? null,
                    date: notesPayload.date ?? null,
                    body: notesPayload.body,
                  }
                : null,
            );
          }
        } catch (notesError) {
          console.warn("[release-upgrade-prompt] Failed to load curated release notes:", notesError);
          if (!cancelled) setReleaseMarkdown(null);
        }

        if (cancelled) return;
        setOpen(true);
      } catch (error) {
        console.warn("[release-upgrade-prompt] Failed to load release prompt data:", error);
        if (!cancelled) {
          setOpen(false);
          setRelease(null);
          setReleaseMarkdown(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadPromptData();

    return () => {
      cancelled = true;
    };
  }, [adminLoading, deployedReleaseVersion, isAdmin, session, status, versionLoading]);

  const skipUntilNextLogin = useCallback(() => {
    if (releaseVersion && typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionSkipKey(releaseVersion), "true");
    }
    setOpen(false);
  }, [releaseVersion]);

  const dismissPermanently = useCallback(async () => {
    if (!releaseVersion) {
      setOpen(false);
      return;
    }

    const nextDismissed = Array.from(new Set([...dismissedVersions, releaseVersion]));
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionSkipKey(releaseVersion), "true");
    }
    setOpen(false);
    setIsDismissing(true);
    try {
      const response = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseNotesDismissedVersions: nextDismissed,
        }),
      });
      if (!response.ok) {
        throw new Error(`Dismissal failed: ${response.status}`);
      }
      setDismissedVersions(nextDismissed);
    } catch (error) {
      console.warn("[release-upgrade-prompt] Failed to persist release dismissal:", error);
    } finally {
      setIsDismissing(false);
    }
  }, [dismissedVersions, releaseVersion]);

  return {
    open,
    isAdmin,
    releaseVersion,
    release,
    releaseMarkdown,
    isLoading,
    isDismissing,
    skipUntilNextLogin,
    dismissPermanently,
  };
}

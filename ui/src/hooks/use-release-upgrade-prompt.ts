"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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

interface MigrationStatusResponse {
  success?: boolean;
  data?: {
    requires_attention?: boolean;
    is_blocking?: boolean;
    needs_version_bootstrap?: boolean;
    pending_required_count?: number;
    blocking_required_count?: number;
    version_bootstrap_required_count?: number;
  };
}

interface SettingsResponse {
  success?: boolean;
  data?: {
    preferences?: {
      releaseNotesDismissedVersions?: unknown;
      releaseNotesDismissedAnnouncementIds?: unknown;
    };
  };
}

interface ChangelogResponse {
  releases?: ReleaseNote[];
}

export interface ReleaseNotesNotificationConfig {
  enabled: boolean;
  release_version: string | null;
  announcement_revision: number;
  announcement_id: string;
  show_toast: boolean;
  toast_duration_ms: number;
  show_migration_cta: boolean;
}

interface PlatformConfigResponse {
  success?: boolean;
  data?: {
    release_notes?: Partial<ReleaseNotesNotificationConfig> | null;
  };
}

export interface ReleaseToastNotification {
  id: string;
  message: string;
  duration: number;
}

export interface ReleaseUpgradePromptState {
  open: boolean;
  isAdmin: boolean;
  releaseVersion: string | null;
  announcementId: string | null;
  release: ReleaseNote | null;
  releaseMarkdown: ReleaseMarkdown | null;
  showMigrationCta: boolean;
  toastNotification: ReleaseToastNotification | null;
  isLoading: boolean;
  isDismissing: boolean;
  markToastShown: () => void;
  openMigrationAssistant: () => void;
  skipUntilNextLogin: () => void;
  dismissPermanently: () => Promise<void>;
}

const MIGRATION_ASSISTANT_HREF = "/admin?cat=security&tab=migrations";

function normalizeVersion(value?: string | null): string | null {
  const version = value?.trim().replace(/^v/, "");
  if (!version) return null;
  return version;
}

function baseVersion(value: string): string {
  return value.trim().replace(/^v/i, "").split(/[-+]/)[0];
}

function migrationStatusNeedsAttention(status: MigrationStatusResponse["data"] | undefined): boolean {
  if (!status) return false;
  return Boolean(
    status.requires_attention ||
      status.is_blocking ||
      status.needs_version_bootstrap ||
      (status.pending_required_count ?? 0) > 0 ||
      (status.blocking_required_count ?? 0) > 0 ||
      (status.version_bootstrap_required_count ?? 0) > 0,
  );
}

function resolvePromptVersion(versionInfo: { version?: string; packageVersion?: string } | null): string | null {
  const candidates = [versionInfo?.version, versionInfo?.packageVersion].map(normalizeVersion);
  return (
    candidates.find(
      (version) => version && version !== "unknown" && version !== "0.0.0",
    ) ?? null
  );
}

function announcementIdFor(version: string, revision: number): string {
  return `${version}:revision-${revision}`;
}

function sessionSkipKey(announcementId: string): string {
  return `release-notes:${announcementId}:skip`;
}

function dismissedVersionsFromSettings(settings: SettingsResponse | null): string[] {
  const value = settings?.data?.preferences?.releaseNotesDismissedVersions;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dismissedAnnouncementIdsFromSettings(settings: SettingsResponse | null): string[] {
  const value = settings?.data?.preferences?.releaseNotesDismissedAnnouncementIds;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeReleaseConfig(
  input: PlatformConfigResponse["data"]["release_notes"] | undefined,
  fallbackVersion: string | null,
): ReleaseNotesNotificationConfig | null {
  const configuredReleaseVersion = normalizeVersion(input?.release_version);
  const releaseVersion = configuredReleaseVersion ?? fallbackVersion;
  if (!releaseVersion) return null;

  const revision = Number.isFinite(Number(input?.announcement_revision))
    ? Math.max(1, Math.floor(Number(input?.announcement_revision)))
    : 1;
  const toastDuration = Number.isFinite(Number(input?.toast_duration_ms))
    ? Math.max(0, Math.floor(Number(input?.toast_duration_ms)))
    : 5000;

  return {
    enabled: input?.enabled !== false,
    release_version: releaseVersion,
    announcement_revision: revision,
    announcement_id:
      configuredReleaseVersion && typeof input?.announcement_id === "string" && input.announcement_id.trim()
        ? input.announcement_id.trim()
        : announcementIdFor(releaseVersion, revision),
    show_toast: input?.show_toast === true,
    toast_duration_ms: toastDuration,
    show_migration_cta: input?.show_migration_cta !== false,
  };
}

export function useReleaseUpgradePrompt(): ReleaseUpgradePromptState {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { versionInfo, isLoading: versionLoading } = useVersion();
  const { isAdmin, loading: adminLoading } = useAdminRole();
  const fallbackReleaseVersion = useMemo(() => resolvePromptVersion(versionInfo), [versionInfo]);

  const [releaseVersion, setReleaseVersion] = useState<string | null>(null);
  const [announcementId, setAnnouncementId] = useState<string | null>(null);
  const [release, setRelease] = useState<ReleaseNote | null>(null);
  const [releaseMarkdown, setReleaseMarkdown] = useState<ReleaseMarkdown | null>(null);
  const [open, setOpen] = useState(false);
  const [showMigrationCta, setShowMigrationCta] = useState(true);
  const [toastNotification, setToastNotification] = useState<ReleaseToastNotification | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dismissedVersions, setDismissedVersions] = useState<string[]>([]);
  const [dismissedAnnouncementIds, setDismissedAnnouncementIds] = useState<string[]>([]);
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
        setToastNotification(null);
        setReleaseMarkdown(null);
        setShowMigrationCta(false);
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
        const dismissedAnnouncements = dismissedAnnouncementIdsFromSettings(settingsPayload);
        setDismissedVersions(permanentlyDismissed);
        setDismissedAnnouncementIds(dismissedAnnouncements);

        const releaseConfig = normalizeReleaseConfig(
          platformConfigPayload?.data?.release_notes,
          fallbackReleaseVersion,
        );

        if (!releaseConfig?.enabled) {
          setReleaseVersion(null);
          setAnnouncementId(null);
          setRelease(null);
          setReleaseMarkdown(null);
          setOpen(false);
          setToastNotification(null);
          setShowMigrationCta(false);
          return;
        }

        const activeReleaseVersion = releaseConfig.release_version;
        const activeAnnouncementId = releaseConfig.announcement_id;
        setReleaseVersion(activeReleaseVersion);
        setAnnouncementId(activeAnnouncementId);

        const hasManagedAnnouncement = Boolean(
          normalizeVersion(platformConfigPayload?.data?.release_notes?.release_version),
        );
        const skippedThisSession =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem(sessionSkipKey(activeAnnouncementId)) === "true";
        const permanentlyDismissedAnnouncement = dismissedAnnouncements.includes(activeAnnouncementId);
        const permanentlyDismissedFallback =
          !hasManagedAnnouncement && permanentlyDismissed.includes(activeReleaseVersion);

        if (skippedThisSession || permanentlyDismissedAnnouncement || permanentlyDismissedFallback) {
          setRelease(null);
          setReleaseMarkdown(null);
          setOpen(false);
          setToastNotification(null);
          setShowMigrationCta(false);
          return;
        }

        const matchingRelease =
          changelogPayload?.releases?.find((item) => normalizeVersion(item.version) === activeReleaseVersion) ??
          null;
        setRelease(matchingRelease);

        let migrationAttention = false;
        if (isAdmin && releaseConfig.show_migration_cta) {
          try {
            const migrationStatusResponse = await fetch("/api/rbac/migration-status");
            const migrationStatusPayload: MigrationStatusResponse | null = migrationStatusResponse.ok
              ? await migrationStatusResponse.json()
              : null;
            migrationAttention = migrationStatusNeedsAttention(migrationStatusPayload?.data);
          } catch (statusError) {
            console.warn("[release-upgrade-prompt] Failed to load migration status:", statusError);
          }
        }
        if (!cancelled) {
          setShowMigrationCta(isAdmin && releaseConfig.show_migration_cta && migrationAttention);
        }

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
        setToastNotification(
          releaseConfig.show_toast
            ? {
                id: activeAnnouncementId,
                message: `Release notes for ${activeReleaseVersion} are available.`,
                duration: releaseConfig.toast_duration_ms,
              }
            : null,
        );
      } catch (error) {
        console.warn("[release-upgrade-prompt] Failed to load release prompt data:", error);
        if (!cancelled) {
          setOpen(false);
          setRelease(null);
          setReleaseMarkdown(null);
          setToastNotification(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadPromptData();

    return () => {
      cancelled = true;
    };
  }, [adminLoading, fallbackReleaseVersion, isAdmin, session, status, versionLoading]);

  const markToastShown = useCallback(() => {
    setToastNotification(null);
  }, []);

  const skipUntilNextLogin = useCallback(() => {
    if (announcementId && typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionSkipKey(announcementId), "true");
    }
    setOpen(false);
    setToastNotification(null);
  }, [announcementId]);

  const openMigrationAssistant = useCallback(() => {
    if (announcementId && typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionSkipKey(announcementId), "true");
    }
    setOpen(false);
    setToastNotification(null);
    router.push(MIGRATION_ASSISTANT_HREF);
  }, [announcementId, router]);

  const dismissPermanently = useCallback(async () => {
    if (!releaseVersion || !announcementId) {
      setOpen(false);
      return;
    }

    const nextDismissed = Array.from(new Set([...dismissedVersions, releaseVersion]));
    const nextDismissedAnnouncements = Array.from(
      new Set([...dismissedAnnouncementIds, announcementId]),
    );
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(sessionSkipKey(announcementId), "true");
    }
    setOpen(false);
    setToastNotification(null);
    setIsDismissing(true);
    try {
      const response = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          releaseNotesDismissedVersions: nextDismissed,
          releaseNotesDismissedAnnouncementIds: nextDismissedAnnouncements,
        }),
      });
      if (!response.ok) {
        throw new Error(`Dismissal failed: ${response.status}`);
      }
      setDismissedVersions(nextDismissed);
      setDismissedAnnouncementIds(nextDismissedAnnouncements);
    } catch (error) {
      console.warn("[release-upgrade-prompt] Failed to persist release dismissal:", error);
    } finally {
      setIsDismissing(false);
    }
  }, [announcementId, dismissedAnnouncementIds, dismissedVersions, releaseVersion]);

  return {
    open,
    isAdmin,
    releaseVersion,
    announcementId,
    release,
    releaseMarkdown,
    showMigrationCta,
    toastNotification,
    isLoading,
    isDismissing,
    markToastShown,
    openMigrationAssistant,
    skipUntilNextLogin,
    dismissPermanently,
  };
}

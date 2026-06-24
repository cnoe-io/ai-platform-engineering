"use client";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Bell,Eye,Loader2 } from "lucide-react";
import { useEffect,useState } from "react";

import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import type { ReleaseMarkdown,ReleaseNote } from "@/hooks/use-release-upgrade-prompt";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";

interface ReleaseNotesSettingsTabProps {
  isAdmin: boolean;
}

function normalizeVersion(value?: string | null): string | null {
  const version = value?.trim().replace(/^v/, "");
  return version || null;
}

function baseVersion(value: string): string {
  return value.trim().replace(/^v/i, "").split(/[-+]/)[0];
}

// One card for everyone: a per-user notification toggle plus a button to
// re-open the release notes popup on demand. Admins get an extra "Admin"
// section with the platform-wide on/off switch.
function ReleaseNotesCard({ isAdmin }: ReleaseNotesSettingsTabProps) {
  // ── Per-user notification preference ──────────────────────────────────────
  // Persists to /api/settings/preferences (user_settings) and never touches
  // the platform-wide admin configuration.
  const [enabled, setEnabled] = useState(true);
  const [savedEnabled, setSavedEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

  // ── Platform-wide switch (admin only) ─────────────────────────────────────
  const [platformEnabled, setPlatformEnabled] = useState(true);
  const [savedPlatformEnabled, setSavedPlatformEnabled] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(isAdmin);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformSaveResult, setPlatformSaveResult] = useState<"success" | "error" | null>(null);

  // ── On-demand release notes popup ─────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewVersion, setPreviewVersion] = useState("current release");
  const [previewRelease, setPreviewRelease] = useState<ReleaseNote | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<ReleaseMarkdown | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((response) => response.json())
      .then((settingsRes) => {
        if (cancelled) return;
        // Defaults to enabled unless the user has explicitly opted out.
        const next = settingsRes?.data?.preferences?.releaseNotesNotificationsEnabled !== false;
        setEnabled(next);
        setSavedEnabled(next);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch("/api/admin/platform-config")
      .then((response) => response.json())
      .then((configRes) => {
        if (cancelled || !configRes.success) return;
        const next = configRes.data?.release_notes?.enabled !== false;
        setPlatformEnabled(next);
        setSavedPlatformEnabled(next);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingConfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const savePreference = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/settings/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ releaseNotesNotificationsEnabled: enabled }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedEnabled(enabled);
        setSaveResult("success");
        setTimeout(() => setSaveResult(null), 3000);
      } else {
        setSaveResult("error");
      }
    } catch {
      setSaveResult("error");
    } finally {
      setSaving(false);
    }
  };

  const savePlatformConfig = async () => {
    setSavingPlatform(true);
    setPlatformSaveResult(null);
    try {
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_notes: { enabled: platformEnabled } }),
      });
      const data = await res.json();
      if (data.success) {
        const persisted = data.data?.release_notes?.enabled !== false;
        setPlatformEnabled(persisted);
        setSavedPlatformEnabled(persisted);
        setPlatformSaveResult("success");
        setTimeout(() => setPlatformSaveResult(null), 3000);
      } else {
        setPlatformSaveResult("error");
      }
    } catch {
      setPlatformSaveResult("error");
    } finally {
      setSavingPlatform(false);
    }
  };

  // Load the real notes for the currently deployed version so the popup shows
  // exactly what users would see (or saw) after login, regardless of whether
  // they previously dismissed it.
  const showReleaseNotesPopup = async () => {
    setPreviewLoading(true);
    setPreviewOpen(true);
    try {
      const [versionRes, changelogRes] = await Promise.all([
        fetch("/api/version"),
        fetch("/api/changelog"),
      ]);
      const versionPayload = versionRes.ok ? await versionRes.json() : null;
      const version =
        normalizeVersion(versionPayload?.version) ??
        normalizeVersion(versionPayload?.packageVersion) ??
        "current release";
      setPreviewVersion(version);

      const changelogPayload = changelogRes.ok ? await changelogRes.json() : null;
      const match: ReleaseNote | null =
        changelogPayload?.releases?.find(
          (item: ReleaseNote) => normalizeVersion(item.version) === version,
        ) ?? null;
      setPreviewRelease(match);

      if (!match) {
        const notesRes = await fetch(`/api/release-notes?version=${encodeURIComponent(version)}`);
        const notesPayload = notesRes.ok ? await notesRes.json() : null;
        const hasExactCuratedNotes =
          Boolean(notesPayload?.body) &&
          normalizeVersion(notesPayload?.matchedVersion) === baseVersion(version);
        setPreviewMarkdown(
          hasExactCuratedNotes
            ? {
                matchedVersion: notesPayload.matchedVersion ?? null,
                title: notesPayload.title ?? null,
                date: notesPayload.date ?? null,
                body: notesPayload.body,
              }
            : null,
        );
      } else {
        setPreviewMarkdown(null);
      }
    } catch {
      // Fall back to the generic dialog content if anything fails.
      setPreviewRelease(null);
      setPreviewMarkdown(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Release notes
        </CardTitle>
        <CardDescription>
          Choose whether to see the release notes notification after you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                data-testid="release-notes-user-pref-toggle"
              />
              Notify me about release notes
            </label>
            <p className="text-xs text-muted-foreground">
              When off, you won&apos;t see the release notes dialog on login.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <SaveButton
                onSave={savePreference}
                saving={saving}
                dirty={enabled !== savedEnabled}
                result={saveResult}
                ariaLabel="Save release notes preference"
                testId="release-notes-user-pref-save"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void showReleaseNotesPopup()}
                disabled={previewLoading}
              >
                {previewLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                Show release notes popup
              </Button>
            </div>
          </>
        )}

        {isAdmin && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Admin
            </p>
            {loadingConfig ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={platformEnabled}
                    onChange={(event) => setPlatformEnabled(event.target.checked)}
                  />
                  Enable release notes notification
                </label>
                <p className="text-xs text-muted-foreground">
                  Platform-wide switch shown to every user after login.
                </p>
                <SaveButton
                  onSave={savePlatformConfig}
                  saving={savingPlatform}
                  dirty={platformEnabled !== savedPlatformEnabled}
                  result={platformSaveResult}
                  ariaLabel="Save release notes settings"
                />
              </>
            )}
          </div>
        )}
      </CardContent>

      <ReleaseUpgradeDialog
        open={previewOpen}
        isAdmin={isAdmin}
        releaseVersion={previewVersion}
        release={previewRelease}
        releaseMarkdown={previewMarkdown}
        onSkipUntilNextLogin={() => setPreviewOpen(false)}
        onDismissPermanently={() => setPreviewOpen(false)}
      />
    </Card>
  );
}

export function ReleaseNotesSettingsTab({ isAdmin }: ReleaseNotesSettingsTabProps) {
  return (
    <div className="space-y-6">
      <ReleaseNotesCard isAdmin={isAdmin} />
    </div>
  );
}

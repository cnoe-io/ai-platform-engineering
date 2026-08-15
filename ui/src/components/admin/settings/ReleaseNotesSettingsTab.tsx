"use client";

import { AdminBadge } from "@/components/admin/shared/AdminBadge";
import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Bell,Eye,Loader2 } from "lucide-react";
import { useEffect,useState } from "react";

import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import {
  hasConfiguredReleaseNotesCompare,
  releaseNotesRequestUrl,
  type ReleaseMarkdown,
  type ReleaseNote,
  type ReleaseNotesNotificationConfig,
} from "@/hooks/use-release-upgrade-prompt";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ReleaseNotesSettingsTabProps {
  isAdmin: boolean;
  readOnly?: boolean;
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
function ReleaseNotesCard({ isAdmin, readOnly = false }: ReleaseNotesSettingsTabProps) {
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
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [savedRepositoryUrl, setSavedRepositoryUrl] = useState("");
  const [previousCommit, setPreviousCommit] = useState("");
  const [savedPreviousCommit, setSavedPreviousCommit] = useState("");
  const [latestCommit, setLatestCommit] = useState("");
  const [savedLatestCommit, setSavedLatestCommit] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingPlatform, setSavingPlatform] = useState(false);
  const [platformSaveResult, setPlatformSaveResult] = useState<"success" | "error" | null>(null);
  const [platformSaveError, setPlatformSaveError] = useState<string | null>(null);

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
    let cancelled = false;
    fetch("/api/admin/platform-config")
      .then((response) => response.json())
      .then((configRes) => {
        if (cancelled || !configRes.success) return;
        const releaseNotesConfig = configRes.data?.release_notes;
        const next = releaseNotesConfig?.enabled !== false;
        const nextRepositoryUrl = releaseNotesConfig?.repository_url?.trim() ?? "";
        const nextPreviousCommit = releaseNotesConfig?.previous_commit?.trim() ?? "";
        const nextLatestCommit = releaseNotesConfig?.latest_commit?.trim() ?? "";
        setPlatformEnabled(next);
        setSavedPlatformEnabled(next);
        setRepositoryUrl(nextRepositoryUrl);
        setSavedRepositoryUrl(nextRepositoryUrl);
        setPreviousCommit(nextPreviousCommit);
        setSavedPreviousCommit(nextPreviousCommit);
        setLatestCommit(nextLatestCommit);
        setSavedLatestCommit(nextLatestCommit);
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
    if (readOnly) return;
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
    if (readOnly) return;
    const nextConfig: ReleaseNotesNotificationConfig = {
      enabled: platformEnabled,
      repository_url: repositoryUrl.trim() || null,
      previous_commit: previousCommit.trim() || null,
      latest_commit: latestCommit.trim() || null,
    };
    const configuredFields = [
      nextConfig.repository_url,
      nextConfig.previous_commit,
      nextConfig.latest_commit,
    ].filter(Boolean).length;
    if (configuredFields !== 0 && configuredFields !== 3) {
      setPlatformSaveResult("error");
      setPlatformSaveError("Set the repository URL and both commits, or leave all three empty.");
      return;
    }
    if (configuredFields === 3) {
      let repositoryIsValid = false;
      try {
        const parsed = new URL(nextConfig.repository_url as string);
        repositoryIsValid =
          parsed.protocol === "https:" &&
          parsed.hostname.toLowerCase() === "github.com" &&
          parsed.pathname.replace(/\.git\/?$/i, "").split("/").filter(Boolean).length === 2 &&
          !parsed.search &&
          !parsed.hash;
      } catch {
        repositoryIsValid = false;
      }
      if (!repositoryIsValid) {
        setPlatformSaveResult("error");
        setPlatformSaveError("Enter an https://github.com/<owner>/<repository> URL.");
        return;
      }
      const commitPattern = /^[0-9a-f]{7,40}$/i;
      if (
        !commitPattern.test(nextConfig.previous_commit as string) ||
        !commitPattern.test(nextConfig.latest_commit as string)
      ) {
        setPlatformSaveResult("error");
        setPlatformSaveError("Enter commit SHAs containing 7 to 40 hexadecimal characters.");
        return;
      }
    }
    setSavingPlatform(true);
    setPlatformSaveResult(null);
    setPlatformSaveError(null);
    try {
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_notes: nextConfig }),
      });
      const data = await res.json();
      if (data.success) {
        const persisted = data.data?.release_notes ?? nextConfig;
        const persistedEnabled = persisted.enabled !== false;
        const persistedRepositoryUrl = persisted.repository_url?.trim() ?? "";
        const persistedPreviousCommit = persisted.previous_commit?.trim() ?? "";
        const persistedLatestCommit = persisted.latest_commit?.trim() ?? "";
        setPlatformEnabled(persistedEnabled);
        setSavedPlatformEnabled(persistedEnabled);
        setRepositoryUrl(persistedRepositoryUrl);
        setSavedRepositoryUrl(persistedRepositoryUrl);
        setPreviousCommit(persistedPreviousCommit);
        setSavedPreviousCommit(persistedPreviousCommit);
        setLatestCommit(persistedLatestCommit);
        setSavedLatestCommit(persistedLatestCommit);
        setPlatformSaveResult("success");
        setTimeout(() => setPlatformSaveResult(null), 3000);
      } else {
        setPlatformSaveResult("error");
        setPlatformSaveError(data.error?.message ?? "Could not save the release notes settings.");
      }
    } catch {
      setPlatformSaveResult("error");
      setPlatformSaveError("Could not save the release notes settings.");
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
      const savedCompareConfig: Partial<ReleaseNotesNotificationConfig> = {
        repository_url: savedRepositoryUrl || null,
        previous_commit: savedPreviousCommit || null,
        latest_commit: savedLatestCommit || null,
      };
      const customCompareConfigured = hasConfiguredReleaseNotesCompare(savedCompareConfig);
      const match: ReleaseNote | null = customCompareConfigured
        ? null
        : changelogPayload?.releases?.find(
            (item: ReleaseNote) => normalizeVersion(item.version) === version,
          ) ?? null;
      setPreviewRelease(match);

      if (!match) {
        const notesRes = await fetch(releaseNotesRequestUrl(version, savedCompareConfig));
        const notesPayload = notesRes.ok ? await notesRes.json() : null;
        const hasExactCuratedNotes =
          Boolean(notesPayload?.body) &&
          (normalizeVersion(notesPayload?.matchedVersion) === version ||
            normalizeVersion(notesPayload?.matchedVersion) === baseVersion(version));
        setPreviewMarkdown(
          hasExactCuratedNotes
            ? {
                matchedVersion: notesPayload.matchedVersion ?? null,
                title: notesPayload.title ?? null,
                date: notesPayload.date ?? null,
                body: notesPayload.body,
                changelogUrl: notesPayload.changelogUrl ?? null,
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
                disabled={readOnly}
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
                disabled={readOnly}
                ariaLabel="Save release notes preference"
                testId="release-notes-user-pref-save"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => void showReleaseNotesPopup()}
                disabled={previewLoading || loadingConfig}
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
            <AdminBadge />
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
                    disabled={readOnly}
                  />
                  Enable release notes notification
                </label>
                <p className="text-xs text-muted-foreground">
                  Platform-wide switch shown to every user after login.
                </p>
                <div className="space-y-3 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Optional GitHub commit diff</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Set all three fields to show changes between two commits. Leave them empty to use the
                      deployed-version release notes. Private repositories require a GitHub token on the UI server.
                    </p>
                  </div>
                  <label className="block space-y-1 text-xs font-medium" htmlFor="release-notes-repository-url">
                    <span>Repository URL</span>
                    <Input
                      id="release-notes-repository-url"
                      value={repositoryUrl}
                      onChange={(event) => setRepositoryUrl(event.target.value)}
                      placeholder="https://github.com/example/repository"
                      disabled={readOnly}
                      spellCheck={false}
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1 text-xs font-medium" htmlFor="release-notes-previous-commit">
                      <span>Previous upgraded commit</span>
                      <Input
                        id="release-notes-previous-commit"
                        value={previousCommit}
                        onChange={(event) => setPreviousCommit(event.target.value)}
                        placeholder="Previous commit SHA"
                        disabled={readOnly}
                        spellCheck={false}
                      />
                    </label>
                    <label className="block space-y-1 text-xs font-medium" htmlFor="release-notes-latest-commit">
                      <span>Latest commit</span>
                      <Input
                        id="release-notes-latest-commit"
                        value={latestCommit}
                        onChange={(event) => setLatestCommit(event.target.value)}
                        placeholder="Latest commit SHA"
                        disabled={readOnly}
                        spellCheck={false}
                      />
                    </label>
                  </div>
                </div>
                {platformSaveError && (
                  <p className="text-xs text-destructive" role="alert">
                    {platformSaveError}
                  </p>
                )}
                <SaveButton
                  onSave={savePlatformConfig}
                  saving={savingPlatform}
                  dirty={
                    platformEnabled !== savedPlatformEnabled ||
                    repositoryUrl !== savedRepositoryUrl ||
                    previousCommit !== savedPreviousCommit ||
                    latestCommit !== savedLatestCommit
                  }
                  result={platformSaveResult}
                  disabled={readOnly}
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

export function ReleaseNotesSettingsTab({ isAdmin, readOnly = false }: ReleaseNotesSettingsTabProps) {
  return (
    <div className="space-y-6">
      <ReleaseNotesCard isAdmin={isAdmin} readOnly={readOnly} />
    </div>
  );
}

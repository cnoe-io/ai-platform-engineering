"use client";

import { SaveButton } from "@/components/admin/shared/SaveButton";
import { Bell,Eye,Loader2 } from "lucide-react";
import { useEffect,useState } from "react";

import { ReleaseUpgradeDialog } from "@/components/release/ReleaseUpgradeDialog";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card";

interface ReleaseNotesSettingsTabProps {
  isAdmin: boolean;
}

interface ReleaseNotesSettings {
  enabled: boolean;
  release_version: string | null;
  announcement_revision: number;
  announcement_id: string;
  show_toast: boolean;
  toast_duration_ms: number;
  show_migration_cta: boolean;
}

function announcementIdFor(releaseVersion: string | null, revision: number): string {
  return `${releaseVersion || "release"}:revision-${revision}`;
}

function normalizeReleaseNotesSettings(
  value: Partial<ReleaseNotesSettings> | null | undefined,
): ReleaseNotesSettings {
  const releaseVersion =
    typeof value?.release_version === "string" && value.release_version.trim()
      ? value.release_version.trim().replace(/^v/, "")
      : null;
  const revision = Number.isFinite(Number(value?.announcement_revision))
    ? Math.max(1, Math.floor(Number(value?.announcement_revision)))
    : 1;
  const toastDuration = Number.isFinite(Number(value?.toast_duration_ms))
    ? Math.max(0, Math.floor(Number(value?.toast_duration_ms)))
    : 5000;

  return {
    enabled: value?.enabled !== false,
    release_version: releaseVersion,
    announcement_revision: revision,
    announcement_id:
      typeof value?.announcement_id === "string" && value.announcement_id.trim()
        ? value.announcement_id.trim()
        : announcementIdFor(releaseVersion, revision),
    show_toast: value?.show_toast === true,
    toast_duration_ms: toastDuration,
    show_migration_cta: value?.show_migration_cta !== false,
  };
}

export function ReleaseNotesSettingsTab({ isAdmin }: ReleaseNotesSettingsTabProps) {
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNotesSettings>(
    normalizeReleaseNotesSettings(null),
  );
  // Last-persisted snapshot, so the Save button can light up only when the
  // form actually diverges from what's stored.
  const [savedReleaseNotes, setSavedReleaseNotes] = useState<ReleaseNotesSettings>(
    normalizeReleaseNotesSettings(null),
  );
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingReleaseNotes, setSavingReleaseNotes] = useState(false);
  const [releaseNotesSaveResult, setReleaseNotesSaveResult] = useState<"success" | "error" | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const releaseNotesDirty =
    JSON.stringify(releaseNotes) !== JSON.stringify(savedReleaseNotes);

  useEffect(() => {
    fetch("/api/admin/platform-config")
      .then((response) => response.json())
      .then((configRes) => {
        if (configRes.success) {
          const loaded = normalizeReleaseNotesSettings(configRes.data.release_notes);
          setReleaseNotes(loaded);
          setSavedReleaseNotes(loaded);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, []);

  const saveReleaseNotes = async (nextSettings: ReleaseNotesSettings = releaseNotes) => {
    if (!isAdmin) return;
    const normalized = normalizeReleaseNotesSettings(nextSettings);
    setSavingReleaseNotes(true);
    setReleaseNotesSaveResult(null);
    try {
      const res = await fetch("/api/admin/platform-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ release_notes: normalized }),
      });
      const data = await res.json();
      if (data.success) {
        const persisted = normalizeReleaseNotesSettings(data.data?.release_notes ?? normalized);
        setReleaseNotes(persisted);
        setSavedReleaseNotes(persisted);
        setReleaseNotesSaveResult("success");
        setTimeout(() => setReleaseNotesSaveResult(null), 3000);
      } else {
        setReleaseNotesSaveResult("error");
      }
    } catch {
      setReleaseNotesSaveResult("error");
    } finally {
      setSavingReleaseNotes(false);
    }
  };

  const updateReleaseNotes = (patch: Partial<ReleaseNotesSettings>) => {
    setReleaseNotes((current) => normalizeReleaseNotesSettings({ ...current, ...patch }));
  };

  const showOnNextLoginForEveryone = async () => {
    const nextRevision = releaseNotes.announcement_revision + 1;
    const nextSettings = normalizeReleaseNotesSettings({
      ...releaseNotes,
      announcement_revision: nextRevision,
      announcement_id: announcementIdFor(releaseNotes.release_version, nextRevision),
    });
    await saveReleaseNotes(nextSettings);
  };

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Release notes
          </CardTitle>
          <CardDescription>
            Manage the release notes notification shown after login. Bump the announcement
            revision when you want every user to see it again until they dismiss it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={releaseNotes.enabled}
              onChange={(event) => updateReleaseNotes({ enabled: event.target.checked })}
              disabled={!isAdmin}
            />
            Enable release notes notification
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="release-notes-version" className="text-sm font-medium">
                Active release version
              </label>
              <input
                id="release-notes-version"
                value={releaseNotes.release_version ?? ""}
                onChange={(event) =>
                  updateReleaseNotes({
                    release_version: event.target.value || null,
                    announcement_id: announcementIdFor(
                      event.target.value || null,
                      releaseNotes.announcement_revision,
                    ),
                  })
                }
                placeholder="0.5.1"
                disabled={!isAdmin}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="release-notes-revision" className="text-sm font-medium">
                Announcement revision
              </label>
              <input
                id="release-notes-revision"
                type="number"
                min={1}
                value={releaseNotes.announcement_revision}
                onChange={(event) => {
                  const revision = Math.max(1, Number(event.target.value) || 1);
                  updateReleaseNotes({
                    announcement_revision: revision,
                    announcement_id: announcementIdFor(releaseNotes.release_version, revision),
                  });
                }}
                disabled={!isAdmin}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={releaseNotes.show_toast}
                onChange={(event) => updateReleaseNotes({ show_toast: event.target.checked })}
                disabled={!isAdmin}
              />
              Show toast reminder
            </label>

            <div className="space-y-2">
              <label htmlFor="release-notes-toast-duration" className="text-sm font-medium">
                Toast duration
              </label>
              <input
                id="release-notes-toast-duration"
                type="number"
                min={0}
                step={1000}
                value={releaseNotes.toast_duration_ms}
                onChange={(event) =>
                  updateReleaseNotes({
                    toast_duration_ms: Math.max(0, Number(event.target.value) || 0),
                  })
                }
                disabled={!isAdmin || !releaseNotes.show_toast}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
              <p className="text-xs text-muted-foreground">Use 0 for a sticky toast.</p>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={releaseNotes.show_migration_cta}
              onChange={(event) => updateReleaseNotes({ show_migration_cta: event.target.checked })}
              disabled={!isAdmin}
            />
            Show admin migration assistant CTA
          </label>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Current announcement ID: <code>{releaseNotes.announcement_id}</code>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <SaveButton
                onSave={() => saveReleaseNotes()}
                saving={savingReleaseNotes}
                dirty={releaseNotesDirty}
                result={releaseNotesSaveResult}
                ariaLabel="Save release notes settings"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="h-3.5 w-3.5" />
                Show preview
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void showOnNextLoginForEveryone()}
                disabled={savingReleaseNotes}
              >
                Show this on next login for every user
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ReleaseUpgradeDialog
        open={previewOpen}
        isAdmin
        releaseVersion={releaseNotes.release_version || "current release"}
        release={null}
        onOpenMigrationAssistant={() => setPreviewOpen(false)}
        onSkipUntilNextLogin={() => setPreviewOpen(false)}
        onDismissPermanently={() => setPreviewOpen(false)}
        showMigrationCta={releaseNotes.show_migration_cta}
      />
    </div>
  );
}

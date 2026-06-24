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
}

function normalizeReleaseNotesSettings(
  value: Partial<ReleaseNotesSettings> | null | undefined,
): ReleaseNotesSettings {
  return {
    enabled: value?.enabled !== false,
  };
}

// ── Per-user release notes notification preference ──────────────────────────
// Every user (admin or not) can turn the post-login release notes
// notification on/off for THEIR OWN account. This persists to
// /api/settings/preferences (user_settings) and never touches the
// platform-wide admin configuration.
function UserReleaseNotesPreferenceCard() {
  const [enabled, setEnabled] = useState(true);
  const [savedEnabled, setSavedEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          Release notes
        </CardTitle>
        <CardDescription>
          Choose whether to see the release notes notification after you sign in. This
          preference applies to your account only.
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
            <div className="pt-1">
              <SaveButton
                onSave={savePreference}
                saving={saving}
                dirty={enabled !== savedEnabled}
                result={saveResult}
                ariaLabel="Save release notes preference"
                testId="release-notes-user-pref-save"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Platform-wide release notes configuration (admin only) ──────────────────
function AdminReleaseNotesConfigCard() {
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

  if (loadingConfig) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-muted-foreground" />
            Release notes configuration
          </CardTitle>
          <CardDescription>
            Platform-wide switch for the release notes notification shown to every user
            after login. The announcement always targets the currently deployed version,
            and each user can dismiss it for good.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={releaseNotes.enabled}
              onChange={(event) => updateReleaseNotes({ enabled: event.target.checked })}
            />
            Enable release notes notification
          </label>

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
          </div>
        </CardContent>
      </Card>

      <ReleaseUpgradeDialog
        open={previewOpen}
        isAdmin
        releaseVersion="current release"
        release={null}
        onSkipUntilNextLogin={() => setPreviewOpen(false)}
        onDismissPermanently={() => setPreviewOpen(false)}
      />
    </>
  );
}

export function ReleaseNotesSettingsTab({ isAdmin }: ReleaseNotesSettingsTabProps) {
  return (
    <div className="space-y-6">
      {/* Per-user preference — visible to every user. */}
      <UserReleaseNotesPreferenceCard />

      {/* Platform-wide configuration — admin only. */}
      {isAdmin && <AdminReleaseNotesConfigCard />}
    </div>
  );
}

"use client";

import { ReleaseNotesPreview } from "@/components/settings/ReleaseNotesPreview";
import { AutoSaveStatus } from "@/components/settings/shared/AutoSaveStatus";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsSwitch } from "@/components/settings/shared/SettingsSwitch";
import { useKeyedAutoSave } from "@/hooks/use-keyed-auto-save";
import { Bell,Loader2 } from "lucide-react";
import { useEffect,useRef,useState } from "react";

type NotificationKey = "release-notes";

async function persistReleaseNotesPreference(_: NotificationKey,value: boolean): Promise<void> {
  const response = await fetch("/api/settings/preferences",{
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ releaseNotesNotificationsEnabled: value }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Could not save the release-notes preference");
  }
}

export function NotificationsSettings(): React.ReactElement {
  const [enabled,setEnabled] = useState(true);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState<string | null>(null);
  const committedRef = useRef(true);
  const autoSave = useKeyedAutoSave<NotificationKey,boolean>({
    persist: persistReleaseNotesPreference,
    onSuccess: (_,value) => {
      committedRef.current = value;
    },
    onError: () => {
      setEnabled(committedRef.current);
    },
  });

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load notification preferences");
        }
        if (cancelled) return;
        const value = data.data?.preferences?.releaseNotesNotificationsEnabled !== false;
        committedRef.current = value;
        setEnabled(value);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLoadError(reason instanceof Error ? reason.message : "Could not load notification preferences");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (value: boolean) => {
    setEnabled(value);
    autoSave.enqueue("release-notes",value);
  };
  const retry = () => {
    const pendingValue = autoSave.pendingValueFor("release-notes");
    if (pendingValue !== undefined) setEnabled(pendingValue);
    autoSave.retry("release-notes");
  };

  return (
    <SettingsCard
      description="Choose whether CAIPE announces a new release after you sign in."
      title={<span className="flex items-center gap-2"><Bell className="h-5 w-5 text-primary" />Release notes</span>}
    >
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading notification preferences…
        </div>
      ) : (
        <div className="space-y-4">
          {loadError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {loadError}
            </div>
          ) : null}
          <div className="flex items-center gap-4 rounded-lg border border-border/70 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Notify me about new releases</p>
              <p className="text-xs text-muted-foreground">
                Turning this off hides the release-notes dialog at login. You can still open it here.
              </p>
              <AutoSaveStatus
                className="mt-1"
                onRetry={retry}
                state={autoSave.stateFor("release-notes")}
              />
            </div>
            <SettingsSwitch
              checked={enabled}
              label="Notify me about new releases"
              onCheckedChange={change}
              testId="release-notes-user-pref-toggle"
            />
          </div>
          <ReleaseNotesPreview isAdmin={false} />
        </div>
      )}
    </SettingsCard>
  );
}

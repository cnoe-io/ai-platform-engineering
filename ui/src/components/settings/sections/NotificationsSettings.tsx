"use client";

import { ReleaseNotesPreview } from "@/components/settings/ReleaseNotesPreview";
import { AutoSaveStatus } from "@/components/settings/shared/AutoSaveStatus";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsSwitch } from "@/components/settings/shared/SettingsSwitch";
import { useKeyedAutoSave } from "@/hooks/use-keyed-auto-save";
import { Activity,Bell,Loader2 } from "lucide-react";
import { useEffect,useRef,useState } from "react";

type NotificationKey = "release-notes" | "platform-health";
type NotificationValues = Record<NotificationKey,boolean>;

async function persistNotificationPreference(key: NotificationKey,value: boolean): Promise<void> {
  const releaseNotes = key === "release-notes";
  const response = await fetch(
    releaseNotes ? "/api/settings/preferences" : "/api/settings/notifications",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        releaseNotes
          ? { releaseNotesNotificationsEnabled: value }
          : { platform_health: value },
      ),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.error || "Could not save the notification preference");
  }
}

export function NotificationsSettings(): React.ReactElement {
  const [values,setValues] = useState<NotificationValues>({
    "release-notes": true,
    "platform-health": true,
  });
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState<string | null>(null);
  const committedRef = useRef<NotificationValues>(values);
  const autoSave = useKeyedAutoSave<NotificationKey,boolean>({
    persist: persistNotificationPreference,
    onSuccess: (key,value) => {
      committedRef.current = { ...committedRef.current,[key]: value };
      if (key === "platform-health") {
        window.dispatchEvent(new CustomEvent("in-app-notifications:refresh"));
      }
    },
    onError: (key) => {
      setValues((current) => ({ ...current,[key]: committedRef.current[key] }));
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
        const nextValues: NotificationValues = {
          "release-notes": data.data?.preferences?.releaseNotesNotificationsEnabled !== false,
          "platform-health": data.data?.notifications?.platform_health !== false,
        };
        committedRef.current = nextValues;
        setValues(nextValues);
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

  const change = (key: NotificationKey,value: boolean) => {
    setValues((current) => ({ ...current,[key]: value }));
    autoSave.enqueue(key,value);
  };
  const retry = (key: NotificationKey) => {
    const pendingValue = autoSave.pendingValueFor(key);
    if (pendingValue !== undefined) {
      setValues((current) => ({ ...current,[key]: pendingValue }));
    }
    autoSave.retry(key);
  };

  return (
    <div className="space-y-4">
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
                  onRetry={() => retry("release-notes")}
                  state={autoSave.stateFor("release-notes")}
                />
              </div>
              <SettingsSwitch
                checked={values["release-notes"]}
                label="Notify me about new releases"
                onCheckedChange={(value) => change("release-notes",value)}
                testId="release-notes-user-pref-toggle"
              />
            </div>
            <ReleaseNotesPreview isAdmin={false} />
          </div>
        )}
      </SettingsCard>
      <SettingsCard
        description="Choose whether global platform incidents appear in your personal notification feed."
        title={<span className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" />Platform health</span>}
      >
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notification preferences…
          </div>
        ) : (
          <div className="flex items-center gap-4 rounded-lg border border-border/70 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Notify me about platform health</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Show verified service degradations and recoveries in your notification bell. Turning this off only hides Platform messages for you; health monitoring and the global incident lifecycle continue unchanged.
              </p>
              <AutoSaveStatus
                className="mt-1"
                onRetry={() => retry("platform-health")}
                state={autoSave.stateFor("platform-health")}
              />
            </div>
            <SettingsSwitch
              checked={values["platform-health"]}
              label="Notify me about platform health"
              onCheckedChange={(value) => change("platform-health",value)}
              testId="platform-health-user-pref-toggle"
            />
          </div>
        )}
      </SettingsCard>
    </div>
  );
}

"use client";

import { ReleaseNotesPreview } from "@/components/settings/ReleaseNotesPreview";
import { AutoSaveStatus } from "@/components/settings/shared/AutoSaveStatus";
import { SettingsCard } from "@/components/settings/shared/SettingsCard";
import { SettingsSwitch } from "@/components/settings/shared/SettingsSwitch";
import { Button } from "@/components/ui/button";
import { useKeyedAutoSave } from "@/hooks/use-keyed-auto-save";
import { useAdminRole } from "@/hooks/use-admin-role";
import { Activity,Bell,ChevronsDownUp,ChevronsUpDown,Loader2 } from "lucide-react";
import { useEffect,useRef,useState } from "react";

type NotificationKey = "release-notes" | "platform-health";
type NotificationValues = Record<NotificationKey,boolean>;
type NotificationSection = "release-notes" | "platform-health";

const NOTIFICATION_SECTIONS: NotificationSection[] = ["release-notes","platform-health"];

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
  const { isAdmin } = useAdminRole();
  const visibleSections: NotificationSection[] = isAdmin
    ? NOTIFICATION_SECTIONS
    : ["release-notes"];
  const [values,setValues] = useState<NotificationValues>({
    "release-notes": true,
    "platform-health": true,
  });
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState<string | null>(null);
  const [expandedSections,setExpandedSections] = useState<Set<NotificationSection>>(
    () => new Set(NOTIFICATION_SECTIONS),
  );
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
  const setSectionExpanded = (section: NotificationSection,expanded: boolean): void => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (expanded) next.add(section);
      else next.delete(section);
      return next;
    });
  };
  const expandedVisibleSections = visibleSections.filter((section) => expandedSections.has(section));
  const allExpanded = expandedVisibleSections.length === visibleSections.length;
  const allCollapsed = expandedVisibleSections.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          disabled={allExpanded}
          onClick={() => setExpandedSections(new Set(visibleSections))}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronsUpDown className="mr-2 h-4 w-4" />Expand all
        </Button>
        <Button
          disabled={allCollapsed}
          onClick={() => setExpandedSections(new Set())}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ChevronsDownUp className="mr-2 h-4 w-4" />Collapse all
        </Button>
      </div>
      <SettingsCard
        collapsibleLabel="Release notes"
        description="Choose whether CAIPE announces a new release after you sign in."
        expanded={expandedSections.has("release-notes")}
        onExpandedChange={(expanded) => setSectionExpanded("release-notes",expanded)}
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
      {isAdmin ? <SettingsCard
        collapsibleLabel="Platform health"
        description="Choose whether global platform incidents appear in your personal notification feed."
        expanded={expandedSections.has("platform-health")}
        onExpandedChange={(expanded) => setSectionExpanded("platform-health",expanded)}
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
      </SettingsCard> : null}
    </div>
  );
}

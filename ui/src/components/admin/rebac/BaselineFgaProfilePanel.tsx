"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface BaselineGrantDefinition {
  id: string;
  label: string;
  description: string;
}

interface BaselineProfile {
  member_grants: string[];
  admin_grants: string[];
  updated_at?: string;
  updated_by?: string;
  source?: "default" | "mongo";
}

interface BaselineProfileResponse {
  profile: BaselineProfile;
  available_grants: {
    member: BaselineGrantDefinition[];
    admin: BaselineGrantDefinition[];
  };
  reconciliation?: {
    mode: "none" | "user" | "all";
    user_count: number;
    writes: number;
    deletes: number;
  };
}

function apiData<T>(payload: unknown): T {
  const value = payload as { data?: T };
  return value.data as T;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function BaselineFgaProfilePanel({ isAdmin }: { isAdmin: boolean }) {
  const [profile, setProfile] = useState<BaselineProfile | null>(null);
  const [memberGrants, setMemberGrants] = useState<BaselineGrantDefinition[]>([]);
  const [adminGrants, setAdminGrants] = useState<BaselineGrantDefinition[]>([]);
  const [selectedMemberGrant, setSelectedMemberGrant] = useState("");
  const [selectedAdminGrant, setSelectedAdminGrant] = useState("");
  const [applyAll, setApplyAll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadProfile() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/admin/openfga/baseline-profile");
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || `Baseline profile failed: ${response.status}`);
        const data = apiData<BaselineProfileResponse>(payload);
        if (cancelled) return;
        setProfile(data.profile);
        setMemberGrants(data.available_grants.member);
        setAdminGrants(data.available_grants.admin);
        setSelectedMemberGrant(data.available_grants.member[0]?.id ?? "");
        setSelectedAdminGrant(data.available_grants.admin[0]?.id ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load baseline profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMemberEnabled = useMemo(
    () => Boolean(profile?.member_grants.includes(selectedMemberGrant)),
    [profile, selectedMemberGrant],
  );
  const selectedAdminEnabled = useMemo(
    () => Boolean(profile?.admin_grants.includes(selectedAdminGrant)),
    [profile, selectedAdminGrant],
  );

  function toggleGrant(type: "member" | "admin", grantId: string) {
    if (!profile || !grantId || !isAdmin) return;
    setProfile((current) => {
      if (!current) return current;
      const key = type === "member" ? "member_grants" : "admin_grants";
      const currentValues = current[key];
      const nextValues = currentValues.includes(grantId)
        ? currentValues.filter((id) => id !== grantId)
        : sortedUnique([...currentValues, grantId]);
      return { ...current, [key]: nextValues };
    });
    setMessage(null);
  }

  async function saveProfile() {
    if (!profile || !isAdmin) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/openfga/baseline-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          member_grants: profile.member_grants,
          admin_grants: profile.admin_grants,
          apply: { mode: applyAll ? "all" : "none" },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Baseline profile save failed: ${response.status}`);
      const data = apiData<BaselineProfileResponse>(payload);
      setProfile(data.profile);
      if (data.available_grants.member.length > 0) setMemberGrants(data.available_grants.member);
      if (data.available_grants.admin.length > 0) setAdminGrants(data.available_grants.admin);
      if (data.reconciliation?.mode === "all") {
        setMessage(
          `Applied to ${data.reconciliation.user_count} user(s): ${data.reconciliation.writes} writes, ${data.reconciliation.deletes} deletes.`,
        );
      } else {
        setMessage("Baseline profile saved. New logins will use this profile.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save baseline profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Baseline FGA</CardTitle>
            <CardDescription>
              Configure the baseline OpenFGA grants applied to non-admin members and admins.
            </CardDescription>
          </div>
          {profile?.source && (
            <Badge variant="outline">{profile.source === "mongo" ? "Saved profile" : "Default profile"}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading baseline profile...
          </div>
        )}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4" />
            {error}
          </div>
        )}
        {message && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4" />
            {message}
          </div>
        )}
        {profile && (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <GrantMenu
                title="Non-admin baseline"
                description="Read and self-service access every authorized non-admin receives."
                label="Non-admin baseline grant menu"
                grants={memberGrants}
                selectedGrant={selectedMemberGrant}
                selectedEnabled={selectedMemberEnabled}
                selectedGrantIds={profile.member_grants}
                disabled={!isAdmin}
                onSelectedGrant={setSelectedMemberGrant}
                onToggle={() => toggleGrant("member", selectedMemberGrant)}
              />
              <GrantMenu
                title="Admin baseline"
                description="Management access added when the user is an administrator."
                label="Admin baseline grant menu"
                grants={adminGrants}
                selectedGrant={selectedAdminGrant}
                selectedEnabled={selectedAdminEnabled}
                selectedGrantIds={profile.admin_grants}
                disabled={!isAdmin}
                onSelectedGrant={setSelectedAdminGrant}
                onToggle={() => toggleGrant("admin", selectedAdminGrant)}
              />
            </div>
            <div className="flex flex-col gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={applyAll}
                  disabled={!isAdmin || saving}
                  onChange={(event) => setApplyAll(event.target.checked)}
                />
                <span>
                  Apply to all known users when saving
                  <span className="block text-xs text-muted-foreground">
                    Saving always affects future logins. This option also reconciles current user tuples immediately.
                  </span>
                </span>
              </label>
              <Button onClick={saveProfile} disabled={!isAdmin || saving} className="gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save baseline profile
              </Button>
            </div>
            {!isAdmin && (
              <p className="text-sm text-muted-foreground">
                Only admins can update and reconcile baseline grants.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GrantMenu({
  title,
  description,
  label,
  grants,
  selectedGrant,
  selectedEnabled,
  selectedGrantIds,
  disabled,
  onSelectedGrant,
  onToggle,
}: {
  title: string;
  description: string;
  label: string;
  grants: BaselineGrantDefinition[];
  selectedGrant: string;
  selectedEnabled: boolean;
  selectedGrantIds: string[];
  disabled: boolean;
  onSelectedGrant: (grantId: string) => void;
  onToggle: () => void;
}) {
  const selected = grants.find((grant) => grant.id === selectedGrant);
  const actionLabel = `${selectedEnabled ? "Remove" : "Add"} ${label.startsWith("Non-admin") ? "non-admin" : "admin"} grant`;
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div>
        <Label htmlFor={label}>{label}</Label>
        <select
          id={label}
          aria-label={label}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={selectedGrant}
          disabled={disabled}
          onChange={(event) => onSelectedGrant(event.target.value)}
        >
          {grants.map((grant) => (
            <option key={grant.id} value={grant.id}>
              {grant.label}
            </option>
          ))}
        </select>
      </div>
      {selected && (
        <div className="rounded-md bg-muted/30 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{selected.label}</span>
            <Badge variant={selectedEnabled ? "default" : "outline"}>
              {selectedEnabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>
        </div>
      )}
      <Button type="button" variant="outline" disabled={disabled || !selectedGrant} onClick={onToggle}>
        {actionLabel}
      </Button>
      <div className="max-h-32 space-y-1 overflow-auto rounded-md border bg-background p-2">
        {selectedGrantIds.length === 0 ? (
          <p className="text-xs text-muted-foreground">No grants enabled.</p>
        ) : (
          selectedGrantIds.map((grantId) => (
            <code key={grantId} className="block text-xs">
              {grantId}
            </code>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import { Loader2, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { UserEmailPicker } from "@/components/ui/user-email-picker";
import { useToast } from "@/components/ui/toast";

interface TomeAdminMember {
  subject: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_current_user: boolean;
}

function initials(member: TomeAdminMember): string {
  const value = member.name || member.email || member.subject;
  const parts = value.trim().split(/\s+/);
  return parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : value.slice(0, 2).toUpperCase();
}

export function TomeAdminsTab() {
  const { toast } = useToast();
  const [admins, setAdmins] = useState<TomeAdminMember[]>([]);
  const [selectedEmail, setSelectedEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingSubject, setRemovingSubject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/users");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to load Tome admins");
      setAdmins(body.admins ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addAdmin = async () => {
    if (!selectedEmail) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/tome/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: selectedEmail }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to add Tome admin");
      setSelectedEmail("");
      await load();
      toast(`${body.admin?.email ?? "User"} is now a Tome admin`, "success");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeAdmin = async (admin: TomeAdminMember) => {
    const label = admin.name || admin.email || admin.subject;
    if (!window.confirm(`Remove Tome admin access from ${label}?`)) return;
    setRemovingSubject(admin.subject);
    setError(null);
    try {
      const response = await fetch(
        `/api/tome/admin/users/${encodeURIComponent(admin.subject)}`,
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Failed to remove Tome admin");
      setAdmins((current) => current.filter((member) => member.subject !== admin.subject));
      toast(`Removed Tome admin access from ${label}`, "success");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setRemovingSubject(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Tome administrators</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tome admins can reorder BHAGs, edit page templates, view analytics, and manage this
          list. Platform administrators inherit Tome access and are not listed unless they also
          have a direct grant. Direct grants without a signed-in CAIPE profile remain active but
          are hidden from this list.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Add a Tome admin</h3>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="min-w-0 flex-1">
            <UserEmailPicker
              value={selectedEmail}
              onChange={setSelectedEmail}
              placeholder="Search for a user"
              disabled={saving}
            />
          </div>
          <Button onClick={addAdmin} disabled={!selectedEmail || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add admin
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A user must have signed in to CAIPE at least once before they can be added.
        </p>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <h3 className="text-sm font-medium">Direct Tome admins</h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading administrators…
          </div>
        ) : admins.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No direct Tome admin grants. Platform administrators still retain inherited access.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {admins.map((admin) => {
              const cannotRemove = admin.is_current_user || admins.length <= 1;
              return (
                <li key={admin.subject} className="flex items-center gap-3 px-4 py-3">
                  {admin.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={admin.avatar_url}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {initials(admin)}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {admin.name || admin.email || "Unknown user"}
                      {admin.is_current_user && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                          You
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {admin.email || admin.subject}
                    </p>
                  </div>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={cannotRemove || removingSubject === admin.subject}
                    onClick={() => void removeAdmin(admin)}
                    title={
                      admin.is_current_user
                        ? "You cannot remove your own access"
                        : admins.length <= 1
                          ? "At least one direct Tome admin must remain"
                          : `Remove ${admin.name || admin.email || admin.subject}`
                    }
                  >
                    {removingSubject === admin.subject ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

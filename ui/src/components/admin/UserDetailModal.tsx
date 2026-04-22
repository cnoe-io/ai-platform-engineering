"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";

export interface UserDetailModalProps {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}

type RealmRoleRow = { id: string; name: string; description?: string };

type ProfileUser = {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  createdAt?: number | null;
  attributes: Record<string, string[]>;
  slackLinkStatus: "linked" | "unlinked";
  realmRoles: RealmRoleRow[];
  sessions: Array<{
    id: string;
    start?: number;
    lastAccess?: number;
  }>;
  federatedIdentities: Array<{
    identityProvider: string;
    userId: string;
    userName: string;
  }>;
  teams: Array<{ team_id: string; tenant_id: string }>;
  lastAccess: number | null;
};

function parseKbRoles(
  roles: RealmRoleRow[]
): Array<{ kbId: string; scope: string }> {
  const out: Array<{ kbId: string; scope: string }> = [];
  for (const r of roles) {
    const m = r.name.match(/^kb_(reader|ingestor|admin):(.+)$/);
    if (m) {
      const scope =
        m[1] === "reader" ? "reader" : m[1] === "ingestor" ? "ingestor" : "admin";
      out.push({ kbId: m[2], scope });
    }
  }
  return out;
}

function parseAgentRoles(
  roles: RealmRoleRow[]
): Array<{ agentId: string; scope: string }> {
  const out: Array<{ agentId: string; scope: string }> = [];
  for (const r of roles) {
    const m = r.name.match(/^agent_(user|admin):(.+)$/);
    if (m) {
      out.push({ agentId: m[2], scope: m[1] === "user" ? "user" : "admin" });
    }
  }
  return out;
}

function formatTs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function UserDetailModal({
  userId,
  onClose,
  onSaved,
}: UserDetailModalProps) {
  const { update: updateSession } = useSession();
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<ProfileUser | null>(null);
  const [allRealmRoles, setAllRealmRoles] = useState<RealmRoleRow[]>([]);
  const [teamOptions, setTeamOptions] = useState<
    Array<{ teamId: string; label: string }>
  >([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    setLoadError(null);
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`);
    const json = (await readJson(res)) as {
      success?: boolean;
      data?: { user?: ProfileUser };
      error?: string;
    } | null;
    if (!res.ok || !json?.success || !json.data?.user) {
      throw new Error(
        (json && typeof json === "object" && "error" in json && json.error
          ? String(json.error)
          : null) || `Failed to load user (${res.status})`
      );
    }
    setUser(json.data.user);
  }, [userId]);

  const loadRolesAndTeams = useCallback(async () => {
    const [rolesRes, teamsRes] = await Promise.all([
      fetch("/api/admin/roles"),
      fetch("/api/admin/teams"),
    ]);

    const rolesJson = (await readJson(rolesRes)) as {
      success?: boolean;
      data?: { roles?: RealmRoleRow[] };
    } | null;
    if (rolesRes.ok && rolesJson?.success && Array.isArray(rolesJson.data?.roles)) {
      setAllRealmRoles(rolesJson.data.roles);
    } else {
      setAllRealmRoles([]);
    }

    const teamsJson = (await readJson(teamsRes)) as {
      success?: boolean;
      data?: { teams?: Array<{ name?: string }> };
    } | null;
    if (
      teamsRes.ok &&
      teamsJson?.success &&
      Array.isArray(teamsJson.data?.teams)
    ) {
      setTeamOptions(
        teamsJson.data.teams
          .map((t) => {
            const name = typeof t.name === "string" ? t.name.trim() : "";
            if (!name) return null;
            return { teamId: name, label: name };
          })
          .filter((x): x is { teamId: string; label: string } => x != null)
      );
    } else {
      setTeamOptions([]);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await Promise.all([refreshProfile(), loadRolesAndTeams()]);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Load failed");
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshProfile, loadRolesAndTeams]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setActionError(null);
      setBusy(key);
      try {
        await fn();
        await refreshProfile();
        onSaved();
        // Force-refresh the current user's access token so the RAG server
        // (and other services) pick up the updated Keycloak realm roles
        // immediately instead of waiting for the token to expire.
        void updateSession({ forceRefresh: true });
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setBusy(null);
      }
    },
    [refreshProfile, onSaved, updateSession]
  );

  const fullName = useMemo(() => {
    if (!user) return "";
    const a = user.firstName.trim();
    const b = user.lastName.trim();
    const combined = `${a} ${b}`.trim();
    return combined || user.username || user.email || "User";
  }, [user]);

  const initials = useMemo(() => {
    if (!user) return "?";
    const parts = [user.firstName.trim(), user.lastName.trim()].filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    if (parts.length === 1 && parts[0].length >= 2) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    const src = user.email || user.username || "?";
    const alnum = src.replace(/[^a-zA-Z0-9]/g, "");
    return (alnum.slice(0, 2) || "?").toUpperCase();
  }, [user]);

  const assignedRoleNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of user?.realmRoles ?? []) s.add(r.name);
    return s;
  }, [user]);

  const addableRoles = useMemo(() => {
    return allRealmRoles
      .filter((r) => !assignedRoleNames.has(r.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allRealmRoles, assignedRoleNames]);

  const kbRows = useMemo(
    () => parseKbRoles(user?.realmRoles ?? []),
    [user?.realmRoles]
  );
  const agentRows = useMemo(
    () => parseAgentRoles(user?.realmRoles ?? []),
    [user?.realmRoles]
  );

  const memberTeamIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of user?.teams ?? []) s.add(t.team_id);
    return s;
  }, [user?.teams]);

  const addableTeams = useMemo(() => {
    return teamOptions.filter((t) => !memberTeamIds.has(t.teamId));
  }, [teamOptions, memberTeamIds]);

  const idpLabel = useMemo(() => {
    const feds = user?.federatedIdentities ?? [];
    if (feds.length === 0) return "Local";
    return feds.map((f) => f.identityProvider).join(", ") || "Local";
  }, [user?.federatedIdentities]);

  const slackUserId = user?.attributes?.slack_user_id?.[0]?.trim() ?? "";

  const lastLoginLabel =
    user?.lastAccess != null && user.lastAccess > 0
      ? formatTs(user.lastAccess)
      : "Never";

  const createdLabel =
    user?.createdAt != null && user.createdAt > 0
      ? formatTs(user.createdAt)
      : "—";

  const toggleEnabled = () => {
    if (!user) return;
    const next = !user.enabled;
    void runAction("enabled", async () => {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await readJson(res)) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Update failed (${res.status})`);
      }
    });
  };

  const removeRole = (name: string) => {
    void runAction(`role-del-${name}`, async () => {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/roles`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: [{ name }] }),
        }
      );
      const json = (await readJson(res)) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Remove role failed (${res.status})`);
      }
    });
  };

  const addRole = (name: string) => {
    if (!name) return;
    void runAction(`role-add-${name}`, async () => {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/roles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roles: [{ name }] }),
        }
      );
      const json = (await readJson(res)) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Add role failed (${res.status})`);
      }
    });
  };

  const removeTeam = (teamId: string) => {
    void runAction(`team-del-${teamId}`, async () => {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/teams`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId }),
        }
      );
      const json = (await readJson(res)) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Remove team failed (${res.status})`);
      }
    });
  };

  const addTeam = (teamId: string) => {
    if (!teamId) return;
    void runAction(`team-add-${teamId}`, async () => {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/teams`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId }),
        }
      );
      const json = (await readJson(res)) as { success?: boolean; error?: string };
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Add team failed (${res.status})`);
      }
    });
  };

  const modalInner = (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 text-neutral-900 dark:text-neutral-100"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-detail-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-neutral-500 dark:text-neutral-400">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            <span className="text-sm">Loading user…</span>
          </div>
        ) : loadError ? (
          <div className="space-y-4">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <button
              type="button"
              className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : user ? (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-neutral-200 dark:border-neutral-700 pb-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-200 dark:bg-neutral-700 text-sm font-semibold text-neutral-700 dark:text-neutral-200"
                  aria-hidden
                >
                  {initials}
                </div>
                <div className="min-w-0">
                  <h2
                    id="user-detail-modal-title"
                    className="text-lg font-semibold truncate"
                  >
                    {fullName}
                  </h2>
                  <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate">{user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm text-neutral-600 dark:text-neutral-400">Account</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={user.enabled}
                  disabled={busy === "enabled"}
                  onClick={() => toggleEnabled()}
                  className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-neutral-400 ${
                    user.enabled ? "bg-emerald-500" : "bg-neutral-300 dark:bg-neutral-600"
                  } ${busy === "enabled" ? "opacity-60 cursor-wait" : ""}`}
                >
                  <span
                    className={`pointer-events-none absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${
                      user.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                  {user.enabled ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>

            {actionError ? (
              <p className="mt-4 text-sm text-red-600 dark:text-red-400" role="alert">
                {actionError}
              </p>
            ) : null}

            <section className="mt-6 border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
                Realm roles
              </h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {(user.realmRoles ?? []).length === 0 ? (
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">No realm roles</span>
                ) : (
                  (user.realmRoles ?? []).map((r) => (
                    <span
                      key={r.id || r.name}
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-neutral-800 dark:text-neutral-200"
                    >
                      {r.name}
                      <button
                        type="button"
                        className="ml-0.5 rounded p-0.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                        aria-label={`Remove role ${r.name}`}
                        disabled={busy != null}
                        onClick={() => removeRole(r.name)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="add-realm-role" className="text-sm text-neutral-600 dark:text-neutral-400">
                  Add role
                </label>
                <select
                  id="add-realm-role"
                  className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm min-w-[12rem] dark:text-neutral-200"
                  defaultValue=""
                  disabled={busy != null || addableRoles.length === 0}
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = "";
                    if (v) addRole(v);
                  }}
                >
                  <option value="">
                    {addableRoles.length === 0
                      ? "No roles to add"
                      : "Select a role…"}
                  </option>
                  {addableRoles.map((r) => (
                    <option key={r.id || r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="mt-6 border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">Teams</h3>
              <div className="flex flex-wrap gap-2 mb-3">
                {(user.teams ?? []).length === 0 ? (
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">No teams</span>
                ) : (
                  (user.teams ?? []).map((t) => (
                    <span
                      key={`${t.team_id}:${t.tenant_id}`}
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800 px-2.5 py-0.5 text-xs font-medium text-neutral-800 dark:text-neutral-200"
                    >
                      {t.team_id}
                      <span className="text-neutral-500 dark:text-neutral-400 font-normal">
                        ({t.tenant_id})
                      </span>
                      <button
                        type="button"
                        className="ml-0.5 rounded p-0.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
                        aria-label={`Remove team ${t.team_id}`}
                        disabled={busy != null}
                        onClick={() => removeTeam(t.team_id)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="add-team" className="text-sm text-neutral-600 dark:text-neutral-400">
                  Add team
                </label>
                <select
                  id="add-team"
                  className="rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 px-2 py-1.5 text-sm min-w-[12rem] dark:text-neutral-200"
                  defaultValue=""
                  disabled={busy != null || addableTeams.length === 0}
                  onChange={(e) => {
                    const v = e.target.value;
                    e.target.value = "";
                    if (v) addTeam(v);
                  }}
                >
                  <option value="">
                    {addableTeams.length === 0
                      ? "No teams to add"
                      : "Select a team…"}
                  </option>
                  {addableTeams.map((t) => (
                    <option key={t.teamId} value={t.teamId}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="mt-6 border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
                Per-KB roles
              </h3>
              {kbRows.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No per-KB roles assigned
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">KB ID</th>
                        <th className="px-3 py-2 font-medium">Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kbRows.map((row) => (
                        <tr
                          key={`${row.kbId}-${row.scope}`}
                          className="border-t border-neutral-100 dark:border-neutral-700"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.kbId}
                          </td>
                          <td className="px-3 py-2 capitalize">{row.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-6 border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
                Per-agent roles
              </h3>
              {agentRows.length === 0 ? (
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  No per-agent roles assigned
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                      <tr>
                        <th className="px-3 py-2 font-medium">Agent ID</th>
                        <th className="px-3 py-2 font-medium">Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentRows.map((row) => (
                        <tr
                          key={`${row.agentId}-${row.scope}`}
                          className="border-t border-neutral-100 dark:border-neutral-700"
                        >
                          <td className="px-3 py-2 font-mono text-xs">
                            {row.agentId}
                          </td>
                          <td className="px-3 py-2 capitalize">{row.scope}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="mt-6 border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-3">
                Identity & account
              </h3>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">IdP source</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100 mt-0.5">
                    {idpLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Slack</dt>
                  <dd className="mt-0.5">
                    {user.slackLinkStatus === "linked" ? (
                      <span className="inline-flex flex-col gap-0.5">
                        <span className="inline-flex items-center w-fit rounded-full bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 px-2 py-0.5 text-xs font-medium">
                          Linked
                        </span>
                        {slackUserId ? (
                          <span className="font-mono text-xs text-neutral-700 dark:text-neutral-300">
                            {slackUserId}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 px-2 py-0.5 text-xs font-medium">
                        Unlinked
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Last login</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100 mt-0.5">
                    {lastLoginLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Account created</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100 mt-0.5">
                    {createdLabel}
                  </dd>
                </div>
              </dl>
            </section>

            <div className="mt-8 flex justify-end gap-2 border-t border-neutral-200 dark:border-neutral-700 pt-4">
              <button
                type="button"
                className="rounded-lg border border-neutral-300 dark:border-neutral-600 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:hover:bg-neutral-800"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );

  if (!mounted) return null;

  return createPortal(modalInner, document.body);
}

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const PAGE_SIZE = 20;

const UM_SEARCH = "umSearch";
const UM_PAGE = "umPage";
const UM_ROLES = "umRoles";
const UM_TEAMS = "umTeams";
const UM_IDP = "umIdp";
const UM_SLACK = "umSlack";
const UM_ENABLED = "umEnabled";

const IDP_OPTIONS = [
  { value: "", label: "All IdPs" },
  { value: "duo-sso", label: "duo-sso" },
  { value: "local", label: "local" },
];

type SlackFilter = "all" | "linked" | "unlinked";
type EnabledFilter = "all" | "enabled" | "disabled";

interface AdminUserRow {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled: boolean;
  attributes: Record<string, string[]>;
  roles: string[];
}

interface KeycloakRole {
  id: string;
  name: string;
  clientRole: boolean;
}

interface TeamListItem {
  _id: string;
  name: string;
  members?: Array<{ user_id: string; role: string }>;
}

export interface UserManagementTabProps {
  onSelectUser: (userId: string) => void;
}

function parseListParam(raw: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isSlackLinked(u: AdminUserRow): boolean {
  const sid = u.attributes?.slack_user_id;
  const v = Array.isArray(sid) ? sid[0] : sid;
  return Boolean(v != null && String(v).trim() !== "");
}

function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

function userInAllTeamsByMembership(
  email: string,
  teamIds: string[],
  teams: TeamListItem[]
): boolean {
  if (teamIds.length === 0) return true;
  const key = emailKey(email);
  for (const tid of teamIds) {
    const t = teams.find((x) => x._id === tid);
    const ok = t?.members?.some(
      (m) => emailKey(String(m.user_id)) === key
    );
    if (!ok) return false;
  }
  return true;
}

function buildEmailToTeamNames(teams: TeamListItem[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const t of teams) {
    for (const mem of t.members ?? []) {
      const k = emailKey(String(mem.user_id));
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t.name);
    }
  }
  return m;
}

const ROLE_BADGE_CLASSES = [
  "border-violet-500/40 text-violet-700 dark:text-violet-300",
  "border-sky-500/40 text-sky-700 dark:text-sky-300",
  "border-amber-500/40 text-amber-800 dark:text-amber-300",
  "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  "border-rose-500/40 text-rose-700 dark:text-rose-300",
];

function RoleBadges({ roles }: { roles: string[] }) {
  const maxShow = 3;
  if (!roles.length) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  const shown = roles.slice(0, maxShow);
  const more = roles.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((r, i) => (
        <Badge
          key={r}
          variant="outline"
          className={`text-[10px] px-1.5 py-0 font-normal ${ROLE_BADGE_CLASSES[i % ROLE_BADGE_CLASSES.length]}`}
        >
          {r}
        </Badge>
      ))}
      {more > 0 && (
        <span className="text-[10px] text-muted-foreground self-center">
          +{more} more
        </span>
      )}
    </div>
  );
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-between font-normal h-9"
          >
            <span className="truncate">{summary}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-56 p-2 max-h-64 overflow-y-auto"
          align="start"
        >
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2 py-1">No options</p>
          ) : (
            <div className="space-y-1">
              {options.map((o) => (
                <label
                  key={o.value || "__all__"}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/60 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="rounded border-input"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function UserManagementTab({ onSelectUser }: UserManagementTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const skipSearchDraftSyncRef = useRef(false);

  const page = Math.max(
    1,
    parseInt(searchParams.get(UM_PAGE) ?? "1", 10) || 1
  );
  const rolesFilter = useMemo(
    () => parseListParam(searchParams.get(UM_ROLES)),
    [searchParams]
  );
  const teamsFilter = useMemo(
    () => parseListParam(searchParams.get(UM_TEAMS)),
    [searchParams]
  );
  const idpFilter = searchParams.get(UM_IDP) ?? "";
  const slackFilter = (searchParams.get(UM_SLACK) ?? "all") as SlackFilter;
  const enabledFilter = (searchParams.get(UM_ENABLED) ??
    "all") as EnabledFilter;
  const searchFromUrl = searchParams.get(UM_SEARCH) ?? "";

  const [searchDraft, setSearchDraft] = useState(searchFromUrl);

  useEffect(() => {
    if (skipSearchDraftSyncRef.current) {
      skipSearchDraftSyncRef.current = false;
      return;
    }
    setSearchDraft(searchFromUrl);
  }, [searchFromUrl]);

  const [debouncedSearch, setDebouncedSearch] = useState(searchFromUrl);
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(searchDraft);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchDraft]);

  useEffect(() => {
    if (debouncedSearch === searchFromUrl) return;
    const p = new URLSearchParams(searchParams.toString());
    if (debouncedSearch.trim()) p.set(UM_SEARCH, debouncedSearch.trim());
    else p.delete(UM_SEARCH);
    p.set(UM_PAGE, "1");
    skipSearchDraftSyncRef.current = true;
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }, [debouncedSearch, searchFromUrl, pathname, router, searchParams]);

  const patchUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") p.delete(k);
        else p.set(k, v);
      }
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setPage = (next: number) => {
    patchUrl({ [UM_PAGE]: next <= 1 ? null : String(next) });
  };

  const setRolesFilter = (next: string[]) => {
    patchUrl({
      [UM_ROLES]: next.length ? next.join(",") : null,
      [UM_PAGE]: null,
    });
  };

  const setTeamsFilter = (next: string[]) => {
    patchUrl({
      [UM_TEAMS]: next.length ? next.join(",") : null,
      [UM_PAGE]: null,
    });
  };

  const setIdpFilter = (v: string) => {
    patchUrl({ [UM_IDP]: v || null, [UM_PAGE]: null });
  };

  const setSlackFilter = (v: SlackFilter) => {
    patchUrl({
      [UM_SLACK]: v === "all" ? null : v,
      [UM_PAGE]: null,
    });
  };

  const setEnabledFilter = (v: EnabledFilter) => {
    patchUrl({
      [UM_ENABLED]: v === "all" ? null : v,
      [UM_PAGE]: null,
    });
  };

  const [realmRoles, setRealmRoles] = useState<KeycloakRole[]>([]);
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/roles");
        const json = await res.json();
        if (!json.success) return;
        if (!cancelled) {
          setRealmRoles(
            (json.data?.roles as KeycloakRole[] | undefined)?.filter(
              (r) => !r.clientRole
            ) ?? []
          );
        }
      } catch {
        if (!cancelled) setRealmRoles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/teams");
        const json = await res.json();
        if (!json.success) return;
        if (!cancelled) {
          setTeams((json.data?.teams as TeamListItem[] | undefined) ?? []);
        }
      } catch {
        if (!cancelled) setTeams([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const emailToTeams = useMemo(() => buildEmailToTeamNames(teams), [teams]);

  const roleOptions = useMemo(
    () =>
      realmRoles
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({ value: r.name, label: r.name })),
    [realmRoles]
  );

  const teamOptions = useMemo(
    () =>
      teams
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ value: t._id, label: t.name })),
    [teams]
  );

  const rolesFilterKey = rolesFilter.join("\u0001");
  const teamsFilterKey = teamsFilter.join("\u0001");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams();
        qs.set("page", String(page));
        qs.set("pageSize", String(PAGE_SIZE));
        const q = searchFromUrl.trim();
        if (q) qs.set("search", q);
        if (rolesFilter.length >= 1) qs.set("role", rolesFilter[0]);
        if (teamsFilter.length >= 1) qs.set("team", teamsFilter[0]);
        if (idpFilter.trim()) qs.set("idp", idpFilter.trim());
        if (slackFilter === "linked" || slackFilter === "unlinked") {
          qs.set("slackStatus", slackFilter);
        }
        if (enabledFilter === "enabled") qs.set("enabled", "true");
        if (enabledFilter === "disabled") qs.set("enabled", "false");

        const res = await fetch(`/api/admin/users?${qs.toString()}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(
            typeof data.error === "string"
              ? data.error
              : "Failed to load users"
          );
        }
        let rows = (data.users as AdminUserRow[] | undefined) ?? [];
        if (rolesFilter.length > 1) {
          rows = rows.filter((u) =>
            rolesFilter.every((r) => u.roles.includes(r))
          );
        }
        if (teamsFilter.length > 1) {
          rows = rows.filter((u) =>
            userInAllTeamsByMembership(u.email, teamsFilter, teams)
          );
        }
        if (!cancelled) {
          setUsers(rows);
          setTotal(typeof data.total === "number" ? data.total : 0);
        }
      } catch (e) {
        if (!cancelled) {
          setUsers([]);
          setTotal(0);
          setError(e instanceof Error ? e.message : "Failed to load users");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    page,
    searchFromUrl,
    rolesFilterKey,
    teamsFilterKey,
    idpFilter,
    slackFilter,
    enabledFilter,
    teams,
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        className="flex flex-wrap items-end gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 min-w-[200px] flex-1">
          <span className="text-xs font-medium text-muted-foreground">
            Search
          </span>
          <Input
            placeholder="Name, email, username…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="h-9"
          />
        </div>
        <MultiSelectFilter
          label="Roles"
          options={roleOptions}
          selected={rolesFilter}
          onChange={setRolesFilter}
          placeholder="All roles"
        />
        <MultiSelectFilter
          label="Teams"
          options={teamOptions}
          selected={teamsFilter}
          onChange={setTeamsFilter}
          placeholder="All teams"
        />
        <div className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-xs font-medium text-muted-foreground">IdP</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={idpFilter}
            onChange={(e) => setIdpFilter(e.target.value)}
          >
            {IDP_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs font-medium text-muted-foreground">
            Slack
          </span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={slackFilter}
            onChange={(e) => setSlackFilter(e.target.value as SlackFilter)}
          >
            <option value="all">All</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Unlinked</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[130px]">
          <span className="text-xs font-medium text-muted-foreground">
            Enabled
          </span>
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={enabledFilter}
            onChange={(e) =>
              setEnabledFilter(e.target.value as EnabledFilter)
            }
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Teams</th>
                <th className="px-4 py-3">IdP</th>
                <th className="px-4 py-3">Slack</th>
                <th className="px-4 py-3 w-20">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span>Loading…</span>
                    </div>
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    No users match the current filters.
                  </td>
                </tr>
              ) : (
                users.map((u, idx) => {
                  const name =
                    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
                    u.username ||
                    "—";
                  const teamNames =
                    emailToTeams.get(emailKey(u.email)) ?? [];
                  const linked = isSlackLinked(u);
                  return (
                    <tr
                      key={u.id}
                      onClick={() => onSelectUser(u.id)}
                      className={`border-b border-border/60 cursor-pointer transition-colors hover:bg-muted/50 ${
                        idx % 2 === 1 ? "bg-muted/20" : ""
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium">{name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {u.email || "—"}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <RoleBadges roles={u.roles} />
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground max-w-[180px]">
                        {teamNames.length ? (
                          <span className="line-clamp-2">
                            {teamNames.join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">—</td>
                      <td className="px-4 py-2.5">
                        {linked ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25">
                            Linked
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                            Unlinked
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full shrink-0 ${
                              u.enabled ? "bg-emerald-500" : "bg-red-500"
                            }`}
                            aria-hidden
                          />
                          <span className="sr-only">
                            {u.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <span>
            {total === 0
              ? "Showing 0 users"
              : `Showing ${from}-${to} of ${total} users`}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={page <= 1 || loading}
              onClick={() => setPage(page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

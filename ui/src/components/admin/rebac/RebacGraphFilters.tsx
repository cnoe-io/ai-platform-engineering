"use client";

// assisted-by Codex Codex-sonnet-4-6

import { Bot, Database, Key, Layers, Loader2, MessageSquare, Search, Shield, User, X, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";

export type RebacGraphEntityKind =
  | "user"
  | "team"
  | "service_account"
  | "unlinked_service_account"
  | "agent"
  | "skill"
  | "knowledge_base"
  | "data_source"
  | "conversation"
  | "secret_ref"
  | "llm_model";

export interface RebacGraphUserOption {
  id: string;
  kind?: RebacGraphEntityKind;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  // team / service_account / resource display name
  name?: string;
  slug?: string;
  description?: string;
}

export function userLabel(user: RebacGraphUserOption): string {
  if (user.kind === "team") return user.name ?? user.slug ?? user.id;
  if (user.kind === "unlinked_service_account") return user.name ?? "Unlinked service account";
  if (user.kind === "service_account") return user.name ?? user.id;
  if (user.kind === "agent") return user.name ?? user.id;
  if (user.kind === "conversation") return user.name ?? "Untitled chat";
  if (user.kind === "secret_ref") return user.name ?? "Credential";
  if (user.kind === "skill") return user.name ?? user.id;
  if (user.kind === "knowledge_base" || user.kind === "data_source") return user.name ?? user.id;
  if (user.kind === "llm_model") return user.name ?? user.id;
  if (user.id === "*") return "user:*";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || user.username || user.id;
}

export function subjectPrefix(user: RebacGraphUserOption): string {
  if (user.kind === "team") return "team";
  if (user.kind === "unlinked_service_account") return "service_account";
  if (user.kind === "service_account") return "service_account";
  if (user.kind === "agent") return "agent";
  if (user.kind === "skill") return "skill";
  if (user.kind === "knowledge_base") return "knowledge_base";
  if (user.kind === "data_source") return "data_source";
  if (user.kind === "conversation") return "conversation";
  if (user.kind === "secret_ref") return "secret_ref";
  if (user.kind === "llm_model") return "llm_model";
  return "user";
}

function KindIcon({ kind }: { kind: RebacGraphUserOption["kind"] }) {
  if (kind === "team") return <Shield className="h-3 w-3 shrink-0 text-violet-400" />;
  if (kind === "unlinked_service_account") return <Key className="h-3 w-3 shrink-0 text-orange-400" />;
  if (kind === "service_account") return <Key className="h-3 w-3 shrink-0 text-amber-400" />;
  if (kind === "agent") return <Bot className="h-3 w-3 shrink-0 text-emerald-400" />;
  if (kind === "skill") return <Layers className="h-3 w-3 shrink-0 text-teal-400" />;
  if (kind === "knowledge_base" || kind === "data_source") return <Database className="h-3 w-3 shrink-0 text-rose-400" />;
  if (kind === "conversation") return <MessageSquare className="h-3 w-3 shrink-0 text-cyan-400" />;
  if (kind === "secret_ref") return <Key className="h-3 w-3 shrink-0 text-fuchsia-400" />;
  if (kind === "llm_model") return <Zap className="h-3 w-3 shrink-0 text-blue-400" />;
  return <User className="h-3 w-3 shrink-0 text-sky-400" />;
}

function matchesQuery(query: string, ...values: unknown[]): boolean {
  const q = query.toLowerCase();
  return values
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(q));
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function dataItems(payload: unknown, nestedKey?: string): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) {
    return record.data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  const data = record.data && typeof record.data === "object"
    ? record.data as Record<string, unknown>
    : null;
  const candidates = [
    record.items,
    data?.items,
    nestedKey ? record[nestedKey] : undefined,
    nestedKey ? data?.[nestedKey] : undefined,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  return [];
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function RebacGraphFilters({
  selectedUser,
  idPrefix = "graph",
  onUserChange,
  onRender,
  rendering = false,
  includeAgents = true,
  includeUnlinkedServiceAccount = true,
  includeResources = true,
  placeholder = "Search users, teams, agents, skills, data sources, credentials, or models.",
  showRenderButton = true,
}: {
  selectedUser: RebacGraphUserOption | null;
  idPrefix?: string;
  onUserChange: (user: RebacGraphUserOption | null) => void;
  onRender: () => void;
  rendering?: boolean;
  includeAgents?: boolean;
  includeUnlinkedServiceAccount?: boolean;
  includeResources?: boolean;
  placeholder?: string;
  showRenderButton?: boolean;
}) {
  const [userSearch, setUserSearch] = useState("");
  const [userResults, setUserResults] = useState<RebacGraphUserOption[]>([]);
  const [teamResults, setTeamResults] = useState<RebacGraphUserOption[]>([]);
  const [saResults, setSaResults] = useState<RebacGraphUserOption[]>([]);
  const [unlinkedSaResults, setUnlinkedSaResults] = useState<RebacGraphUserOption[]>([]);
  const [agentResults, setAgentResults] = useState<RebacGraphUserOption[]>([]);
  const [skillResults, setSkillResults] = useState<RebacGraphUserOption[]>([]);
  const [datasourceResults, setDatasourceResults] = useState<RebacGraphUserOption[]>([]);
  const [credentialResults, setCredentialResults] = useState<RebacGraphUserOption[]>([]);
  const [modelResults, setModelResults] = useState<RebacGraphUserOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSubjects = useCallback(async (query: string, options: { allowEmpty?: boolean } = {}) => {
    const q = query.trim();
    if (!q && !options.allowEmpty) {
      setUserResults([]);
      setTeamResults([]);
      setSaResults([]);
      setUnlinkedSaResults([]);
      setAgentResults([]);
      setSkillResults([]);
      setDatasourceResults([]);
      setCredentialResults([]);
      setModelResults([]);
      return;
    }
    setSearching(true);
    try {
      const resultLimit = q ? 8 : 50;
      const [
        usersPayload,
        teamsPayload,
        serviceAccountsPayload,
        agentsPayload,
        unlinkedSaPayload,
        resourceSearchPayload,
      ] = await Promise.all([
        fetchJson(`/api/admin/users?${new URLSearchParams({ search: q, pageSize: String(resultLimit) })}`),
        fetchJson(`/api/admin/teams?${new URLSearchParams({ search: q, page: "1", page_size: String(resultLimit) })}`),
        fetchJson(`/api/admin/service-accounts`),
        includeAgents ? fetchJson(`/api/dynamic-agents?${new URLSearchParams({ page: "1", pageSize: "100" })}`) : Promise.resolve(null),
        includeUnlinkedServiceAccount ? fetchJson(`/api/admin/service-accounts/unlinked`) : Promise.resolve(null),
        includeResources ? fetchJson(`/api/admin/rebac/entity-search?${new URLSearchParams({ q })}`) : Promise.resolve(null),
      ]);
      const resourceSearch = resourceSearchPayload && typeof resourceSearchPayload === "object"
        ? ((resourceSearchPayload as Record<string, unknown>).data ?? resourceSearchPayload) as Record<string, unknown>
        : {};

      setUserResults(dataItems(usersPayload, "users")
        .map((user): RebacGraphUserOption | null => {
          const id = readString(user, ["id", "_id", "sub"]);
          return id ? {
            id,
            kind: "user" as const,
            username: readString(user, ["username"]),
            email: readString(user, ["email"]),
            firstName: readString(user, ["firstName", "first_name", "given_name"]),
            lastName: readString(user, ["lastName", "last_name", "family_name"]),
            name: readString(user, ["name", "displayName"]),
          } : null;
        })
        .filter((user): user is RebacGraphUserOption => Boolean(user)));
      setTeamResults(dataItems(teamsPayload, "teams")
        .map((team): RebacGraphUserOption | null => {
          const slug = readString(team, ["slug", "id", "_id"]);
          const name = readString(team, ["name", "displayName"]) || slug;
          return slug ? { id: slug, kind: "team" as const, name, slug } : null;
        })
        .filter((team): team is RebacGraphUserOption => Boolean(team)));

      setSaResults(dataItems(serviceAccountsPayload)
        .filter((sa) => matchesQuery(q, sa.name, sa.id, sa.client_id))
        .slice(0, resultLimit)
        .map((sa): RebacGraphUserOption | null => {
          const id = readString(sa, ["id", "_id", "client_id"]);
          return id ? { id, kind: "service_account" as const, name: readString(sa, ["name", "client_id"]) || id } : null;
        })
        .filter((sa): sa is RebacGraphUserOption => Boolean(sa)));

      const unlinkedData = unlinkedSaPayload && typeof unlinkedSaPayload === "object"
        ? ((unlinkedSaPayload as Record<string, unknown>).data ?? unlinkedSaPayload) as Record<string, unknown>
        : null;
      const unlinkedId = unlinkedData ? readString(unlinkedData, ["id", "sa_sub", "client_id"]) : "";
      const unlinkedName = unlinkedData ? readString(unlinkedData, ["name", "client_id"]) || "Unlinked service account" : "";
      setUnlinkedSaResults(
        unlinkedId && matchesQuery(q, unlinkedName, unlinkedId, "unlinked")
          ? [{ id: unlinkedId, kind: "unlinked_service_account" as const, name: unlinkedName }]
          : []
      );

      setAgentResults(dataItems(agentsPayload)
        .filter((agent) => matchesQuery(q, agent.name, agent._id, agent.id))
        .slice(0, resultLimit)
        .map((agent): RebacGraphUserOption | null => {
          const id = readString(agent, ["_id", "id"]);
          return id ? { id, kind: "agent" as const, name: readString(agent, ["name"]) || id } : null;
        })
        .filter((agent): agent is RebacGraphUserOption => Boolean(agent)));

      setSkillResults(dataItems(resourceSearch.skills)
        .filter((skill) => matchesQuery(q, skill.name, skill.title, skill.id, skill._id, skill.description))
        .slice(0, resultLimit)
        .map((skill): RebacGraphUserOption | null => {
          const id = readString(skill, ["id", "_id"]);
          return id ? {
            id,
            kind: "skill" as const,
            name: readString(skill, ["name", "title"]) || id,
            description: readString(skill, ["description"]),
          } : null;
        })
        .filter((skill): skill is RebacGraphUserOption => Boolean(skill)));

      setDatasourceResults(dataItems(resourceSearch.datasources, "datasources")
        .filter((datasource) => matchesQuery(q, datasource.name, datasource.datasource_id, datasource.id, datasource.description))
        .slice(0, resultLimit)
        .map((datasource): RebacGraphUserOption | null => {
          const id = readString(datasource, ["datasource_id", "id"]);
          return id ? {
            id,
            kind: "data_source" as const,
            name: readString(datasource, ["name", "title"]) || id,
            description: readString(datasource, ["description"]),
          } : null;
        })
        .filter((datasource): datasource is RebacGraphUserOption => Boolean(datasource)));

      setCredentialResults(dataItems(resourceSearch.credentials)
        .filter((credential) => matchesQuery(q, credential.name, credential.id, credential.type, credential.description))
        .slice(0, resultLimit)
        .map((credential): RebacGraphUserOption | null => {
          const id = readString(credential, ["id", "_id"]);
          return id ? {
            id,
            kind: "secret_ref" as const,
            name: readString(credential, ["name"]) || id,
            description: readString(credential, ["description", "type"]),
          } : null;
        })
        .filter((credential): credential is RebacGraphUserOption => Boolean(credential)));

      setModelResults(dataItems(resourceSearch.models)
        .filter((model) => matchesQuery(q, model.name, model.model_id, model._id, model.id, model.provider, model.description))
        .slice(0, resultLimit)
        .map((model): RebacGraphUserOption | null => {
          const id = readString(model, ["_id", "id", "model_id"]);
          return id ? {
            id,
            kind: "llm_model" as const,
            name: readString(model, ["name", "model_id"]) || id,
            description: readString(model, ["provider", "description"]),
          } : null;
        })
        .filter((model): model is RebacGraphUserOption => Boolean(model)));
    } finally {
      setSearching(false);
    }
  }, [includeAgents, includeResources, includeUnlinkedServiceAccount]);

  const clearResults = () => {
    setUserResults([]);
    setTeamResults([]);
    setSaResults([]);
    setUnlinkedSaResults([]);
    setAgentResults([]);
    setSkillResults([]);
    setDatasourceResults([]);
    setCredentialResults([]);
    setModelResults([]);
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (/^user:|^[A-Fa-f0-9][A-Fa-f0-9-]{7,}$/.test(userSearch.trim())) {
      clearResults();
      return;
    }
    const query = userSearch.trim();
    if (!query && !dropdownOpen) {
      clearResults();
      return;
    }
    debounceRef.current = setTimeout(() => { void fetchSubjects(userSearch, { allowEmpty: dropdownOpen }); }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [dropdownOpen, userSearch, fetchSubjects]);

  async function searchSubjects() {
    const query = userSearch.trim();
    const prefixed = /^(user|team|service_account|agent|skill|knowledge_base|data_source|conversation|secret_ref|llm_model):([A-Za-z0-9._~@|*+=,/-]+)$/.exec(query);
    const uuid = /^[A-Fa-f0-9][A-Fa-f0-9-]{7,}$/.exec(query);
    if (prefixed?.[1] && prefixed?.[2]) {
      const kind = prefixed[1] as Exclude<RebacGraphUserOption["kind"], "unlinked_service_account" | undefined>;
      if ((kind !== "agent" || includeAgents) && (["user", "team", "service_account", "agent"].includes(kind) || includeResources)) {
        onUserChange({ id: prefixed[2], kind, username: query, name: query });
        clearResults();
        return;
      }
    }
    if (uuid) { onUserChange({ id: query, username: `user:${query}` }); clearResults(); return; }
    setDropdownOpen(true);
    await fetchSubjects(query, { allowEmpty: true });
  }

  const clear = () => {
    onUserChange(null);
    setUserSearch("");
    setDropdownOpen(false);
    clearResults();
  };

  const hasResults = (
    userResults.length > 0 ||
    teamResults.length > 0 ||
    saResults.length > 0 ||
    unlinkedSaResults.length > 0 ||
    agentResults.length > 0 ||
    skillResults.length > 0 ||
    datasourceResults.length > 0 ||
    credentialResults.length > 0 ||
    modelResults.length > 0
  ) && !selectedUser && dropdownOpen;

  return (
    <div className="relative min-w-0 flex-1">
      {/* Single-row control: search input or selected-user chip */}
      {selectedUser ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
          <KindIcon kind={selectedUser.kind} />
          <span className="min-w-0 flex-1 truncate font-medium">{userLabel(selectedUser)}</span>
          <code className="hidden shrink-[9999] truncate text-[10px] text-muted-foreground sm:block">
            {subjectPrefix(selectedUser)}:{selectedUser.id}
          </code>
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={clear}>
            <X className="h-3 w-3" />
          </Button>
          {showRenderButton && (
            <Button
              size="sm"
              className="h-9 min-w-[7.5rem] px-4 text-sm font-semibold shadow-sm shadow-primary/20"
              onClick={onRender}
              disabled={rendering}
            >
              {rendering ? (
                <span className="flex items-center justify-center">
                  <CAIPESpinner size="sm" className="scale-50" />
                  <span className="sr-only">Checking access</span>
                </span>
              ) : (
                "Check Access"
              )}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            id={`${idPrefix}-user-search`}
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            className="h-11 min-w-0 flex-1 rounded-md border bg-background px-4 text-sm"
            placeholder={placeholder}
            value={userSearch}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              setDropdownOpen(true);
              setUserSearch(e.target.value);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchSubjects(); } }}
          />
          <Button
            type="button"
            size="lg"
            className="shrink-0 px-5"
            onClick={() => void searchSubjects()}
            disabled={searching}
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </div>
      )}

      {/* Dropdown — absolute so it overlays content below */}
      {hasResults && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-background shadow-lg">
          {[
            { label: "Users", items: userResults },
            { label: "Teams", items: teamResults },
            { label: "Service Accounts", items: saResults },
            { label: "Unlinked Service Account", items: unlinkedSaResults },
            ...(includeAgents ? [{ label: "Agents", items: agentResults }] : []),
            ...(includeResources
              ? [
                  { label: "Skills", items: skillResults },
                  { label: "Data Sources", items: datasourceResults },
                  { label: "Credentials", items: credentialResults },
                  { label: "LLM Models", items: modelResults },
                ]
              : []),
          ]
            .filter(({ items }) => items.length > 0)
            .map(({ label, items }, _idx, sections) => (
              <div key={label}>
                {sections.length > 1 && (
                  <div className="border-b px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </div>
                )}
                {items.map((item) => (
                  <button
                    key={`${item.kind ?? "user"}-${item.id}`}
                    type="button"
                    className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-muted"
                    onClick={() => {
                      onUserChange(item);
                      clearResults();
                      setDropdownOpen(false);
                      setUserSearch(userLabel(item));
                    }}
                  >
                    <KindIcon kind={item.kind} />
                    <span>
                      <span className="block font-medium">{userLabel(item)}</span>
                      <span className="block text-muted-foreground">
                        {subjectPrefix(item)}:{item.kind === "team" ? item.slug : item.id}
                      </span>
                      {item.description && (
                        <span className="block max-w-xl truncate text-muted-foreground/80">{item.description}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

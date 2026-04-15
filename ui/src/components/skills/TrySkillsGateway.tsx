"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Terminal, RefreshCcw, Loader2, AlertCircle, CheckCircle2, Search, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminRole } from "@/hooks/use-admin-role";

const DEFAULT_KEY_HEADER =
  process.env.NEXT_PUBLIC_CAIPE_CATALOG_API_KEY_HEADER ||
  "X-Caipe-Catalog-Key";

type SyncStatus = "in_sync" | "synced" | "supervisor_stale" | "unknown" | string;

function syncLabel(status: SyncStatus | undefined): string {
  switch (status) {
    case "in_sync":
    case "synced":
      return "In sync — supervisor loaded the current catalog generation.";
    case "supervisor_stale":
      return "Supervisor stale — run Refresh skills so the assistant picks up the latest catalog.";
    default:
      return "Status unavailable — backend may not expose generation metadata yet.";
  }
}

export function TrySkillsGateway() {
  const { isAdmin } = useAdminRole();
  const [sync, setSync] = useState<{
    sync_status?: SyncStatus;
    catalog_cache_generation?: number | null;
    last_built_catalog_generation?: number | null;
    skills_loaded_count?: number | null;
    graph_generation?: number | null;
  } | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const [copiedBearer, setCopiedBearer] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [mintBusy, setMintBusy] = useState(false);
  const [keys, setKeys] = useState<
    { key_id: string; created_at?: number; revoked_at?: number | null }[]
  >([]);

  // Query builder state
  const [queryQ, setQueryQ] = useState("");
  const [querySource, setQuerySource] = useState("");
  const [queryRepo, setQueryRepo] = useState("");
  const [queryTags, setQueryTags] = useState("");
  const [queryVisibility, setQueryVisibility] = useState("");
  const [queryPageSize, setQueryPageSize] = useState("20");
  const [queryIncludeContent, setQueryIncludeContent] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Tags autocomplete + search suggestions
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  // Hub repos discovered from catalog metadata
  const [availableRepos, setAvailableRepos] = useState<{ location: string; type: string }[]>([]);

  const baseUrl =
    typeof window !== "undefined" ? window.location.origin : "https://your-instance.example.com";

  const buildCatalogUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (queryQ.trim()) params.set("q", queryQ.trim());
    if (querySource) params.set("source", querySource);
    if (queryRepo) params.set("repo", queryRepo);
    if (queryTags.trim()) params.set("tags", queryTags.trim());
    if (queryVisibility) params.set("visibility", queryVisibility);
    params.set("page", "1");
    params.set("page_size", queryPageSize || "20");
    if (queryIncludeContent) params.set("include_content", "true");
    return `${baseUrl}/api/skills?${params.toString()}`;
  }, [baseUrl, queryQ, querySource, queryRepo, queryTags, queryVisibility, queryPageSize, queryIncludeContent]);

  const catalogUrl = buildCatalogUrl();

  const loadSync = useCallback(async () => {
    setSyncLoading(true);
    setSyncError(null);
    try {
      const res = await fetch("/api/skills/supervisor-status", {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError("Could not load sync status.");
        setSync(null);
        return;
      }
      setSync(data);
    } catch {
      setSyncError("Could not load sync status.");
      setSync(null);
    } finally {
      setSyncLoading(false);
    }
  }, []);

  const loadKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/catalog-api-keys", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.keys)) setKeys(data.keys);
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadSync();
    void loadKeys();

    // Fetch catalog to populate autocomplete tags and search suggestions
    fetch("/api/skills?page_size=100", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.skills) return;
        const tags = new Set<string>();
        const names: string[] = [];
        const repoMap = new Map<string, string>();
        for (const s of data.skills) {
          if (s.name) names.push(s.name);
          if (Array.isArray(s.metadata?.tags)) {
            for (const t of s.metadata.tags) {
              if (typeof t === "string" && t.trim()) tags.add(t.trim().toLowerCase());
            }
          }
          const loc = s.metadata?.hub_location;
          const hubType = s.metadata?.hub_type;
          if (typeof loc === "string" && loc && typeof hubType === "string") {
            repoMap.set(loc, hubType);
          }
        }
        setAvailableTags(Array.from(tags).sort());
        setSkillNames(names.sort());
        setAvailableRepos(
          Array.from(repoMap.entries())
            .map(([location, type]) => ({ location, type }))
            .sort((a, b) => a.location.localeCompare(b.location)),
        );
      })
      .catch(() => {});
  }, [loadSync, loadKeys]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/skills/refresh", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefreshMsg(
          data.message ||
            (res.status === 403
              ? "Admin role required to refresh the supervisor."
              : "Refresh failed."),
        );
        return;
      }
      setRefreshMsg(data.message || "Refresh completed.");
      await loadSync();
    } catch {
      setRefreshMsg("Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleMint = async () => {
    setMintBusy(true);
    setMintedKey(null);
    try {
      const res = await fetch("/api/catalog-api-keys", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMintedKey(null);
        return;
      }
      if (typeof data.key === "string") setMintedKey(data.key);
      await loadKeys();
    } finally {
      setMintBusy(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewData(null);
    try {
      const res = await fetch(catalogUrl.replace(baseUrl, ""), {
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data.message || data.detail?.message || `Request failed (${res.status})`);
        return;
      }
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview request failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  const keyPlaceholder = mintedKey || "<key_id.secret>";

  const curlBearer = `curl -sS "${catalogUrl}" \\\n  -H "Authorization: Bearer <access_token>"`;

  const curlKey = `curl -sS "${catalogUrl}" \\\n  -H "${DEFAULT_KEY_HEADER}: ${keyPlaceholder}"`;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Catalog Query Builder */}
      <Card className="border-border/80 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="h-5 w-5" />
            Skill Catalog Query Builder
          </CardTitle>
          <CardDescription>
            Build a catalog URL interactively and preview results.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <label className="text-xs font-medium text-muted-foreground">Search (q)</label>
              <input
                type="text"
                value={queryQ}
                onChange={(e) => { setQueryQ(e.target.value); setShowSearchSuggestions(true); }}
                onFocus={() => setShowSearchSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 150)}
                placeholder="e.g. aws, kubernetes"
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoComplete="off"
              />
              {showSearchSuggestions && queryQ.trim().length > 0 && skillNames.filter(n => n.toLowerCase().includes(queryQ.toLowerCase())).length > 0 && (
                <ul className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-md border border-border bg-popover shadow-md text-xs">
                  {skillNames
                    .filter(n => n.toLowerCase().includes(queryQ.toLowerCase()))
                    .slice(0, 8)
                    .map(n => (
                      <li
                        key={n}
                        className="px-3 py-1.5 cursor-pointer hover:bg-accent"
                        onMouseDown={() => { setQueryQ(n); setShowSearchSuggestions(false); }}
                      >
                        {n}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Source</label>
              <select
                value={querySource}
                onChange={(e) => {
                  setQuerySource(e.target.value);
                  if (!["hub", "github", "gitlab"].includes(e.target.value)) setQueryRepo("");
                }}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">All sources</option>
                <option value="default">Built-in</option>
                <option value="agent_skills">Custom Skills</option>
                {availableRepos.some(r => r.type === "github") && (
                  <option value="github">GitHub</option>
                )}
                {availableRepos.some(r => r.type === "gitlab") && (
                  <option value="gitlab">GitLab</option>
                )}
                {availableRepos.length === 0 && <option value="hub">Hub</option>}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Repository</label>
              <select
                value={queryRepo}
                onChange={(e) => {
                  setQueryRepo(e.target.value);
                  if (e.target.value) {
                    const match = availableRepos.find(r => r.location === e.target.value);
                    setQuerySource(match?.type || "hub");
                  }
                }}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">All repos</option>
                {availableRepos.map((r) => (
                  <option key={r.location} value={r.location}>
                    {r.location} ({r.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <label className="text-xs font-medium text-muted-foreground">Tags (comma-separated)</label>
              <input
                type="text"
                value={queryTags}
                onChange={(e) => { setQueryTags(e.target.value); setShowTagSuggestions(true); }}
                onFocus={() => setShowTagSuggestions(true)}
                onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                placeholder="e.g. security, networking"
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoComplete="off"
              />
              {showTagSuggestions && availableTags.length > 0 && (() => {
                const entered = queryTags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
                const lastPartial = queryTags.includes(",")
                  ? queryTags.slice(queryTags.lastIndexOf(",") + 1).trim().toLowerCase()
                  : queryTags.trim().toLowerCase();
                const suggestions = availableTags
                  .filter(t => !entered.includes(t))
                  .filter(t => !lastPartial || t.includes(lastPartial))
                  .slice(0, 8);
                if (suggestions.length === 0) return null;
                return (
                  <ul className="absolute z-10 mt-1 w-full max-h-40 overflow-y-auto rounded-md border border-border bg-popover shadow-md text-xs">
                    {suggestions.map(tag => (
                      <li
                        key={tag}
                        className="px-3 py-1.5 cursor-pointer hover:bg-accent"
                        onMouseDown={() => {
                          const parts = queryTags.split(",").map(t => t.trim()).filter(Boolean);
                          // Replace the last partial entry with the selected tag
                          if (queryTags.includes(",")) {
                            parts[parts.length - 1] = tag;
                          } else {
                            parts[0] = tag;
                          }
                          setQueryTags(parts.join(", ") + ", ");
                          setShowTagSuggestions(false);
                        }}
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                );
              })()}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Visibility</label>
              <select
                value={queryVisibility}
                onChange={(e) => setQueryVisibility(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">All</option>
                <option value="global">global</option>
                <option value="team">team</option>
                <option value="personal">personal</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Page size</label>
              <input
                type="number"
                min={1}
                max={100}
                value={queryPageSize}
                onChange={(e) => setQueryPageSize(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={queryIncludeContent}
                  onChange={(e) => setQueryIncludeContent(e.target.checked)}
                  className="rounded border-border"
                />
                include_content
              </label>
            </div>
          </div>

          <div>
            <p className="font-medium text-foreground mb-1 text-xs">Live URL</p>
            <div className="relative group">
              <code className="block rounded-md bg-muted px-3 py-2 pr-10 text-xs break-all">{catalogUrl}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => {
                  void navigator.clipboard.writeText(catalogUrl);
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 2000);
                }}
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={previewLoading}
              onClick={() => void handlePreview()}
              className="gap-1"
            >
              {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Preview
            </Button>
            {previewData?.meta?.total != null && (
              <span className="text-xs text-muted-foreground">
                {previewData.meta.total} skill{previewData.meta.total !== 1 ? "s" : ""} found
              </span>
            )}
          </div>

          {previewError && (
            <p className="text-destructive text-xs flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              {previewError}
            </p>
          )}

          {previewData?.skills && previewData.skills.length > 0 && (
            <div className="rounded-md border border-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">Name</th>
                    <th className="text-left px-3 py-1.5 font-medium">Description</th>
                    <th className="text-left px-3 py-1.5 font-medium">Source</th>
                    <th className="text-left px-3 py-1.5 font-medium">Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {previewData.skills.map((skill: any, i: number) => (
                    <tr key={skill.id || i} className="border-t border-border hover:bg-muted/50">
                      <td className="px-3 py-1.5 font-medium">{skill.name}</td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[200px]">{skill.description}</td>
                      <td className="px-3 py-1.5">{skill.source}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {((skill.metadata?.tags as string[]) || []).join(", ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Authentication & Sync */}
      <Card className="border-border/80 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Terminal className="h-5 w-5" />
            Authentication & Sync
          </CardTitle>
          <CardDescription>
            Call the same catalog as the UI and supervisor using an OIDC access token or a catalog
            API key. Invalid authentication returns <strong>401</strong> with a generic body (no
            account enumeration).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-foreground mb-1">Base URL</p>
            <code className="block rounded-md bg-muted px-3 py-2 text-xs break-all">{baseUrl}</code>
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Auth option A — Bearer token</p>
            <p className="text-muted-foreground mb-2">
              Use an OIDC access token accepted by the same validation as other CAIPE APIs.
            </p>
            <div className="relative group">
              <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                {curlBearer}
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => {
                  void navigator.clipboard.writeText(curlBearer);
                  setCopiedBearer(true);
                  setTimeout(() => setCopiedBearer(false), 2000);
                }}
              >
                {copiedBearer ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Auth option B — Catalog API key</p>
            <p className="text-muted-foreground mb-2">
              Header name: <code>{DEFAULT_KEY_HEADER}</code> (configure server-side; do not log key
              values).
            </p>
            <div className="relative group">
              <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                {curlKey}
              </pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => {
                  void navigator.clipboard.writeText(curlKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
              >
                {copiedKey ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Optional query params: <code>q</code>, <code>page</code>, <code>page_size</code>,{" "}
              <code>source</code>, <code>visibility</code> (global | team | personal),{" "}
              <code>include_content</code>.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={mintBusy}
              onClick={() => void handleMint()}
            >
              {mintBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Mint catalog API key
            </Button>
            {mintedKey ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 break-all">
                Copy once: <code>{mintedKey}</code>
              </span>
            ) : null}
          </div>
          {keys.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Active / past keys: </span>
              {keys.map((k) => k.key_id).join(", ")}
            </div>
          ) : null}

          <div className="border-t border-border pt-4 space-y-2">
            <p className="font-medium text-foreground">Skills sync (supervisor vs catalog)</p>
            {syncLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : syncError ? (
              <p className="text-destructive text-xs flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />
                {syncError}
              </p>
            ) : (
              <div className="space-y-1 text-xs">
                <p className="flex items-start gap-1.5">
                  {sync?.sync_status === "in_sync" || sync?.sync_status === "synced" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  {syncLabel(sync?.sync_status)}
                </p>
                <p className="text-muted-foreground pl-5">
                  catalog_cache_generation: {sync?.catalog_cache_generation ?? "—"} ·
                  last_built_catalog_generation: {sync?.last_built_catalog_generation ?? "—"} ·
                  skills_loaded_count: {sync?.skills_loaded_count ?? "—"}
                </p>
              </div>
            )}
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                <RefreshCcw className={`h-3.5 w-3.5 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                Refresh skills (supervisor)
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                Ask an administrator to run <strong>Refresh skills</strong> if the supervisor is
                stale.
              </p>
            )}
            {refreshMsg ? (
              <p className="text-xs text-muted-foreground mt-1">{refreshMsg}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Claude Code</CardTitle>
          <CardDescription>
            Create a <code>/skills</code> slash command that lets Claude Code browse and install skills
            from this gateway.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-4 text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-2">1. Configure your API key</p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">{`mkdir -p ~/.config/caipe
cat > ~/.config/caipe/config.json << 'EOF'
{
  "api_key": "<your-catalog-api-key>",
  "base_url": "${baseUrl}"
}
EOF`}</pre>
          </div>

          <div>
            <p className="font-medium text-foreground mb-2">2. Create the bootstrap skill</p>
            <p className="mb-2">
              Add this file to your repo. It calls the gateway and lets Claude browse, search, and
              install skills as <code>.claude/commands/</code> files.
            </p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">{`mkdir -p .claude/commands
cat > .claude/commands/skills.md << 'SKILL'
---
description: Browse and install skills from the CAIPE catalog
---

## User Input
\`\`\`text
$ARGUMENTS
\`\`\`

## SECURITY — never expose the API key
- NEVER print, echo, or display the API key in any output.
- Store in a shell variable, pass only via -H header.

## Steps

1. Load credentials (do NOT echo the key):
   \`\`\`bash
   CAIPE_KEY="" CAIPE_URL=""
   if [ -f ~/.config/caipe/config.json ]; then
     CAIPE_KEY=$(python3 -c "import json; print(json.load(open('$HOME/.config/caipe/config.json')).get('api_key',''))" 2>/dev/null)
     CAIPE_URL=$(python3 -c "import json; print(json.load(open('$HOME/.config/caipe/config.json')).get('base_url',''))" 2>/dev/null)
   fi
   [ -z "$CAIPE_URL" ] && CAIPE_URL="https://catalog.caipe.dev"
   [ -n "$CAIPE_KEY" ] && echo "KEY_FOUND" || echo "NO_KEY"
   \`\`\`

2. Search: curl -sS "$CAIPE_URL/api/skills?source=github&q=<query>&page=1&page_size=20" -H "X-Caipe-Catalog-Key: $CAIPE_KEY"

3. Display as table, offer to install selected skill to .claude/commands/<name>.md
SKILL`}</pre>
          </div>

          <div>
            <p className="font-medium text-foreground mb-2">3. Use it</p>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto whitespace-pre-wrap">{`# Browse all skills
/skills

# Search for specific skills
/skills docker
/skills kubernetes
/skills python`}</pre>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md p-3">
        <strong>Skill Scanner</strong> (hub ingest) uses{" "}
        <a
          className="text-primary underline"
          href="https://github.com/cisco-ai-defense/skill-scanner"
          target="_blank"
          rel="noreferrer"
        >
          Skill Scanner
        </a>
        , provided by <strong>Cisco AI Defense</strong>. Scanner results are best-effort and do not
        guarantee security.
      </p>
    </div>
  );
}

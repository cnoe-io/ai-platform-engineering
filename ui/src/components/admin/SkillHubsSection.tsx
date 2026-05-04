"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Loader2, Plus, Trash2, Globe, AlertCircle, CheckCircle2, X, RefreshCcw, Search, ShieldAlert, Zap } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GithubIcon, GitlabIcon } from "@/components/ui/icons";
import { ScanAllDialog } from "@/components/skills/ScanAllDialog";
import { cn } from "@/lib/utils";
import { detectHubProviderFromUrl } from "@/app/api/skill-hubs/_lib/normalize";

type HubType = "github" | "gitlab";

const HUB_TYPE_HINTS: Record<HubType, {
  label: string;
  repoLabel: string;
  repoPlaceholder: string;
  credentialEnv: string;
}> = {
  github: {
    label: "GitHub",
    repoLabel: "GitHub repository",
    repoPlaceholder: "owner/repo or https://github.com/owner/repo",
    credentialEnv: "GITHUB_TOKEN",
  },
  gitlab: {
    label: "GitLab",
    repoLabel: "GitLab project",
    repoPlaceholder: "group/project, group/sub/project, or https://gitlab.com/...",
    credentialEnv: "GITLAB_TOKEN",
  },
};

interface SkillHub {
  id: string;
  type: string;
  location: string;
  enabled: boolean;
  credentials_ref: string | null;
  labels?: string[];
  /** Optional path-prefix allow-list for hub crawl (FR-020). */
  include_paths?: string[];
  last_success_at: number | null;
  last_failure_at: number | null;
  last_failure_message: string | null;
  created_at: string;
  updated_at: string;
  /** Set when skill-scanner runs on hub ingest (backend). */
  last_skill_scan_at?: number | null;
  last_skill_scan_exit_code?: number | null;
  last_skill_scan_max_severity?: string | null;
  last_skill_scan_blocked?: boolean | null;
  /** Per-skill scan-state aggregates from /api/skill-hubs (Option C nudge). */
  skills_count?: number;
  scan_unscanned_count?: number;
  scan_flagged_count?: number;
  scan_passed_count?: number;
}

interface SkillHubsSectionProps {
  isAdmin: boolean;
}

export function SkillHubsSection({ isAdmin }: SkillHubsSectionProps) {
  const [hubs, setHubs] = useState<SkillHub[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState<HubType>("github");
  const [formLocation, setFormLocation] = useState("");
  // Inline notice shown when the location URL's host clearly
  // identifies a provider that disagrees with the currently-selected
  // source pill — set by `handleLocationChange` and cleared whenever
  // the user manually flips the source or types a non-URL location.
  // Stores the *target* provider so the message can name it.
  const [autoSwitchedTo, setAutoSwitchedTo] = useState<HubType | null>(null);
  const [formCredRef, setFormCredRef] = useState("");
  const [formLabels, setFormLabels] = useState("");
  // One prefix per line; empty lines are dropped before submit. FR-020.
  const [formIncludePaths, setFormIncludePaths] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);
  const [recrawlResult, setRecrawlResult] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [crawlLoading, setCrawlLoading] = useState(false);
  const [crawlPaths, setCrawlPaths] = useState<string[]>([]);
  const [crawlPreview, setCrawlPreview] = useState<{ path: string; name: string; description: string }[]>([]);
  // Bulk-scan dialog scoped to a single hub via the per-hub "Scan now"
  // nudge. `null` means the dialog is closed.
  const [scanHubId, setScanHubId] = useState<string | null>(null);

  const loadHubs = useCallback(async () => {
    try {
      const res = await fetch("/api/skill-hubs");
      if (!res.ok) {
        if (res.status === 403) {
          setError("Admin access required to manage skill hubs.");
          return;
        }
        throw new Error("Failed to load skill hubs");
      }
      const data = await res.json();
      setHubs(data.hubs || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || "Failed to load skill hubs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHubs();
  }, [loadHubs]);

  const parseIncludePaths = (raw: string): string[] =>
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  const handleAdd = async () => {
    if (!formLocation.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const labels = formLabels.split(",").map((l) => l.trim().toLowerCase()).filter(Boolean);
      const includePaths = parseIncludePaths(formIncludePaths);
      const res = await fetch("/api/skill-hubs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          location: formLocation.trim(),
          credentials_ref: formCredRef.trim() || null,
          labels: labels.length > 0 ? labels : undefined,
          include_paths: includePaths.length > 0 ? includePaths : undefined,
          enabled: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to register hub (${res.status})`);
      }
      setFormType("github");
      setFormLocation("");
      setFormCredRef("");
      setFormLabels("");
      setFormIncludePaths("");
      setShowAddForm(false);
      await loadHubs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (hubId: string) => {
    if (!confirm("Are you sure you want to remove this skill hub?")) return;
    setDeletingId(hubId);
    try {
      const res = await fetch(`/api/skill-hubs/${hubId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete hub");
      }
      setHubs(hubs.filter((h) => h.id !== hubId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggle = async (hub: SkillHub) => {
    setTogglingId(hub.id);
    try {
      const res = await fetch(`/api/skill-hubs/${hub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !hub.enabled }),
      });
      if (!res.ok) throw new Error("Failed to update hub");
      await loadHubs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTogglingId(null);
    }
  };

  const handleRecrawl = async (hubId: string) => {
    setRecrawlingId(hubId);
    try {
      const res = await fetch(`/api/skill-hubs/${hubId}/refresh`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Recrawl failed");
      setRecrawlResult((prev) => ({ ...prev, [hubId]: data.skills_count ?? 0 }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRecrawlingId(null);
    }
  };

  const handleRefresh = async () => {
    if (isAdmin) {
      try {
        await fetch("/api/skills/refresh", { method: "POST" });
      } catch {
        /* best-effort — backend may be unavailable */
      }
    }
    try {
      await fetch("/api/skills?include_content=false");
    } catch {}
    await loadHubs();
  };

  const handleCrawlPreview = async () => {
    if (!formLocation.trim()) return;
    setCrawlLoading(true);
    setError(null);
    setCrawlPaths([]);
    setCrawlPreview([]);
    try {
      const res = await fetch("/api/skill-hubs/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          location: formLocation.trim(),
          credentials_ref: formCredRef.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.detail?.message || data.error || `Crawl failed (${res.status})`);
      }
      setCrawlPaths(data.paths || []);
      setCrawlPreview(data.skills_preview || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Crawl preview failed");
    } finally {
      setCrawlLoading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Skill Hubs
          </CardTitle>
          <CardDescription>
            Register external GitHub or GitLab repositories as skill sources. Skills from hubs are merged into the catalog.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-1">
            <RefreshCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowAddForm(!showAddForm)} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add Hub
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
            <Button variant="ghost" size="sm" className="ml-auto h-6 w-6 p-0" onClick={() => setError(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        {showAddForm && isAdmin && (
          <div className="mb-4 p-4 border border-border rounded-lg bg-muted/30 space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Source
              </label>
              <div
                role="radiogroup"
                aria-label="Hub source"
                className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs"
              >
                {(Object.keys(HUB_TYPE_HINTS) as HubType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={formType === t}
                    onClick={() => {
                      setFormType(t);
                      setAutoSwitchedTo(null);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded font-medium transition-colors",
                      formType === t
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t === "github" ? (
                      <GithubIcon className="h-3.5 w-3.5" />
                    ) : (
                      <GitlabIcon className="h-3.5 w-3.5" />
                    )}
                    {HUB_TYPE_HINTS[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                {HUB_TYPE_HINTS[formType].repoLabel}
              </label>
              <input
                type="text"
                value={formLocation}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormLocation(next);
                  // Auto-switch the source pill when the typed/pasted
                  // value is a URL whose host clearly identifies the
                  // *other* provider. This stops the
                  // "GitHub selected + gitlab.com URL pasted" pitfall
                  // from silently producing a misleading
                  // `api.github.com/repos/<gitlab-group>/<sub>` 404
                  // (GitHub URL parsing in the legacy preview path
                  // truncates to the first two path segments without
                  // checking the host). `detectHubProviderFromUrl`
                  // returns null for non-URLs / unknown hosts, so
                  // typing `owner/repo` directly never triggers a
                  // switch and the user keeps full manual control via
                  // the source pill.
                  const detected = detectHubProviderFromUrl(next);
                  if (detected && detected !== formType) {
                    setFormType(detected);
                    setAutoSwitchedTo(detected);
                  } else if (!detected) {
                    // User cleared / typed something that's no longer
                    // a recognizable URL — drop the stale notice.
                    setAutoSwitchedTo(null);
                  }
                }}
                placeholder={HUB_TYPE_HINTS[formType].repoPlaceholder}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {autoSwitchedTo && (
                <p
                  role="status"
                  aria-live="polite"
                  className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-center gap-1.5"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  Detected {HUB_TYPE_HINTS[autoSwitchedTo].label} URL — switched
                  source to {HUB_TYPE_HINTS[autoSwitchedTo].label}.
                </p>
              )}
              {formType === "gitlab" && (
                <p className="text-xs text-muted-foreground mt-1">
                  Subgroup nesting is preserved (e.g. <code className="font-mono">mycorp/devops/platform</code>).
                  Self-hosted GitLab via <code className="font-mono">GITLAB_API_URL</code>.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Credentials Env Var (optional)</label>
              <input
                type="text"
                value={formCredRef}
                onChange={(e) => setFormCredRef(e.target.value)}
                placeholder={
                  formType === "github"
                    ? "e.g. GITHUB_TOKEN_PRIVATE (env var name holding token)"
                    : "e.g. GITLAB_TOKEN_PRIVATE (env var name holding token)"
                }
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Name of the environment variable holding a {HUB_TYPE_HINTS[formType].label} token. Falls back to{" "}
                <code className="font-mono">{HUB_TYPE_HINTS[formType].credentialEnv}</code> if empty.
                {formType === "gitlab"
                  ? " Public projects work without a token."
                  : ""}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Labels (optional, comma-separated)</label>
              <input
                type="text"
                value={formLabels}
                onChange={(e) => setFormLabels(e.target.value)}
                placeholder="e.g. security, platform, networking"
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Labels are merged into every skill&apos;s tags from this hub.
              </p>
            </div>
            <div>
              <label
                htmlFor="hub-include-paths"
                className="text-xs font-medium text-muted-foreground"
              >
                Include paths (optional)
              </label>
              <textarea
                id="hub-include-paths"
                value={formIncludePaths}
                onChange={(e) => setFormIncludePaths(e.target.value)}
                placeholder={"skills/\nagents/observability/skills/"}
                rows={3}
                className="mt-1 w-full px-3 py-2 text-sm font-mono bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-muted-foreground mt-1">
                One prefix per line. Leave empty to crawl the entire repo.
                Trailing slashes are added automatically.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAddForm(false)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCrawlPreview}
                disabled={!formLocation.trim() || crawlLoading}
                className="gap-1"
              >
                {crawlLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                Preview skills (crawl)
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!formLocation.trim() || adding} className="gap-1">
                {adding && <Loader2 className="h-3 w-3 animate-spin" />}
                Register Hub
              </Button>
            </div>
            {(crawlPaths.length > 0 || crawlPreview.length > 0) && (
              <div className="mt-3 rounded-md border border-border bg-muted/20 p-3 max-h-48 overflow-y-auto">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Discovered SKILL.md paths ({crawlPaths.length || crawlPreview.length})
                </p>
                <ul className="text-xs font-mono space-y-1">
                  {(crawlPaths.length ? crawlPaths : crawlPreview.map((p) => p.path)).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {hubs.length === 0 ? (
          <div className="text-center py-8">
            <Globe className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-medium mb-1">No Skill Hubs</h3>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? 'Register a GitHub or GitLab repository to import its skills into the catalog.'
                : 'No external skill hubs have been configured yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-6 gap-4 pb-2 border-b text-xs font-medium text-muted-foreground">
              <div className="col-span-2">Repository</div>
              <div>Status</div>
              <div>Last Sync</div>
              <div>Added</div>
              {isAdmin && <div className="text-right">Actions</div>}
            </div>
            {hubs.map((hub) => (
              <div key={hub.id} className="space-y-0.5">
              <div className="grid grid-cols-6 gap-4 py-2 text-sm hover:bg-muted/50 rounded px-2 items-center">
                <div className="col-span-2 flex items-center gap-2">
                  {hub.type === "gitlab" ? (
                    <GitlabIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : hub.type === "github" ? (
                    <GithubIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="font-medium truncate" title={`${hub.type}: ${hub.location}`}>
                    {hub.location}
                  </span>
                  {hub.labels && hub.labels.length > 0 && hub.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0">
                      {label}
                    </Badge>
                  ))}
                </div>
                <div>
                  {hub.enabled ? (
                    hub.last_failure_at && (!hub.last_success_at || hub.last_failure_at > hub.last_success_at) ? (
                      <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/30 gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Error
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-500 border-green-500/30 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </Badge>
                    )
                  ) : (
                    <Badge variant="secondary" className="text-xs">Disabled</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {hub.last_success_at
                    ? new Date(hub.last_success_at * 1000).toLocaleDateString()
                    : hub.last_failure_at
                    ? `Failed ${new Date(hub.last_failure_at * 1000).toLocaleDateString()}`
                    : 'Never'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(hub.created_at).toLocaleDateString()}
                </div>
                {isAdmin && (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleToggle(hub)}
                      disabled={togglingId === hub.id}
                    >
                      {togglingId === hub.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : hub.enabled ? (
                        "Disable"
                      ) : (
                        "Enable"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      title="Force-recrawl this hub, bypassing the cache"
                      onClick={() => handleRecrawl(hub.id)}
                      disabled={recrawlingId === hub.id}
                    >
                      {recrawlingId === hub.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCcw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-400 hover:text-red-500"
                      onClick={() => handleDelete(hub.id)}
                      disabled={deletingId === hub.id}
                    >
                      {deletingId === hub.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
              {hub.include_paths && hub.include_paths.length > 0 ? (
                <div className="px-2 pl-10 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="opacity-70">Paths:</span>
                  {hub.include_paths.map((p) => (
                    <Badge
                      key={p}
                      variant="outline"
                      className="font-mono text-[10px] py-0 px-1.5"
                    >
                      {p}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {hub.last_skill_scan_at != null && hub.last_skill_scan_at > 0 ? (
                <div className="px-2 pl-10 text-[11px] text-muted-foreground">
                  Skill Scanner:{" "}
                  {new Date(hub.last_skill_scan_at * 1000).toLocaleString()}
                  {hub.last_skill_scan_max_severity
                    ? ` · max severity ${hub.last_skill_scan_max_severity}`
                    : ""}
                  {hub.last_skill_scan_blocked ? " · hub merge blocked (strict gate)" : ""}
                  {hub.last_skill_scan_exit_code != null && hub.last_skill_scan_exit_code !== 0
                    ? ` · exit ${hub.last_skill_scan_exit_code}`
                    : ""}
                </div>
              ) : null}
              {recrawlResult[hub.id] != null ? (
                <div className="px-2 pl-10 text-[11px] text-green-600 dark:text-green-400">
                  Recrawled — {recrawlResult[hub.id]} skill{recrawlResult[hub.id] !== 1 ? "s" : ""} found
                </div>
              ) : null}
              {/* Option C nudge: surface unscanned / flagged skills per
                  hub with a one-click retry that opens the bulk dialog
                  scoped to this hub. When everything passed we still
                  show a tiny green confirmation so admins see at a
                  glance that scans actually ran. */}
              {isAdmin && (hub.skills_count ?? 0) > 0 && (
                ((hub.scan_unscanned_count ?? 0) > 0 || (hub.scan_flagged_count ?? 0) > 0) ? (
                  <div className="px-2 pl-10 flex items-center gap-2 text-[11px]">
                    {(hub.scan_unscanned_count ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-600 border-amber-500/30 gap-1">
                        <ShieldAlert className="h-3 w-3" />
                        {hub.scan_unscanned_count} unscanned
                      </Badge>
                    )}
                    {(hub.scan_flagged_count ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-red-500 border-red-500/30 gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {hub.scan_flagged_count} flagged
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[11px] gap-1"
                      onClick={() => setScanHubId(hub.id)}
                      title="Open bulk scan dialog scoped to this hub"
                    >
                      <Zap className="h-3 w-3" />
                      Scan now
                    </Button>
                  </div>
                ) : (hub.scan_passed_count ?? 0) > 0 ? (
                  <div className="px-2 pl-10 flex items-center gap-1.5 text-[11px] text-green-600 dark:text-green-400">
                    <CheckCircle2 className="h-3 w-3" />
                    All {hub.scan_passed_count} skill{hub.scan_passed_count === 1 ? "" : "s"} passed scan
                  </div>
                ) : null
              )}
              </div>
            ))}
          </div>
        )}

        {/* Show last failure message if any hub has one */}
        {hubs.some((h) => h.last_failure_message) && (
          <div className="mt-4 space-y-2">
            {hubs.filter((h) => h.last_failure_message).map((h) => (
              <div key={h.id} className="p-2 rounded bg-orange-500/10 text-xs text-orange-600 dark:text-orange-400">
                <strong>{h.location}:</strong> {h.last_failure_message}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-6 border-t border-border pt-4 leading-relaxed">
          Hub ingest uses{" "}
          <a
            href="https://github.com/cisco-ai-defense/skill-scanner"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium hover:underline"
          >
            Skill Scanner
          </a>
          , provided by <strong>Cisco AI Defense</strong>. Scanner results are best-effort and do not
          guarantee security; a clean scan does not imply safety.
        </p>
      </CardContent>

      {/* Per-hub bulk-scan dialog. Pre-scoped to the hub the operator
          clicked so they don't have to reselect anything. */}
      <ScanAllDialog
        open={scanHubId !== null}
        onOpenChange={(next) => {
          if (!next) setScanHubId(null);
        }}
        initialScope="hub"
        initialHubIds={scanHubId ? [scanHubId] : undefined}
        onComplete={() => {
          // Refresh per-hub aggregates so the nudge clears immediately.
          loadHubs();
        }}
      />
    </Card>
  );
}

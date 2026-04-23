"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Terminal, Loader2, AlertCircle, CheckCircle2, Search, Copy, Check, ChevronRight, ExternalLink, Zap } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
const DEFAULT_KEY_HEADER =
  process.env.NEXT_PUBLIC_CAIPE_CATALOG_API_KEY_HEADER ||
  "X-Caipe-Catalog-Key";


/**
 * Single-quote a value for safe inclusion in a bash snippet shown to the
 * user. Mirrors the server-side `shq()` in install.sh/route.ts. We do NOT
 * try to be clever with `"…"`: single quotes are safer for arbitrary user
 * input (including API keys with `$`, `&`, or backticks).
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function TrySkillsGateway() {
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedBulkOneLiner, setCopiedBulkOneLiner] = useState(false);
  const [copiedBulkUpgrade, setCopiedBulkUpgrade] = useState(false);
  const [copiedQuickInstall, setCopiedQuickInstall] = useState(false);
  const [quickInstallOpen, setQuickInstallOpen] = useState(false);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  // Bootstrap skill customization
  const [skillCommandName, setSkillCommandName] = useState("skills");
  const [skillDescription, setSkillDescription] = useState(
    "Browse and install skills from the CAIPE skill catalog",
  );
  // Selected coding agent (drives install path, file format, and launch guide).
  const [selectedAgent, setSelectedAgent] = useState<string>("claude");
  // Install scope: "user" (~/...) or "project" (./...). null = user has not
  // picked yet, in which case we hide the install/installer commands and
  // prompt the user to choose. Reset whenever the agent changes so we don't
  // show a scope the new agent does not support.
  type InstallScope = "user" | "project";
  const [selectedScope, setSelectedScope] = useState<InstallScope | null>(null);
  // Agent file-system layout for skill artifacts. `commands` is the legacy
  // <dir>/commands/{name}.<ext> single-file layout (Codex, Spec Kit, Continue,
  // Gemini); `skills` is the modern <dir>/skills/{name}/SKILL.md per-skill-dir
  // layout standardized by Claude Code (Oct 2025), Cursor, and opencode.
  // null = "use the agent's documented default" (skills where supported,
  // commands otherwise) so users get the right behavior without thinking.
  type AgentLayout = "commands" | "skills";
  const [selectedLayout, setSelectedLayout] = useState<AgentLayout | null>(null);
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);
  const [copiedUpgrade, setCopiedUpgrade] = useState(false);
  const [copiedDownload, setCopiedDownload] = useState(false);

  // Per-agent rendered bootstrap (fetched from
  // /api/skills/bootstrap?agent=<id>&command_name=...&description=...).
  // The server resolves the canonical template from SKILLS_BOOTSTRAP_TEMPLATE,
  // SKILLS_BOOTSTRAP_FILE, the chart default, or a built-in fallback, then
  // renders it for the selected agent (Markdown frontmatter, plain Markdown,
  // Gemini TOML, or Continue JSON fragment).
  interface AgentMeta {
    id: string;
    label: string;
    ext: string;
    format: string;
    /** Per-scope install paths; absent keys mean the agent does not support that scope. */
    install_paths: Partial<Record<InstallScope, string>>;
    /** Scopes this agent actually supports. */
    scopes_available: InstallScope[];
    is_fragment: boolean;
    docs_url?: string;
    /** Per-layout, per-scope install paths. Server emits a sub-map per
     *  layout the agent supports (`commands`, `skills`). Used to render
     *  the layout toggle and resolve paths client-side without a refetch. */
    install_paths_by_layout?: Partial<
      Record<AgentLayout, Partial<Record<InstallScope, string>>>
    >;
    /** Agent's documented default layout. Used as the toggle's initial
     *  value when `selectedLayout` is null. */
    default_layout?: AgentLayout;
  }
  interface BootstrapResponse {
    agent: string;
    label: string;
    template: string;
    /** Resolved path for the requested scope, or null if no scope selected / unsupported. */
    install_path: string | null;
    install_paths: Partial<Record<InstallScope, string>>;
    scope: InstallScope | null;
    scope_requested: InstallScope | null;
    scope_fallback: boolean;
    scopes_available: InstallScope[];
    file_extension: string;
    format: string;
    is_fragment: boolean;
    launch_guide: string;
    docs_url?: string;
    agents: AgentMeta[];
    source: string;
    /** Resolved layout for this render (after any fallback). */
    layout?: AgentLayout;
    /** What the client requested (or null if it accepted the default). */
    layout_requested?: AgentLayout | null;
    /** True iff the requested layout was unsupported and we fell back. */
    layout_fallback?: boolean;
    /** Layouts this agent supports, in display order (default first). */
    layouts_available?: AgentLayout[];
  }
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [bootstrapTemplateSource, setBootstrapTemplateSource] = useState<
    string | null
  >(null);
  const [agents, setAgents] = useState<AgentMeta[]>([]);

  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [mintBusy, setMintBusy] = useState(false);
  // The "Active / past keys" list was removed per PR #1268 review feedback;
  // revocation/listing lives on the admin page now, so this component no
  // longer needs to fetch /api/catalog-api-keys.

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

  useEffect(() => {
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
  }, []);

  // Re-fetch the per-agent rendered bootstrap whenever the agent, scope,
  // command name, or description changes. Debounced lightly so typing is
  // smooth. Scope is optional (null = "ask the user first"); if set we
  // forward it so the response carries an `install_path` for the chosen
  // location.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        agent: selectedAgent,
        command_name: skillCommandName.trim() || "skills",
      });
      if (selectedScope) params.set("scope", selectedScope);
      if (selectedLayout) params.set("layout", selectedLayout);
      const desc = skillDescription.trim();
      if (desc) params.set("description", desc);
      fetch(`/api/skills/bootstrap?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: BootstrapResponse | null) => {
          if (!data || typeof data.template !== "string") return;
          setBootstrap(data);
          if (typeof data.source === "string") {
            setBootstrapTemplateSource(data.source);
          }
          if (Array.isArray(data.agents)) setAgents(data.agents);
        })
        .catch((err) => {
          if (err?.name !== "AbortError") {
            // Soft-fail; UI shows a fallback notice.
          }
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedAgent, selectedScope, selectedLayout, skillCommandName, skillDescription]);

  // When the user switches agents, drop any scope choice that the new agent
  // does not support (e.g. moving from Claude → Codex with scope=project, or
  // → Spec Kit with scope=user). Falls back to whichever single scope is
  // available, or null when both are valid (force the user to pick again).
  useEffect(() => {
    const meta = agents.find((a) => a.id === selectedAgent);
    if (!meta) return; // first paint, before /api/skills/bootstrap returns
    if (selectedScope && !meta.scopes_available.includes(selectedScope)) {
      setSelectedScope(
        meta.scopes_available.length === 1 ? meta.scopes_available[0] : null,
      );
    }
    // Same dance for layout: dropping the choice when the target agent
    // doesn't expose it (e.g. skills→commands when moving Claude→Codex).
    // null means "use the agent's documented default", so we don't have to
    // pick one for them.
    const layoutsAvail = meta.install_paths_by_layout
      ? (Object.keys(meta.install_paths_by_layout) as AgentLayout[])
      : (["commands"] as AgentLayout[]);
    if (selectedLayout && !layoutsAvail.includes(selectedLayout)) {
      setSelectedLayout(null);
    }
  }, [selectedAgent, agents, selectedScope, selectedLayout]);

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

  // Always show a placeholder in copy-paste snippets, even after the user
  // has just minted a key. The minted value is shown ONCE in the dedicated
  // "Copy once" callout under the Generate button — interleaving it into
  // every example contradicts the "save it now, we can't show it again"
  // warning and makes users assume the value is recoverable later. Per
  // PR #1268 review feedback (Jeff Napper).
  const keyPlaceholder = "<key_id.secret>";

  const curlKey = `curl -sS "${catalogUrl}" \\\n  -H "${DEFAULT_KEY_HEADER}: ${keyPlaceholder}"`;

  // Sanitize the slash command name for display purposes (the server
  // performs its own sanitization for the rendered artifact).
  const safeCommandName = (skillCommandName.trim() || "skills")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "") || "skills";

  // Rendered artifact + metadata from the server (per selected agent).
  // Falls back to placeholders while the first fetch is in flight.
  const bootstrapSkillContent =
    bootstrap?.template ?? "# Loading bootstrap skill template…\n";
  const installPath = bootstrap?.install_path ?? null;
  const isFragment = bootstrap?.is_fragment ?? false;
  const launchGuide = bootstrap?.launch_guide ?? "";
  const agentLabel = bootstrap?.label ?? "Claude Code";
  const agentDocsUrl = bootstrap?.docs_url;
  const scopesAvailable: InstallScope[] =
    bootstrap?.scopes_available ?? ["user", "project"];

  // Build the heredoc-style install command, scoped to the picked location.
  // null when the user hasn't picked a scope yet (UI hides the block in that
  // case so users don't run a half-resolved command).
  const installCommands = (() => {
    if (!installPath) return null;
    if (isFragment) {
      return `# ${agentLabel} stores commands as JSON fragments inside\n# ${installPath}. Merge the fragment shown in "Preview generated skill"\n# below into the top-level "slashCommands" array of that file.`;
    }
    const dir = installPath.replace(/\/[^/]+$/, "") || ".";
    const expandedDir = dir.startsWith("~/")
      ? `"$HOME/${dir.slice(2)}"`
      : dir;
    const expandedPath = installPath.startsWith("~/")
      ? `"$HOME/${installPath.slice(2)}"`
      : installPath;
    return `mkdir -p ${expandedDir}\ncat > ${expandedPath} << 'SKILL'\n${bootstrapSkillContent}${
      bootstrapSkillContent.endsWith("\n") ? "" : "\n"
    }SKILL`;
  })();

  // Build the curl|bash one-liner and the "download then run" snippet for
  // the install.sh endpoint. install.sh reads the API key from
  // `~/.config/caipe/config.json` (set up in Step 1), so we deliberately do
  // NOT inject `CAIPE_CATALOG_KEY=…` into the snippets — the recommended
  // path is "Step 1 once, then a clean curl one-liner forever after." Users
  // who haven't completed Step 1 yet get a clear error from install.sh
  // itself telling them to create the config file or pass --api-key=…
  const installerSnippets = (() => {
    if (!selectedScope) return null;
    const installShUrl = `${baseUrl}/api/skills/install.sh?agent=${encodeURIComponent(
      selectedAgent,
    )}&scope=${encodeURIComponent(selectedScope)}&command_name=${encodeURIComponent(
      safeCommandName,
    )}${
      selectedLayout ? `&layout=${encodeURIComponent(selectedLayout)}` : ""
    }`;
    const oneLiner = `curl -fsSL ${shellQuote(installShUrl)} | bash`;
    // Upgrade variant: forwards `--upgrade` to the script via `bash -s`,
    // which is `bash`'s standard way of passing flags to a piped script.
    const oneLinerUpgrade = `curl -fsSL ${shellQuote(installShUrl)} | bash -s -- --upgrade`;
    const downloadSnippet = `curl -fsSL -o install-skills.sh ${shellQuote(installShUrl)}\nchmod +x ./install-skills.sh\n./install-skills.sh`;
    return { oneLiner, oneLinerUpgrade, downloadSnippet, installShUrl };
  })();

  // Bulk-install one-liner driven by the "Pick your skills" panel. Reuses
  // the same /api/skills/install.sh endpoint, but adds ?catalog_url=… so the
  // generated script writes one file per catalog skill instead of installing
  // the bootstrap skill. Disabled when the agent is fragment-config (Continue)
  // or when no scope has been chosen yet.
  const bulkInstallerSnippet = (() => {
    if (!selectedScope) return null;
    const meta = agents.find((a) => a.id === selectedAgent);
    if (meta?.is_fragment) return null;
    const previewSkillCount =
      previewData?.skills && Array.isArray(previewData.skills)
        ? previewData.skills.length
        : 0;
    if (previewSkillCount === 0) return null;
    const installShUrl = `${baseUrl}/api/skills/install.sh?agent=${encodeURIComponent(
      selectedAgent,
    )}&scope=${encodeURIComponent(selectedScope)}&catalog_url=${encodeURIComponent(catalogUrl)}${
      selectedLayout ? `&layout=${encodeURIComponent(selectedLayout)}` : ""
    }`;
    // No CAIPE_CATALOG_KEY=… injection — install.sh reads the key from
    // ~/.config/caipe/config.json (Step 1). See installerSnippets above.
    const oneLiner = `curl -fsSL ${shellQuote(installShUrl)} | bash`;
    const oneLinerUpgrade = `curl -fsSL ${shellQuote(installShUrl)} | bash -s -- --upgrade`;
    return { oneLiner, oneLinerUpgrade, installShUrl, count: previewSkillCount };
  })();

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          How to use Skills API Gateway with coding agents
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick the skills you want, generate an API key, and copy a one-line
          installer for your coding agent (Claude Code, Cursor, Codex, Gemini
          CLI, and more).
        </p>
      </div>

      {/* Catalog Query Builder */}
      <Card className="border-border/80 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Search className="h-5 w-5" />
            Step 1: Pick your skills
          </CardTitle>
          <CardDescription>
            Build a catalog URL interactively and preview results.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="inline-flex items-start gap-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-[11px] leading-relaxed">
            <span className="font-semibold text-primary uppercase tracking-wide">
              Hint
            </span>
            <span className="text-muted-foreground">
              Try <code className="font-mono text-foreground">github</code> in
              Search and pick an{" "}
              <code className="font-mono text-foreground">example</code>{" "}
              repository from the Repository dropdown to see what a real result
              set looks like.
            </span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <label className="text-xs font-medium text-muted-foreground">Search (q)</label>
              <input
                type="text"
                value={queryQ}
                onChange={(e) => { setQueryQ(e.target.value); setShowSearchSuggestions(true); }}
                onFocus={() => setShowSearchSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSearchSuggestions(false), 150)}
                placeholder="e.g. github, aws, kubernetes"
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

          <div className="flex items-center gap-2 flex-wrap">
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
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={() => setQuickInstallOpen(true)}
              className="gap-1"
            >
              <Zap className="h-3.5 w-3.5" />
              Quick install
            </Button>
          </div>
          {previewData?.meta?.total != null && (
            <p className="text-xs text-muted-foreground">
              {previewData.meta.total} skill{previewData.meta.total !== 1 ? "s" : ""} found
            </p>
          )}

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
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[200px] lg:max-w-[420px]">{skill.description}</td>
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

          {/* Bulk install action bar — wires the Query Builder's catalog URL
              into /api/skills/install.sh?catalog_url=… so each previewed
              skill is written as a slash-command file for the chosen
              coding agent + scope. Reuses the agent/scope pickers from the
              bootstrap card above (state lives on the parent). */}
          {previewData?.skills && previewData.skills.length > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-medium text-foreground">
                  Install these {previewData.skills.length} skill
                  {previewData.skills.length === 1 ? "" : "s"} as slash commands
                </div>
                <div className="text-xs text-muted-foreground">
                  agent:{" "}
                  <span className="font-mono">{selectedAgent}</span>
                  {" · "}
                  scope:{" "}
                  <span className="font-mono">
                    {selectedScope ?? "(pick above)"}
                  </span>
                </div>
              </div>
              {bulkInstallerSnippet ? (
                <>
                  <div className="relative group">
                    <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
                      {bulkInstallerSnippet.oneLiner}
                    </pre>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          bulkInstallerSnippet.oneLiner,
                        );
                        setCopiedBulkOneLiner(true);
                        setTimeout(() => setCopiedBulkOneLiner(false), 2000);
                      }}
                    >
                      {copiedBulkOneLiner ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Already installed? Upgrade
                    </summary>
                    <div className="relative group mt-2">
                      <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
                        {bulkInstallerSnippet.oneLinerUpgrade}
                      </pre>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            bulkInstallerSnippet.oneLinerUpgrade,
                          );
                          setCopiedBulkUpgrade(true);
                          setTimeout(() => setCopiedBulkUpgrade(false), 2000);
                        }}
                      >
                        {copiedBulkUpgrade ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </details>
                  <p className="text-[11px] text-muted-foreground">
                    Writes one file per skill into the {selectedAgent} commands
                    directory. Existing files are skipped unless you re-run
                    with <code className="font-mono">--upgrade</code> (only
                    overwrites files this script previously wrote) or{" "}
                    <code className="font-mono">--force</code>.
                  </p>
                </>
              ) : (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  {agents.find((a) => a.id === selectedAgent)?.is_fragment
                    ? `${selectedAgent} stores commands inside an editor config file; bulk install is disabled. Install skills individually or use a non-fragment agent.`
                    : "Pick an install scope (user-global or project-local) on the bootstrap card above to enable the install command."}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate API Key */}
      <Card className="border-border/80 bg-card/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Terminal className="h-5 w-5" />
            Step 2: Generate API Key
          </CardTitle>
          <CardDescription>
            Create a catalog API key so scripts and installers can call the same catalog as
            the UI and supervisor. Invalid authentication returns <strong>401</strong> with a
            generic body (no account enumeration).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="font-medium text-foreground mb-1">Base URL</p>
            <CopyableBlock
              text={baseUrl}
              as="code"
              ariaLabel="Copy base URL"
            />
          </div>

          <div>
            <p className="font-medium text-foreground mb-1">Catalog API key</p>
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
              Generate new catalog API key
            </Button>
            {mintedKey ? (
              <span className="text-xs text-amber-600 dark:text-amber-400 break-all">
                Copy once: <code>{mintedKey}</code>
              </span>
            ) : null}
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            <strong>Save this key somewhere safe.</strong> Only the secret hash is stored, so
            we cannot show it again. If you lose it, generate a new one and update any
            scripts, env vars, or installers that use it. Previously-issued keys keep working
            until an admin revokes them.
          </p>
          {/* The "Active / past keys" listing was dropped per PR #1268 review
              feedback (Jeff Napper #7): the line was confusing because it
              showed key IDs but no useful action — revocation lives on the
              admin page. */}

          <div className="border-t border-border pt-4 text-xs text-muted-foreground">
            Supervisor sync status and the <strong>Refresh skills</strong> action live on the
            admin page —{" "}
            <Link
              href="/admin?tab=skills"
              className="text-primary font-medium hover:underline inline-flex items-center gap-0.5"
            >
              open Admin → Skills
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </Link>
            .
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Terminal className="h-5 w-5" />
            Step 3: Install skills
          </CardTitle>
          <CardDescription>
            Create a <code>/skills</code> slash command that lets your coding
            agent browse and install skills from this gateway. Works with
            Claude Code, Cursor, Codex, Gemini CLI, and more — pick your agent
            below.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm space-y-8 text-muted-foreground">
          <section>
            <p className="font-medium text-foreground mb-3 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                1
              </span>
              Configure your API key
            </p>
            <p className="text-xs text-muted-foreground mb-3 ml-8">
              Stores your catalog credentials so any coding agent on this
              machine can authenticate to the gateway.
            </p>
            <CopyableBlock
              className="p-4"
              ariaLabel="Copy config snippet"
              text={`mkdir -p ~/.config/caipe
cat > ~/.config/caipe/config.json << 'EOF'
{
  "api_key": "<your-catalog-api-key>",
  "base_url": "${baseUrl}"
}
EOF`}
            />
          </section>

          <section className="space-y-5">
            <p className="font-medium text-foreground flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                2
              </span>
              Install the bootstrap skill
            </p>
            <p className="ml-8 leading-relaxed">
              Most users should hit{" "}
              <span className="font-semibold text-foreground">
                Quick install
              </span>{" "}
              — pick agent + scope, copy one curl command, done. Need a
              custom slash command name, description, or want to inspect the
              rendered file first? Open{" "}
              <span className="font-semibold text-foreground">
                Advanced
              </span>{" "}
              below.
            </p>

            {/* PRIMARY ACTION — Quick install. Per Shubham Bakshi's review
                feedback (PR #1268): the per-agent customization grid is
                overwhelming for the common case, so we surface Quick install
                as the front-and-center primary CTA and tuck the grid into a
                collapsible "Advanced" disclosure. */}
            <div className="ml-8 rounded-lg border-2 border-primary/40 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-primary" />
                  Recommended: Quick install
                </p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Opens a single-screen dialog: pick agent + scope → get one
                  curl command. Uses sensible defaults for the slash command
                  name and description.
                </p>
              </div>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => setQuickInstallOpen(true)}
                className="gap-1.5 shrink-0 self-start sm:self-auto"
              >
                <Zap className="h-3.5 w-3.5" />
                Quick install
              </Button>
            </div>

            <details className="ml-8 group rounded-md border border-border bg-background/40 [&[open]>summary]:border-b [&[open]>summary]:border-border">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-2">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                Advanced — customize the slash command (name, description,
                preview the rendered file)
              </summary>
              <div className="p-4 space-y-5">
            <div className="inline-flex items-start gap-2 rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-[11px] leading-relaxed">
              <span className="font-semibold text-primary uppercase tracking-wide">
                Tip
              </span>
              <span className="text-muted-foreground">
                Pick an agent <span className="text-foreground">→</span> pick a
                scope <span className="text-foreground">→</span> copy the
                highlighted install command.
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Slash command name
                </label>
                <div className="flex items-center mt-1">
                  <span className="px-2 py-2 text-sm bg-muted border border-r-0 border-border rounded-l-md text-muted-foreground">
                    /
                  </span>
                  <input
                    type="text"
                    value={skillCommandName}
                    onChange={(e) => setSkillCommandName(e.target.value)}
                    placeholder="skills"
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-r-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Becomes <code>{safeCommandName}.md</code> in your commands directory.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground">Description</label>
                <input
                  type="text"
                  value={skillDescription}
                  onChange={(e) => setSkillDescription(e.target.value)}
                  placeholder="Browse and install skills from the CAIPE skill catalog"
                  className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Shown in the slash-command picker.
                </p>
              </div>
            </div>

            <div className="pt-4">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                  a
                </span>
                Coding agent
              </label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {(agents.length > 0
                  ? agents
                  : [
                      {
                        id: "claude",
                        label: "Claude Code",
                        ext: "md",
                        format: "markdown-frontmatter",
                        install_paths: {
                          user: "~/.claude/commands/skills.md",
                          project: "./.claude/commands/skills.md",
                        },
                        scopes_available: ["user", "project"] as InstallScope[],
                        is_fragment: false,
                      } as AgentMeta,
                    ]
                ).map((a) => {
                  // Show one of the agent's install paths in the option label
                  // so the user has a hint of where this agent installs.
                  // Prefer project-local for git-trackable agents (Claude,
                  // Cursor, Spec Kit, Gemini, Continue) and user-global for
                  // Codex (no project scope).
                  const previewPath =
                    a.install_paths?.project ??
                    a.install_paths?.user ??
                    "";
                  return (
                    <option key={a.id} value={a.id}>
                      {a.label}
                      {previewPath ? ` — ${previewPath}` : ""}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                Selected agent determines the install path, file format
                ({bootstrap?.format ?? "markdown-frontmatter"}), and the
                argument syntax baked into the prompt.
                {agentDocsUrl ? (
                  <>
                    {" "}
                    <a
                      href={agentDocsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      {agentLabel} docs
                    </a>
                    .
                  </>
                ) : null}
              </p>
            </div>

            {/* Layout toggle: skills/<name>/SKILL.md (Claude Code Oct 2025
                + Cursor + opencode) vs the legacy <agent>/commands/{name}.md
                file. Only visible for agents that support BOTH layouts —
                otherwise the choice is forced. Defaults to the agent's
                documented default (skills for Claude/Cursor, commands for
                everyone else) so users get the right behavior on first paint
                without having to think about it. Per Shubham Bakshi review
                feedback (#1268, point C). */}
            {(() => {
              const meta = agents.find((a) => a.id === selectedAgent);
              const layoutsAvail = meta?.install_paths_by_layout
                ? (Object.keys(meta.install_paths_by_layout) as AgentLayout[])
                : (["commands"] as AgentLayout[]);
              if (layoutsAvail.length < 2) return null;
              const effectiveLayout: AgentLayout =
                selectedLayout ?? meta?.default_layout ?? layoutsAvail[0];
              return (
                <div className="mt-2 rounded-md bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    File layout
                    <span className="ml-1 text-[11px] font-normal opacity-70">
                      ({agentLabel} supports both)
                    </span>
                  </p>
                  <div className="flex flex-col gap-2">
                    {layoutsAvail.map((layout) => {
                      const isSelected = effectiveLayout === layout;
                      const paths = meta?.install_paths_by_layout?.[layout];
                      // Show the path that matches whichever scope is currently
                      // picked; fall back to user-scope, then any available path
                      // so the example never collapses to "undefined".
                      const examplePath =
                        (selectedScope && paths?.[selectedScope]) ||
                        paths?.user ||
                        paths?.project ||
                        "";
                      const labelText =
                        layout === "skills"
                          ? "Skills layout (SKILL.md per directory)"
                          : "Commands layout (one .md file per command)";
                      const sub =
                        layout === "skills"
                          ? "Auto-discovered by Claude Code, Cursor, opencode."
                          : "Legacy slash-command layout. Pick this for portability with older agent versions.";
                      return (
                        <label
                          key={layout}
                          className={`flex items-start gap-2 rounded-md border p-2 cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "border-border bg-background/50 hover:bg-muted/30"
                          }`}
                        >
                          <input
                            type="radio"
                            name="agent-layout"
                            value={layout}
                            checked={isSelected}
                            onChange={() => setSelectedLayout(layout)}
                            className="mt-1"
                          />
                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            <span className="text-sm font-medium">
                              {labelText}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {sub}
                            </span>
                            {examplePath ? (
                              <code className="text-[11px] font-mono text-muted-foreground break-all">
                                {examplePath}
                              </code>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Scope chooser: user (~/) vs project (./). Some agents only
                support one of these (Codex = user-only, Spec Kit = project-
                only) — we disable the unavailable radio rather than hide it
                so the asymmetry is visible.

                When the user has chosen an agent but not a scope, ring-
                highlight this block so the eye lands on "the next thing to
                do". */}
            <div
              className={`mt-2 rounded-md p-3 transition-colors ${
                !selectedScope
                  ? "ring-1 ring-amber-500/50 bg-amber-500/5"
                  : "bg-muted/20"
              }`}
            >
              <p
                className={`flex items-center gap-2 text-xs font-semibold mb-3 ${
                  !selectedScope
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground font-medium"
                }`}
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                    !selectedScope
                      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
                      : "bg-primary/15 text-primary"
                  }`}
                >
                  b
                </span>
                Where to install?
              </p>
              <div className="flex flex-col gap-2">
                {(["user", "project"] as InstallScope[]).map((s) => {
                  const supported = scopesAvailable.includes(s);
                  const path = bootstrap?.install_paths?.[s];
                  const isSelected = selectedScope === s;
                  const labelText =
                    s === "user"
                      ? "User-wide (reused across all projects)"
                      : "Project-local (committed with this repo)";
                  return (
                    <label
                      key={s}
                      className={`flex items-start gap-3 text-xs rounded-md border px-3 py-2 transition-colors ${
                        supported
                          ? `cursor-pointer hover:bg-background/60 ${
                              isSelected
                                ? "border-primary/60 bg-background"
                                : "border-border/60 bg-background/30"
                            }`
                          : "cursor-not-allowed opacity-50 border-border/40"
                      }`}
                      title={
                        supported
                          ? path
                          : `${agentLabel} does not support ${s}-scope commands.`
                      }
                    >
                      <input
                        type="radio"
                        name="install-scope"
                        value={s}
                        checked={isSelected}
                        disabled={!supported}
                        onChange={() =>
                          supported && setSelectedScope(s)
                        }
                        className="mt-0.5"
                      />
                      <span className="flex-1 leading-relaxed">
                        <span className="block font-medium text-foreground">
                          {labelText}
                        </span>
                        {path ? (
                          <code className="block mt-0.5 text-[11px] text-muted-foreground font-mono">
                            {path}
                          </code>
                        ) : null}
                        {!supported ? (
                          <span className="block mt-0.5 text-[11px] text-muted-foreground italic">
                            Not supported by {agentLabel}.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              {!selectedScope ? (
                <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-3 w-3" />
                  Pick an install scope to reveal the install command
                </p>
              ) : installPath ? (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Installing to{" "}
                  <code className="font-mono">{installPath}</code>
                </p>
              ) : null}
            </div>

            {selectedScope && installCommands ? (
              <>
                {/*
                 * Visual hierarchy:
                 *   1. The one-line `curl … | bash` installer is the
                 *      happy path for non-fragment agents — show it FIRST.
                 *   2. The manual `mkdir … && cat <<SKILL` block is the
                 *      escape hatch for users who can't / won't run a
                 *      remote shell script — tuck it behind a disclosure.
                 *   3. Fragment agents (Continue) have no installer
                 *      one-liner because the script can't safely merge
                 *      JSON config — for them we surface the merge
                 *      fragment directly with no disclosure.
                 */}
                {installerSnippets && !isFragment ? (
                  <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 p-4 shadow-sm space-y-4">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-foreground mb-1">
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                          c
                        </span>
                        Install with one command
                        <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                          Recommended
                        </span>
                      </p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed ml-6">
                        Runs an install script that fetches the latest
                        rendered template from this gateway and writes it to{" "}
                        <code className="text-foreground">
                          {installPath}
                        </code>
                        .
                      </p>
                    </div>

                    <div className="relative group">
                      <pre className="rounded-md bg-background p-4 pr-10 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap">
                        {installerSnippets.oneLiner}
                      </pre>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          void navigator.clipboard.writeText(
                            installerSnippets.oneLiner,
                          );
                          setCopiedOneLiner(true);
                          setTimeout(() => setCopiedOneLiner(false), 2000);
                        }}
                      >
                        {copiedOneLiner ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>

                    <div className="border-t border-primary/15 pt-3 space-y-2">
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                        Already installed? Upgrade to the latest version
                      </summary>
                      <div className="mt-3 space-y-3 pl-4 border-l-2 border-primary/20">
                        <p className="text-[11px] text-muted-foreground">
                          Adds <code>--upgrade</code>, which only overwrites
                          a file that this installer wrote previously
                          (recognized by a <code>caipe-skill</code> marker).
                          Falls back to a clear error if the file at the
                          target path wasn&apos;t installed by this script —
                          use <code>--force</code> in that case if you
                          really want to clobber it.
                        </p>
                        <div className="relative group">
                          <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                            {installerSnippets.oneLinerUpgrade}
                          </pre>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                installerSnippets.oneLinerUpgrade,
                              );
                              setCopiedUpgrade(true);
                              setTimeout(() => setCopiedUpgrade(false), 2000);
                            }}
                          >
                            {copiedUpgrade ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </details>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                        Prefer to inspect the script first?
                      </summary>
                      <div className="mt-3 space-y-3 pl-4 border-l-2 border-primary/20">
                        <p className="text-[11px] text-muted-foreground">
                          Download the installer with{" "}
                          <a
                            className="text-primary underline"
                            href={installerSnippets.installShUrl}
                          >
                            this link
                          </a>
                          , read it, then run it:
                        </p>
                        <div className="relative group">
                          <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                            {installerSnippets.downloadSnippet}
                          </pre>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              void navigator.clipboard.writeText(
                                installerSnippets.downloadSnippet,
                              );
                              setCopiedDownload(true);
                              setTimeout(() => setCopiedDownload(false), 2000);
                            }}
                          >
                            {copiedDownload ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </details>

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                        Show manual install command (no script)
                      </summary>
                      <div className="mt-3 space-y-3 pl-4 border-l-2 border-primary/20">
                        <p className="text-[11px] text-muted-foreground">
                          Same end result as the one-liner above, but writes
                          the rendered template inline with{" "}
                          <code>cat &lt;&lt;SKILL</code>. Use this if you
                          can&apos;t pipe a remote script into{" "}
                          <code>bash</code>, or if you want to vendor the
                          file into a repo by hand.
                        </p>
                        <div className="relative group">
                          <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                            {installCommands}
                          </pre>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              void navigator.clipboard.writeText(installCommands);
                              setCopiedInstall(true);
                              setTimeout(() => setCopiedInstall(false), 2000);
                            }}
                          >
                            {copiedInstall ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    </details>

                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-primary/15 pt-3">
                      <span className="font-medium text-foreground">
                        Security:
                      </span>{" "}
                      the script never echoes your API key. The recommended
                      path is to put the key in{" "}
                      <code>~/.config/caipe/config.json</code> once (Step 1)
                      — install.sh reads it from there.{" "}
                      <code>--api-key=…</code> and{" "}
                      <code>CAIPE_CATALOG_KEY=…</code> still work, but both
                      can leak: <code>--api-key</code> shows up in{" "}
                      <code>ps</code> output to other users on the host, and
                      either form lands in your shell history.
                    </p>
                  </div>
                ) : (
                  /*
                   * Fragment agents (Continue) and any future scope/agent
                   * combo without a one-line installer get the manual
                   * command surfaced directly — there's nothing to hide
                   * behind, since the manual block IS the only path.
                   */
                  <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                    <p className="flex items-center gap-2 text-xs font-medium text-foreground mb-1">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                        c
                      </span>
                      {isFragment
                        ? `Generated config fragment for ${agentLabel}`
                        : `Install command for ${agentLabel} (${selectedScope})`}
                      {isFragment ? (
                        <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                          Manual merge
                        </span>
                      ) : null}
                    </p>
                    <div className="relative group mb-4">
                      <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                        {installCommands}
                      </pre>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => {
                          void navigator.clipboard.writeText(installCommands);
                          setCopiedInstall(true);
                          setTimeout(() => setCopiedInstall(false), 2000);
                        }}
                      >
                        {copiedInstall ? (
                          <Check className="h-3.5 w-3.5 text-green-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : null}

            <p className="text-[11px] text-muted-foreground mt-4 mb-2 leading-relaxed">
              Template source:{" "}
              <code>{bootstrapTemplateSource ?? "loading…"}</code>
              {". Override via Helm value "}
              <code>skillsBootstrap</code>
              {" (inline) or "}
              <code>skillsBootstrapName</code>
              {" (selects "}
              <code>data/skills/bootstrap.&lt;name&gt;.md</code>
              {"), or container env "}
              <code>SKILLS_BOOTSTRAP_FILE</code>
              {" / "}
              <code>SKILLS_BOOTSTRAP_TEMPLATE</code>.
            </p>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Preview generated skill ({bootstrap?.file_extension ?? "md"})
              </summary>
              <div className="relative group mt-2">
                <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {bootstrapSkillContent}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    void navigator.clipboard.writeText(bootstrapSkillContent);
                    setCopiedSkill(true);
                    setTimeout(() => setCopiedSkill(false), 2000);
                  }}
                >
                  {copiedSkill ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </details>
              </div>
            </details>
          </section>

          <section>
            <p className="font-medium text-foreground mb-3 flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                3
              </span>
              Launch {agentLabel} and use it
            </p>
            <div className="ml-8">
              <LaunchGuide markdown={launchGuide} commandName={safeCommandName} />
            </div>
          </section>
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

      {/*
        Quick-install modal: lets the user pick agent + scope and grab a
        single curl-pipe-bash one-liner without scrolling through Steps 2
        and 3. State (selectedAgent, selectedScope) is shared with Step 3,
        so picking here also pre-selects the detailed install card below.

        The same constraints as the inline bulk action bar apply:
        - fragment agents (Continue) cannot use the bulk script
        - the agent must support the chosen scope (radios disable themselves)
        - the API key is taken from `mintedKey` (just-minted on this page)
          and falls back to a placeholder so the user knows where to paste
      */}
      <Dialog open={quickInstallOpen} onOpenChange={setQuickInstallOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Quick install
            </DialogTitle>
            <DialogDescription>
              Pick your coding agent and where to install. We&rsquo;ll
              generate a one-line installer that fetches your selected
              skills from the catalog URL above and writes them as slash
              commands.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Agent picker — same options as Step 3, kept compact. */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Coding agent
              </label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {(agents.length > 0
                  ? agents
                  : [
                      {
                        id: "claude",
                        label: "Claude Code",
                        ext: "md",
                        format: "markdown-frontmatter",
                        install_paths: {
                          user: "~/.claude/commands/skills.md",
                          project: "./.claude/commands/skills.md",
                        },
                        scopes_available: ["user", "project"] as InstallScope[],
                        is_fragment: false,
                      } as AgentMeta,
                    ]
                ).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Scope picker — matches Step 3 wording. */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Where to install?
              </label>
              <div className="mt-1 flex flex-col gap-2">
                {(["user", "project"] as InstallScope[]).map((s) => {
                  const supported = scopesAvailable.includes(s);
                  const path = bootstrap?.install_paths?.[s];
                  const isSelected = selectedScope === s;
                  const labelText =
                    s === "user"
                      ? "User-wide (reused across all projects)"
                      : "Project-local (committed with this repo)";
                  return (
                    <label
                      key={s}
                      className={`flex items-start gap-3 text-xs rounded-md border px-3 py-2 transition-colors ${
                        supported
                          ? `cursor-pointer hover:bg-muted/50 ${
                              isSelected
                                ? "border-primary/60 bg-primary/5"
                                : "border-border/60"
                            }`
                          : "cursor-not-allowed opacity-50 border-border/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="quick-install-scope"
                        value={s}
                        checked={isSelected}
                        disabled={!supported}
                        onChange={() =>
                          supported && setSelectedScope(s)
                        }
                        className="mt-0.5"
                      />
                      <span className="flex-1 leading-relaxed">
                        <span className="block font-medium text-foreground">
                          {labelText}
                        </span>
                        {path ? (
                          <code className="block mt-0.5 text-[11px] text-muted-foreground font-mono">
                            {path}
                          </code>
                        ) : null}
                        {!supported ? (
                          <span className="block mt-0.5 text-[11px] text-muted-foreground italic">
                            Not supported by {agentLabel}.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Result snippet (or guidance when blocked). */}
            <div className="border-t border-border pt-4">
              {(() => {
                const meta = agents.find((a) => a.id === selectedAgent);
                if (meta?.is_fragment) {
                  return (
                    <p className="text-xs text-amber-700 dark:text-amber-400 inline-flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      {agentLabel} uses a config-fragment install (not a
                      slash command), so the bulk one-liner doesn&rsquo;t
                      apply. Use the detailed instructions in Step 3.
                    </p>
                  );
                }
                if (!selectedScope) {
                  return (
                    <p className="text-xs text-muted-foreground inline-flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Pick an install scope above to generate the install
                      command.
                    </p>
                  );
                }
                const installShUrl = `${baseUrl}/api/skills/install.sh?agent=${encodeURIComponent(
                  selectedAgent,
                )}&scope=${encodeURIComponent(
                  selectedScope,
                )}&catalog_url=${encodeURIComponent(catalogUrl)}`;
                const targetPath =
                  bootstrap?.install_paths?.[selectedScope] ?? null;
                const skillCount = previewData?.meta?.total ?? null;
                // Single-line install snippet. install.sh reads the API key
                // from ~/.config/caipe/config.json (Step 1), so we don't
                // bake the key into the curl. This keeps the snippet short,
                // copy-pasteable, and makes the "API key cannot be
                // recovered" message in the key card actually true — we
                // never echo the key into examples after minting it.
                const oneLiner = `curl -fsSL ${shellQuote(installShUrl)} | bash`;
                return (
                  <div className="space-y-3">
                    {/* Summary chips: tell the user *what* will happen
                        before they read the curl. Each chip is a tiny
                        rounded badge with a label + value, separated by
                        bullets. */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
                        {skillCount != null
                          ? `${skillCount} skill${skillCount !== 1 ? "s" : ""}`
                          : "skills from catalog"}
                      </span>
                      <span className="text-muted-foreground">→</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground">
                        {agentLabel}
                      </span>
                      {targetPath ? (
                        <>
                          <span className="text-muted-foreground">at</span>
                          <code className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-foreground">
                            {targetPath}
                          </code>
                        </>
                      ) : null}
                    </div>

                    {/* API-key status row: clear gate above the snippet.
                        Green when ready, amber + inline Generate button
                        when missing. */}
                    {mintedKey ? (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          API key minted.
                        </div>
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                          ⚠ Copy it now and paste it into{" "}
                          <code className="font-mono">
                            ~/.config/caipe/config.json
                          </code>{" "}
                          (Step 1) — we cannot show it again:
                        </div>
                        <CopyableBlock
                          as="code"
                          text={mintedKey}
                          ariaLabel="Copy API key"
                        />
                      </div>
                    ) : (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400 flex-1 min-w-[200px]">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            <span className="font-medium">
                              API key required
                            </span>{" "}
                            — install.sh reads it from{" "}
                            <code className="font-mono">
                              ~/.config/caipe/config.json
                            </code>
                            . Generate one and finish Step 1 before running
                            the snippet.
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={mintBusy}
                          onClick={() => void handleMint()}
                          className="gap-1.5 shrink-0"
                        >
                          {mintBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Generate API key
                        </Button>
                      </div>
                    )}

                    {/* The actual one-liner. Multi-line + monospace so the
                        long install.sh URL is readable. Big, full-width
                        copy button so it's the primary action. */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-foreground">
                          Run this in your terminal
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 text-xs"
                          onClick={() => {
                            void navigator.clipboard.writeText(oneLiner);
                            setCopiedQuickInstall(true);
                            setTimeout(
                              () => setCopiedQuickInstall(false),
                              2000,
                            );
                          }}
                        >
                          {copiedQuickInstall ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                      {/* `whitespace-pre-wrap` preserves the newlines
                          between the export/curl steps, while `break-all`
                          wraps the long install.sh URL at any character so
                          it stays inside the dialog instead of forcing
                          horizontal scroll. */}
                      <pre className="rounded-md bg-muted p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-all">
                        {oneLiner}
                      </pre>
                      <p className="text-[11px] text-muted-foreground">
                        Idempotent and safe to re-run. Existing skill files
                        are skipped — pass{" "}
                        <code className="font-mono">--upgrade</code> to
                        overwrite.
                      </p>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="border-t border-border pt-3 text-[11px] text-muted-foreground">
              Want the manual heredoc, the{" "}
              <code className="font-mono">--upgrade</code> variant, or
              per-agent docs?{" "}
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={() => setQuickInstallOpen(false)}
              >
                Close and jump to Step 3 →
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Reusable copy-to-clipboard wrapper around a block of text. Renders the
 * content as `<pre>` (default) or `<code>` (`as="code"`) inside a `relative
 * group` div with an absolutely-positioned ghost button that flips between
 * a `Copy` and `Check` icon for ~2s after a successful copy.
 *
 * Each instance owns its own `copied` state so we can have many copyable
 * blocks on the same page (notably one per fenced code block in the
 * launch-guide markdown) without sharing state.
 */
function CopyableBlock({
  text,
  as = "pre",
  className = "",
  ariaLabel = "Copy to clipboard",
}: {
  text: string;
  as?: "pre" | "code";
  className?: string;
  ariaLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  // Keep visual parity with the existing inline copy blocks: muted bg,
  // rounded-md, small padding, room on the right for the button.
  const baseClasses =
    as === "code"
      ? `block rounded-md bg-muted px-3 py-2 pr-10 text-xs break-all ${className}`
      : `rounded-md bg-muted p-3 pr-10 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap ${className}`;
  return (
    <div className="relative group">
      {as === "code" ? (
        <code className={baseClasses}>{text}</code>
      ) : (
        <pre className={baseClasses}>{text}</pre>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        className="absolute top-1 right-1 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

/**
 * Minimal Markdown renderer for the per-agent launch guide returned by
 * /api/skills/bootstrap. Supports the subset our agent registry uses:
 *   - fenced code blocks (```...```)
 *   - blank-line separated paragraphs
 *   - **bold** and `inline code`
 *   - [link text](url) — opens in a new tab with rel="noreferrer"
 *   - {name} substituted with the slash-command name
 *
 * We intentionally avoid a full MD library to keep bundle size small and to
 * sidestep dangerouslySetInnerHTML (server controls the input, but defense
 * in depth — we never inject raw HTML). Unknown markdown is rendered as
 * plain text.
 */
function LaunchGuide({
  markdown,
  commandName,
}: {
  markdown: string;
  commandName: string;
}) {
  if (!markdown) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Launch instructions will appear here once the bootstrap template loads.
      </p>
    );
  }

  const text = markdown.replace(/\{name\}/g, commandName);

  // Split by fenced code blocks, preserving them as separate segments.
  const segments: { type: "code" | "prose"; content: string; lang?: string }[] =
    [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: "prose", content: text.slice(lastIndex, m.index) });
    }
    segments.push({ type: "code", content: m[2], lang: m[1] || undefined });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "prose", content: text.slice(lastIndex) });
  }

  return (
    <div className="space-y-4 text-sm">
      {segments.map((seg, idx) => {
        if (seg.type === "code") {
          return (
            <CopyableBlock
              key={idx}
              className="p-4"
              ariaLabel="Copy code block"
              text={seg.content.replace(/\n+$/, "")}
            />
          );
        }
        // Render prose: split on blank lines into paragraphs/list groups.
        const blocks = seg.content
          .split(/\n{2,}/)
          .map((b) => b.trim())
          .filter(Boolean);
        return (
          <div key={idx} className="space-y-3 text-sm text-foreground">
            {blocks.map((block, bIdx) => {
              const lines = block.split("\n");
              // Find the first list-line; everything before it is a heading
              // paragraph, everything from there on is the list. This handles
              // the common "**Use the command**:\n- foo\n- bar" pattern that
              // doesn't have a blank line between the header and the list.
              const firstListIdx = lines.findIndex(
                (l) => l.startsWith("- ") || l.startsWith("* "),
              );
              const allList =
                firstListIdx === 0 &&
                lines.every(
                  (l) => l.startsWith("- ") || l.startsWith("* "),
                );
              const headerThenList =
                firstListIdx > 0 &&
                lines
                  .slice(firstListIdx)
                  .every(
                    (l) => l.startsWith("- ") || l.startsWith("* "),
                  );

              if (allList || headerThenList) {
                const headerLines = headerThenList
                  ? lines.slice(0, firstListIdx)
                  : [];
                const listLines = headerThenList
                  ? lines.slice(firstListIdx)
                  : lines;
                return (
                  <div key={bIdx} className="space-y-2">
                    {headerLines.length > 0 ? (
                      <p className="text-sm text-foreground leading-relaxed">
                        {renderInline(headerLines.join(" "))}
                      </p>
                    ) : null}
                    <ul className="list-disc pl-5 space-y-1.5 text-sm text-foreground leading-relaxed">
                      {listLines.map((l, lIdx) => (
                        <li key={lIdx}>
                          {renderInline(l.replace(/^[-*]\s+/, ""))}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }
              return (
                <p key={bIdx} className="text-sm text-foreground leading-relaxed">
                  {renderInline(block.replace(/\n/g, " "))}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Render inline markdown — bold, inline code, and links — into React nodes.
 * Anything not matched is rendered as plain text. Links are opened in a new
 * tab with `rel="noreferrer"`. We never inject raw HTML.
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Combined regex: link, bold, code (in that priority order).
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    if (m[1] && m[2]) {
      // Validate the URL: only allow http(s) targets, no javascript: etc.
      let safe = false;
      try {
        const u = new URL(m[2]);
        safe = u.protocol === "http:" || u.protocol === "https:";
      } catch {
        safe = false;
      }
      if (safe) {
        out.push(
          <a
            key={`l${key++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {m[1]}
          </a>,
        );
      } else {
        out.push(m[1]);
      }
    } else if (m[3]) {
      out.push(<strong key={`b${key++}`}>{m[3]}</strong>);
    } else if (m[4]) {
      out.push(
        <code
          key={`c${key++}`}
          className="rounded bg-muted px-1 py-0.5 text-[0.85em]"
        >
          {m[4]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

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
  // Quick-install mode picker: pass nothing (default), `--upgrade`, or
  // `--force` to the install.sh script. Modeled as a single string with
  // three values so the radio-style UI can't end up in an illegal state
  // (both upgrade AND force) — install.sh's flag handling treats those
  // two as mutually exclusive (force always wins) and exposing both as
  // independent checkboxes would surface a footgun the script ignores.
  const [quickInstallMode, setQuickInstallMode] = useState<
    "default" | "upgrade" | "force"
  >("default");
  // When true, the rendered one-liner asks install.sh to also write
  // the /skills and /update-skills helper SKILL.md files. Default ON
  // because (a) Quick Install used to silently skip them when
  // ?catalog_url= was set (it forced mode=catalog-query, which has
  // DO_HELPERS=0) and (b) those two helpers are how users actually
  // search/refresh the catalog from inside Claude Code et al.
  const [quickInstallHelpers, setQuickInstallHelpers] = useState(true);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);

  // Live-skills skill customization
  const [skillCommandName, setSkillCommandName] = useState("skills");
  const [skillDescription, setSkillDescription] = useState(
    "Browse and install skills from the CAIPE skill catalog",
  );
  // After the skills-only overhaul, every supported agent (Claude Code,
  // Cursor, Codex CLI, Gemini CLI, opencode) reads the same
  // `agentskills.io` SKILL.md format, and the install writes to BOTH
  // ~/.claude/skills/<name>/SKILL.md AND ~/.agents/skills/<name>/SKILL.md
  // (the vendor-neutral mirror that Cursor/Codex/Gemini/opencode all
  // discover). We've also verified against the upstream agent docs that
  // only Claude does template substitution in the body (`$ARGUMENTS`,
  // `$N`); the other four read SKILL.md verbatim. So the agent picker
  // had no functional effect on what gets installed -- it only changed
  // the launch-guide footer + the success-card label. We pin Claude
  // here as the rendering default (its $ARGUMENTS token is treated as
  // plain text by the other four agents, so it is safe across the
  // board) and drop the picker from both Quick install and Step 3.
  const selectedAgent = "claude";
  // Install scope: "user" (~/...) or "project" (./...). Defaults to
  // "user" (the recommended choice -- per the new UX, project-scope
  // is hidden behind an Advanced disclosure so the common case works
  // without a click). Setting null would force a pre-flight pick.
  type InstallScope = "user" | "project";
  const [selectedScope, setSelectedScope] = useState<InstallScope | null>(
    "user",
  );
  // After the skills-only overhaul, every supported agent reads the same
  // agentskills.io SKILL.md format, so there's no layout toggle anymore.
  // The local `AgentLayout` alias is kept for compatibility with API JSON
  // that may still reference legacy fields, but no UI control consumes
  // it.
  type AgentLayout = "skills";
  const [copiedOneLiner, setCopiedOneLiner] = useState(false);
  const [copiedUpgrade, setCopiedUpgrade] = useState(false);
  const [copiedDownload, setCopiedDownload] = useState(false);
  // Uninstall flow has two flavors. Both invoke install.sh?mode=uninstall
  // but the --purge variant additionally removes ~/.config/caipe/config.json
  // (the gateway URL + api_key); we separate them so the user picks the
  // semantic they want without having to read the script first.
  const [copiedUninstall, setCopiedUninstall] = useState(false);
  const [copiedUninstallPurge, setCopiedUninstallPurge] = useState(false);
  const [copiedUninstallDryRun, setCopiedUninstallDryRun] = useState(false);

  // Per-agent rendered live-skills (fetched from
  // /api/skills/live-skills?agent=<id>&command_name=...&description=...).
  // The server resolves the canonical template from SKILLS_LIVE_SKILLS_TEMPLATE,
  // SKILLS_LIVE_SKILLS_FILE, the chart default, or a built-in fallback, then
  // renders it for the selected agent (Markdown frontmatter, plain Markdown,
  // Gemini TOML, or Continue JSON fragment).
  interface AgentMeta {
    id: string;
    label: string;
    /**
     * Per-scope install paths. Each scope maps to an array of universal
     * SKILL.md paths the install script writes to. The display path
     * (first entry) is what the UI shows; the rest are mirrors for
     * vendor-neutral agent discovery (`~/.agents/skills/...`).
     */
    install_paths: Partial<Record<InstallScope, string[] | readonly string[]>>;
    /** Scopes this agent actually supports. */
    scopes_available: InstallScope[];
    docs_url?: string;
  }
  interface LiveSkillsResponse {
    agent: string;
    label: string;
    template: string;
    /** Resolved first path for the requested scope (display only). */
    install_path: string | null;
    install_paths: Partial<Record<InstallScope, string[] | readonly string[]>>;
    scope: InstallScope | null;
    scope_requested: InstallScope | null;
    scope_fallback: boolean;
    scopes_available: InstallScope[];
    launch_guide: string;
    docs_url?: string;
    agents: AgentMeta[];
    source: string;
  }
  const [liveSkills, setLiveSkills] = useState<LiveSkillsResponse | null>(null);
  const [liveSkillsTemplateSource, setLiveSkillsTemplateSource] = useState<
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

  // Re-fetch the per-agent rendered live-skills whenever the agent, scope,
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
      const desc = skillDescription.trim();
      if (desc) params.set("description", desc);
      fetch(`/api/skills/live-skills?${params.toString()}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LiveSkillsResponse | null) => {
          if (!data || typeof data.template !== "string") return;
          setLiveSkills(data);
          if (typeof data.source === "string") {
            setLiveSkillsTemplateSource(data.source);
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
  }, [selectedAgent, selectedScope, skillCommandName, skillDescription]);

  // (Removed: the agent-change scope-reset effect is no longer needed.
  // The agent is pinned to Claude and every supported agent supports
  // both user and project scopes, so there is no per-agent scope
  // narrowing to apply.)

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
  const liveSkillsSkillContent =
    liveSkills?.template ?? "# Loading live-skills skill template…\n";
  const installPath = liveSkills?.install_path ?? null;
  // Fragment-config agents (Continue) are gone in the skills-only
  // overhaul; every supported agent uses the universal SKILL.md format.
  // Kept as a const for any leftover branches that conditionally render
  // fragment-only copy.
  const isFragment = false;
  const launchGuide = liveSkills?.launch_guide ?? "";
  const agentLabel = liveSkills?.label ?? "Claude Code";
  const agentDocsUrl = liveSkills?.docs_url;
  const scopesAvailable: InstallScope[] =
    liveSkills?.scopes_available ?? ["user", "project"];

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
    return `mkdir -p ${expandedDir}\ncat > ${expandedPath} << 'SKILL'\n${liveSkillsSkillContent}${
      liveSkillsSkillContent.endsWith("\n") ? "" : "\n"
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
    // Note: ?agent= is intentionally omitted. The install.sh route
    // defaults to Claude and the install is universal (writes to both
    // ~/.claude/skills/ and ~/.agents/skills/), so the only thing
    // ?agent= used to control was the success-card label. We keep
    // the URL short and copy-pasteable instead.
    const installShUrl = `${baseUrl}/api/skills/install.sh?scope=${encodeURIComponent(
      selectedScope,
    )}&command_name=${encodeURIComponent(safeCommandName)}`;
    const oneLiner = `curl -fsSL ${shellQuote(installShUrl)} | bash`;
    // Upgrade variant: forwards `--upgrade` to the script via `bash -s`,
    // which is `bash`'s standard way of passing flags to a piped script.
    const oneLinerUpgrade = `curl -fsSL ${shellQuote(installShUrl)} | bash -s -- --upgrade`;
    const downloadSnippet = `curl -fsSL -o install-skills.sh ${shellQuote(installShUrl)}\nchmod +x ./install-skills.sh\n./install-skills.sh`;
    return { oneLiner, oneLinerUpgrade, downloadSnippet, installShUrl };
  })();

  // Uninstall snippets. Mirror `installerSnippets` exactly (same agent +
  // scope + layout query params) but flip `mode=uninstall`. Three flavors
  // exposed in the UI:
  //   - oneLiner       : interactive per-item prompts; preserves config.json
  //   - oneLinerPurge  : interactive + also removes ~/.config/caipe/config.json
  //                      (true clean wipe; user has to re-enter the gateway
  //                      URL + api_key after a future re-install)
  //   - oneLinerDryRun : preview mode -- prints what would be removed without
  //                      deleting anything. Implies --all so the output is
  //                      flat rather than waiting on N prompts.
  // We keep --all out of the default one-liner: per-item prompts are the
  // safety net the design questionnaire chose, and a destructive default
  // shouldn't be a `curl | bash` away.
  const uninstallSnippets = (() => {
    if (!selectedScope) return null;
    const uninstallShUrl = `${baseUrl}/api/skills/install.sh?scope=${encodeURIComponent(
      selectedScope,
    )}&mode=uninstall`;
    const oneLiner = `curl -fsSL ${shellQuote(uninstallShUrl)} | bash`;
    const oneLinerPurge = `curl -fsSL ${shellQuote(uninstallShUrl)} | bash -s -- --purge`;
    const oneLinerDryRun = `curl -fsSL ${shellQuote(uninstallShUrl)} | bash -s -- --dry-run`;
    return { oneLiner, oneLinerPurge, oneLinerDryRun, uninstallShUrl };
  })();

  // Bulk-install one-liner driven by the "Pick your skills" panel. Reuses
  // the same /api/skills/install.sh endpoint, but adds ?catalog_url=… so the
  // generated script writes one file per catalog skill instead of installing
  // the live-skills skill. Disabled when the agent is fragment-config (Continue)
  // or when no scope has been chosen yet.
  const bulkInstallerSnippet = (() => {
    if (!selectedScope) return null;
    const previewSkillCount =
      previewData?.skills && Array.isArray(previewData.skills)
        ? previewData.skills.length
        : 0;
    if (previewSkillCount === 0) return null;
    const installShUrl = `${baseUrl}/api/skills/install.sh?scope=${encodeURIComponent(
      selectedScope,
    )}&catalog_url=${encodeURIComponent(catalogUrl)}`;
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
          Start with the live catalog (Step 1), then mint a catalog API key (Step 2) for authenticated{" "}
          <code className="text-xs">curl</code> / installer access. Step 3 installs the single live-skills{" "}
          <code className="text-xs">/skills</code> command. Bulk install of every previewed skill is optional and
          listed after Step 2 as an advanced flow.
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
            Build a catalog URL and preview the live merged catalog (session-authenticated in the browser).
            For scripted <code className="text-xs">curl</code> access to the same URL, use the catalog API key from Step 2.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
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
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground flex items-center gap-1">
              <ChevronRight className="h-3 w-3 transition-transform [details[open]_&]:rotate-90" />
              Advanced filters
            </summary>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
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
          </details>

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
            Create an API key for scripts and installers to authenticate with the catalog.
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
            <strong>Copy it now.</strong> Cannot be shown again — lost keys cannot be recovered.
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

      {/* Advanced — bulk install uses the same preview as Step 1 + agent/scope from Step 3 */}
      {previewData?.skills && previewData.skills.length > 0 && (
        <Card className="border-dashed border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              Advanced: bulk-install previewed skills
            </CardTitle>
            <CardDescription>
              Optional. Writes one slash-command file per skill from your Step 1 preview using{" "}
              <code className="text-xs">install.sh?catalog_url=…</code>. Complete Step 2 first (API key in{" "}
              <code className="text-xs">~/.config/caipe/config.json</code>), then pick agent and install scope in Step 3
              before running the one-liner. The default path is a single live-skills skill in Step 3 — use bulk only when
              you want every previewed skill materialized on disk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-medium text-foreground">
                Install these {previewData.skills.length} skill
                {previewData.skills.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-muted-foreground">
                <span title="Works in Claude Code, Cursor, Codex CLI, Gemini CLI, and opencode">
                  universal install
                </span>
                {" · "}
                scope:{" "}
                <span className="font-mono">{selectedScope ?? "(set in Step 3)"}</span>
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
                      void navigator.clipboard.writeText(bulkInstallerSnippet.oneLiner);
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
                        void navigator.clipboard.writeText(bulkInstallerSnippet.oneLinerUpgrade);
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
                  Writes one{" "}
                  <code className="font-mono">SKILL.md</code> per skill into
                  both <code className="font-mono">~/.claude/skills/</code> and
                  the vendor-neutral{" "}
                  <code className="font-mono">~/.agents/skills/</code> mirror
                  (or the project-local equivalents). Existing files are
                  skipped unless you re-run with{" "}
                  <code className="font-mono">--upgrade</code> or{" "}
                  <code className="font-mono">--force</code>.
                </p>
              </>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Pick an install scope (user-global or project-local) in Step 3
                below to enable the bulk install command.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Terminal className="h-5 w-5" />
            Step 3: Install skills
          </CardTitle>
          <CardDescription>
            Install the <code>/skills</code> skill so your coding agent can
            browse and run skills from this gateway. Works with Claude Code,
            Cursor, Codex, Gemini CLI, and more.
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
              Install the live-skills skill
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
                  Quick install
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
                Advanced — customize the skill (name, description, preview)
              </summary>
              <div className="p-4 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Skill name
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
                  Installs as <code>{safeCommandName}.md</code> in your skills directory.
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
                  Shown in the skills picker.
                </p>
              </div>
            </div>

            {/* Coding-agent picker dropped: the install is universal.
                The same SKILL.md is written to the agent-specific tree
                (~/.claude/skills/) AND the vendor-neutral mirror
                (~/.agents/skills/), and Cursor / Codex CLI / Gemini
                CLI / opencode all auto-discover the latter. We
                surface the supported-agents list inline so users
                know which CLIs will pick up the install without
                having to read a docs link. */}
            <div className="pt-4 rounded-md bg-muted/20 px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-1.5">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                  a
                </span>
                Works in
              </p>
              <p className="text-xs text-foreground leading-relaxed">
                <strong>Claude Code</strong>, <strong>Cursor</strong>,{" "}
                <strong>Codex CLI</strong>, <strong>Gemini CLI</strong>, and{" "}
                <strong>opencode</strong> &mdash; the install writes a
                single <code className="font-mono text-[11px]">SKILL.md</code>{" "}
                per skill to the universal{" "}
                <code className="font-mono text-[11px]">~/.agents/skills/</code>{" "}
                location every supported agent discovers.
              </p>
            </div>

            {/* Scope chooser. After the skills-only overhaul every agent
                supports BOTH user and project scope, so we default-pick
                "user" and put "project" behind an Advanced disclosure
                with a `.gitignore` reminder for the per-project install
                artifacts. */}
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
                {(() => {
                  // User scope — the default. Render at the top, prominently.
                  // Multi-target paths are shown as a stacked list of <code>
                  // blocks since every install writes to BOTH the
                  // ~/.claude/skills/ tree AND the vendor-neutral
                  // ~/.agents/skills/ mirror.
                  const userPathsRaw = liveSkills?.install_paths?.user;
                  const userPaths: string[] = Array.isArray(userPathsRaw)
                    ? (userPathsRaw as string[])
                    : userPathsRaw
                      ? [userPathsRaw as unknown as string]
                      : [];
                  const userSelected = selectedScope === "user";
                  const userSupported = scopesAvailable.includes("user");
                  return (
                    <label
                      className={`flex items-start gap-3 text-xs rounded-md border px-3 py-2 transition-colors ${
                        userSupported
                          ? `cursor-pointer hover:bg-background/60 ${
                              userSelected
                                ? "border-primary/60 bg-background"
                                : "border-border/60 bg-background/30"
                            }`
                          : "cursor-not-allowed opacity-50 border-border/40"
                      }`}
                    >
                      <input
                        type="radio"
                        name="install-scope"
                        value="user"
                        checked={userSelected}
                        disabled={!userSupported}
                        onChange={() => userSupported && setSelectedScope("user")}
                        className="mt-0.5"
                      />
                      <span className="flex-1 leading-relaxed">
                        <span className="block font-medium text-foreground">
                          User-wide (reused across all projects)
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                            Recommended
                          </span>
                        </span>
                        {userPaths.length > 0 ? (
                          <span className="block mt-0.5 space-y-0.5">
                            {userPaths.map((p) => (
                              <code
                                key={p}
                                className="block text-[11px] text-muted-foreground font-mono"
                              >
                                {p.replace(
                                  new RegExp(`/${skillCommandName}/SKILL\\.md$`),
                                  "/<skill-name>/SKILL.md",
                                )}
                              </code>
                            ))}
                          </span>
                        ) : null}
                        {!userSupported ? (
                          <span className="block mt-0.5 text-[11px] text-muted-foreground italic">
                            Not supported by {agentLabel}.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })()}

                {/* Advanced: project-local install. Hidden by default;
                    expanding it shows the radio + a .gitignore reminder
                    so users who pick this know to keep `.caipe/`,
                    `.claude/`, and `.agents/` out of version control. */}
                <details className="rounded-md border border-border/40 bg-background/20 px-3 py-2 group">
                  <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground select-none">
                    <span className="inline-block transition-transform group-open:rotate-90 mr-1">›</span>
                    Advanced: install per-project instead
                  </summary>
                  <div className="mt-3">
                    {(() => {
                      const projectPathsRaw =
                        liveSkills?.install_paths?.project;
                      const projectPaths: string[] = Array.isArray(
                        projectPathsRaw,
                      )
                        ? (projectPathsRaw as string[])
                        : projectPathsRaw
                          ? [projectPathsRaw as unknown as string]
                          : [];
                      const projectSelected = selectedScope === "project";
                      const projectSupported =
                        scopesAvailable.includes("project");
                      return (
                        <label
                          className={`flex items-start gap-3 text-xs rounded-md border px-3 py-2 transition-colors ${
                            projectSupported
                              ? `cursor-pointer hover:bg-background/60 ${
                                  projectSelected
                                    ? "border-primary/60 bg-background"
                                    : "border-border/60 bg-background/30"
                                }`
                              : "cursor-not-allowed opacity-50 border-border/40"
                          }`}
                        >
                          <input
                            type="radio"
                            name="install-scope"
                            value="project"
                            checked={projectSelected}
                            disabled={!projectSupported}
                            onChange={() =>
                              projectSupported && setSelectedScope("project")
                            }
                            className="mt-0.5"
                          />
                          <span className="flex-1 leading-relaxed">
                            <span className="block font-medium text-foreground">
                              Project-local (committed with this repo)
                            </span>
                            {projectPaths.length > 0 ? (
                              <span className="block mt-0.5 space-y-0.5">
                                {projectPaths.map((p) => (
                                  <code
                                    key={p}
                                    className="block text-[11px] text-muted-foreground font-mono"
                                  >
                                    {p.replace(
                                      new RegExp(
                                        `/${skillCommandName}/SKILL\\.md$`,
                                      ),
                                      "/<skill-name>/SKILL.md",
                                    )}
                                  </code>
                                ))}
                              </span>
                            ) : null}
                            {!projectSupported ? (
                              <span className="block mt-0.5 text-[11px] text-muted-foreground italic">
                                Not supported by {agentLabel}.
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })()}
                    <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
                      Reminder: add these to your <code className="font-mono">.gitignore</code> so
                      manifests, helpers, and the agent dotfiles do not end up in
                      version control:
                    </p>
                    <pre className="mt-1 rounded bg-muted/40 p-2 text-[11px] font-mono leading-snug text-muted-foreground">
{`.caipe/
.claude/
.agents/`}
                    </pre>
                  </div>
                </details>
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
                    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold">
                        c
                      </span>
                      Install with one command
                      <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
                        Recommended
                      </span>
                    </p>

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
                      <div className="mt-3 pl-4 border-l-2 border-primary/20">
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

                    {uninstallSnippets ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground py-1">
                          Uninstall (reverse the install)
                        </summary>
                        <div className="mt-3 space-y-3 pl-4 border-l-2 border-destructive/30">
                          <p className="text-[11px] text-muted-foreground leading-relaxed">
                            Walks the sidecar manifest at{" "}
                            <code>~/.config/caipe/installed.json</code> (or{" "}
                            <code>./.caipe/installed.json</code> for project
                            scope) and prompts per item before removing each
                            CAIPE-installed file. Files NOT in the manifest are
                            never touched, so a hand-authored skill at a
                            CAIPE-looking path is always safe. When a Claude
                            <code>SessionStart</code> hook entry is removed,
                            the matching{" "}
                            <code>~/.claude/settings.json</code> patch is
                            reversed surgically — only the entries CAIPE added
                            are removed, everything else is preserved.
                          </p>

                          <div>
                            <p className="text-[11px] font-medium text-foreground mb-1">
                              Interactive uninstall (preserves your gateway
                              URL + api_key)
                            </p>
                            <div className="relative group">
                              <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                                {uninstallSnippets.oneLiner}
                              </pre>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    uninstallSnippets.oneLiner,
                                  );
                                  setCopiedUninstall(true);
                                  setTimeout(
                                    () => setCopiedUninstall(false),
                                    2000,
                                  );
                                }}
                              >
                                {copiedUninstall ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Per-item prompts: <code>y</code> = remove,{" "}
                              <code>N</code> = skip, <code>a</code> = remove
                              all remaining without prompting,{" "}
                              <code>q</code> = quit (manifest stays
                              consistent).
                            </p>
                          </div>

                          <div>
                            <p className="text-[11px] font-medium text-foreground mb-1">
                              Preview only (no files deleted)
                            </p>
                            <div className="relative group">
                              <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                                {uninstallSnippets.oneLinerDryRun}
                              </pre>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    uninstallSnippets.oneLinerDryRun,
                                  );
                                  setCopiedUninstallDryRun(true);
                                  setTimeout(
                                    () => setCopiedUninstallDryRun(false),
                                    2000,
                                  );
                                }}
                              >
                                {copiedUninstallDryRun ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>

                          <div>
                            <p className="text-[11px] font-medium text-foreground mb-1">
                              Full wipe (also removes{" "}
                              <code>~/.config/caipe/config.json</code>)
                            </p>
                            <div className="relative group">
                              <pre className="rounded-md bg-background p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap">
                                {uninstallSnippets.oneLinerPurge}
                              </pre>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  void navigator.clipboard.writeText(
                                    uninstallSnippets.oneLinerPurge,
                                  );
                                  setCopiedUninstallPurge(true);
                                  setTimeout(
                                    () => setCopiedUninstallPurge(false),
                                    2000,
                                  );
                                }}
                              >
                                {copiedUninstallPurge ? (
                                  <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">
                              You will need to re-enter the gateway URL +
                              catalog API key on the next install.
                            </p>
                          </div>
                        </div>
                      </details>
                    ) : null}

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
              <code>{liveSkillsTemplateSource ?? "loading…"}</code>
              {". Override via Helm value "}
              <code>skillsLiveSkills</code>
              {" (inline) or "}
              <code>skillsLiveSkillsName</code>
              {" (selects "}
              <code>data/skills/live-skills.&lt;name&gt;.md</code>
              {"), or container env "}
              <code>SKILLS_LIVE_SKILLS_FILE</code>
              {" / "}
              <code>SKILLS_LIVE_SKILLS_TEMPLATE</code>.
            </p>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Preview generated skill (md)
              </summary>
              <div className="relative group mt-2">
                <pre className="rounded-md bg-muted p-3 pr-10 text-xs overflow-x-auto whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {liveSkillsSkillContent}
                </pre>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    void navigator.clipboard.writeText(liveSkillsSkillContent);
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
              Launch your coding agent and use it
            </p>
            <div className="ml-8 space-y-3">
              <p className="text-sm text-foreground">
                The install wrote one{" "}
                <code className="font-mono text-[12px]">SKILL.md</code> per
                skill into both the Claude tree and the vendor-neutral{" "}
                <code className="font-mono text-[12px]">~/.agents/skills/</code>{" "}
                mirror. Open any of these CLIs in a fresh shell and the
                skills are immediately discoverable:
              </p>
              <ul className="text-sm text-foreground space-y-2 list-disc pl-5">
                <li>
                  <strong>Claude Code</strong> &mdash; run{" "}
                  <code className="font-mono text-[12px]">claude</code> then
                  type <code className="font-mono text-[12px]">/{safeCommandName}</code>
                  {" "}to browse the catalog. Skills are also auto-invoked
                  by description when you describe a matching task.
                </li>
                <li>
                  <strong>Cursor</strong> &mdash; open Cursor and type{" "}
                  <code className="font-mono text-[12px]">/</code> in the
                  Agent chat to search by name, or describe the task and
                  let the model pick the right skill.
                </li>
                <li>
                  <strong>Codex CLI</strong> &mdash; run{" "}
                  <code className="font-mono text-[12px]">codex</code> then
                  type <code className="font-mono text-[12px]">/skills</code>{" "}
                  to list, or use{" "}
                  <code className="font-mono text-[12px]">$skill-name</code>{" "}
                  to invoke explicitly.
                </li>
                <li>
                  <strong>Gemini CLI</strong> &mdash; run{" "}
                  <code className="font-mono text-[12px]">gemini</code> and
                  use <code className="font-mono text-[12px]">/skills list</code>{" "}
                  to confirm discovery; Gemini auto-activates skills by
                  description.
                </li>
                <li>
                  <strong>opencode</strong> &mdash; run{" "}
                  <code className="font-mono text-[12px]">opencode</code>;
                  the agent sees skills via the built-in{" "}
                  <code className="font-mono text-[12px]">skill</code> tool
                  and loads them on demand.
                </li>
              </ul>
              {launchGuide ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Detailed launch guide for {agentLabel}
                  </summary>
                  <div className="mt-3">
                    <LaunchGuide markdown={launchGuide} commandName={safeCommandName} />
                  </div>
                </details>
              ) : null}
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
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Quick install
            </DialogTitle>
            <DialogDescription>
              We&rsquo;ll generate a one-line installer that fetches skills
              from your catalog and writes a single SKILL.md per skill that
              works in <strong>Claude Code</strong>, <strong>Cursor</strong>,
              {" "}
              <strong>Codex CLI</strong>, <strong>Gemini CLI</strong>, and
              {" "}
              <strong>opencode</strong> &mdash; no per-agent setup
              required.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {/* Agent picker dropped: the install writes to BOTH the
                Claude tree (~/.claude/skills/) AND the vendor-neutral
                mirror (~/.agents/skills/) which Cursor, Codex, Gemini,
                and opencode all discover. The picker only used to
                affect the launch-guide footer + success-card label;
                see the new "compatibility" section after install for
                the unified launch instructions. */}

            {/* Scope picker. */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Where to install?
              </label>
              <div className="mt-1 flex flex-col gap-2">
                {(["user", "project"] as InstallScope[]).map((s) => {
                  const supported = scopesAvailable.includes(s);
                  const pathsRaw = liveSkills?.install_paths?.[s];
                  const paths: string[] = Array.isArray(pathsRaw)
                    ? (pathsRaw as string[])
                    : pathsRaw
                      ? [pathsRaw as unknown as string]
                      : [];
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
                        {paths.length > 0 ? (
                          <span className="block mt-0.5 space-y-0.5">
                            {paths.map((p) => (
                              <code
                                key={p}
                                className="block text-[11px] text-muted-foreground font-mono"
                              >
                                {p.replace(
                                  new RegExp(`/${skillCommandName}/SKILL\\.md$`),
                                  "/<skill-name>/SKILL.md",
                                )}
                              </code>
                            ))}
                          </span>
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
                if (!selectedScope) {
                  return (
                    <p className="text-xs text-muted-foreground inline-flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Pick an install scope above to generate the install
                      command.
                    </p>
                  );
                }
                // ?agent= omitted -- the install is universal across
                // Claude / Cursor / Codex / Gemini / opencode (writes
                // to both ~/.claude/skills/ and ~/.agents/skills/).
                // The install URL is composed from (in order):
                //   * scope (user/project) — drives ~/.claude vs ./.claude
                //   * catalog_url= — the user-chosen catalog page from
                //                    the "Pick your skills" preview
                //   * mode=bulk-with-helpers — only when the helpers
                //                    checkbox is on. Without this the
                //                    server routes catalog_url= to
                //                    catalog-query mode which has
                //                    DO_HELPERS=0 (= no /skills,
                //                    /update-skills SKILL.md files).
                const installShUrl =
                  `${baseUrl}/api/skills/install.sh` +
                  `?scope=${encodeURIComponent(selectedScope)}` +
                  `&catalog_url=${encodeURIComponent(catalogUrl)}` +
                  (quickInstallHelpers ? `&mode=bulk-with-helpers` : "");
                const targetPath =
                  liveSkills?.install_paths?.[selectedScope] ?? null;
                const skillCount = previewData?.meta?.total ?? null;
                // Single-line install snippet. install.sh reads the API key
                // from ~/.config/caipe/config.json (Step 1), so we don't
                // bake the key into the curl. This keeps the snippet short,
                // copy-pasteable, and makes the "API key cannot be
                // recovered" message in the key card actually true — we
                // never echo the key into examples after minting it.
                //
                // The optional `--upgrade` / `--force` flag is appended via
                // `bash -s --` (the standard way of forwarding args to a
                // piped script). With no flag, install.sh's safe-default
                // refuses to overwrite existing files; `--upgrade` only
                // overwrites files we previously wrote (manifest-tracked);
                // `--force` clobbers anything in the target paths.
                const installFlag =
                  quickInstallMode === "upgrade"
                    ? "--upgrade"
                    : quickInstallMode === "force"
                      ? "--force"
                      : "";
                const oneLiner = installFlag
                  ? `curl -fsSL ${shellQuote(installShUrl)} | bash -s -- ${installFlag}`
                  : `curl -fsSL ${shellQuote(installShUrl)} | bash`;
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
                          ⚠ Copy it now — we cannot show it again. Two
                          options:
                        </div>

                        {/* Option A: bare key, for users who want to
                            hand-edit ~/.config/caipe/config.json
                            (matches the previous UX). */}
                        <div className="space-y-1">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                            Option A — paste into{" "}
                            <code className="font-mono">
                              ~/.config/caipe/config.json
                            </code>{" "}
                            yourself
                          </p>
                          <CopyableBlock
                            as="code"
                            text={mintedKey}
                            ariaLabel="Copy API key"
                          />
                        </div>

                        {/* Option B (Option-4 from the install-flow
                            design): single-shot bootstrap. Writes
                            ~/.config/caipe/config.json with chmod 600
                            then runs the same install one-liner the
                            "Run this in your terminal" block shows
                            below. The key is embedded INSIDE a
                            single-quoted heredoc so bash doesn't try
                            to expand $... or backticks; both values
                            are JSON.stringify'd so any character is
                            safe inside the JSON string literal.
                            chmod 600 lands the key on disk readable
                            only by the owner. The bare curl is
                            unchanged below for repeat-installs that
                            don't need to re-seed config.json. */}
                        {(() => {
                          const bootstrapSnippet = [
                            `mkdir -p ~/.config/caipe && \\`,
                            `cat > ~/.config/caipe/config.json <<'CAIPE_BOOTSTRAP_EOF'`,
                            `{`,
                            `  "base_url": ${JSON.stringify(baseUrl)},`,
                            `  "api_key": ${JSON.stringify(mintedKey)}`,
                            `}`,
                            `CAIPE_BOOTSTRAP_EOF`,
                            `chmod 600 ~/.config/caipe/config.json && \\`,
                            oneLiner,
                          ].join("\n");
                          return (
                            <div
                              className="space-y-1"
                              data-testid="quick-install-bootstrap-snippet"
                            >
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                                Option B — write config + install in
                                one shot{" "}
                                <span className="normal-case font-normal text-muted-foreground">
                                  (recommended for first-time setup)
                                </span>
                              </p>
                              <CopyableBlock
                                as="pre"
                                text={bootstrapSnippet}
                                ariaLabel="Copy bootstrap install snippet"
                                className="break-all"
                              />
                              <p className="text-[10px] text-muted-foreground leading-snug">
                                Writes{" "}
                                <code className="font-mono">
                                  ~/.config/caipe/config.json
                                </code>{" "}
                                with{" "}
                                <code className="font-mono">chmod 600</code>{" "}
                                (owner-readable only), then runs the
                                install. The key lives in the single-
                                quoted heredoc so bash doesn&rsquo;t
                                expand it; the only place it lands on
                                disk is the config file you just
                                created.
                              </p>
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400 flex-1 min-w-[200px]">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            <span className="font-medium">
                              No API key.
                            </span>{" "}
                            Generate one in Step 1 first.
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

                    {/* Install options. Single checkbox controlling
                        whether the rendered one-liner asks install.sh
                        to also drop the /skills and /update-skills
                        helper SKILL.md files (the meta-helpers that
                        let the user search and refresh the catalog
                        from inside Claude Code, Cursor, etc.).

                        Default ON because the previous default URL
                        silently skipped these helpers — ?catalog_url=
                        forced mode=catalog-query on the server, which
                        has DO_HELPERS=0. Users had no UI affordance
                        to discover the gap. */}
                    <div
                      className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5"
                      data-testid="quick-install-helpers-toggle"
                    >
                      <p className="text-[11px] font-medium text-foreground">
                        Install options
                      </p>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={quickInstallHelpers}
                          onChange={(e) =>
                            setQuickInstallHelpers(e.target.checked)
                          }
                          className="rounded border-border mt-0.5"
                          data-testid="quick-install-helpers"
                        />
                        <span className="text-xs">
                          <span className="font-medium">
                            Install <code className="font-mono">/skills</code>{" "}
                            and{" "}
                            <code className="font-mono">/update-skills</code>{" "}
                            helpers
                          </span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5">
                            Adds two slash commands to your skill tree:{" "}
                            <code className="font-mono">/skills</code>{" "}
                            (search and run any catalog skill) and{" "}
                            <code className="font-mono">/update-skills</code>{" "}
                            (refresh on-disk skills from the live
                            catalog). Recommended — leave on unless
                            you only want the bulk skill files.
                          </span>
                        </span>
                      </label>
                    </div>

                    {/* Install-mode toggles. Modeled as two checkboxes
                        (matching the include_content pattern in the Live
                        URL builder above) but mutually exclusive — picking
                        one unchecks the other. install.sh treats
                        --upgrade and --force as a precedence chain (force
                        wins), so two independent toggles would let the UI
                        ask for "upgrade AND force" while the script
                        silently ignored upgrade. The radio-in-checkbox-
                        clothing keeps the visual affordance the user
                        asked for without the footgun. */}
                    <div
                      className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5"
                      data-testid="quick-install-mode-toggles"
                    >
                      <p className="text-[11px] font-medium text-foreground">
                        Overwrite policy
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={quickInstallMode === "upgrade"}
                            onChange={(e) =>
                              setQuickInstallMode(
                                e.target.checked ? "upgrade" : "default",
                              )
                            }
                            className="rounded border-border"
                            data-testid="quick-install-upgrade"
                          />
                          <span className="font-mono text-[11px]">
                            --upgrade
                          </span>
                          <span className="text-muted-foreground text-[11px]">
                            (refresh files this installer wrote before)
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={quickInstallMode === "force"}
                            onChange={(e) =>
                              setQuickInstallMode(
                                e.target.checked ? "force" : "default",
                              )
                            }
                            className="rounded border-border"
                            data-testid="quick-install-force"
                          />
                          <span className="font-mono text-[11px]">
                            --force
                          </span>
                          <span className="text-muted-foreground text-[11px]">
                            (clobber any existing files at the target
                            paths)
                          </span>
                        </label>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Mutually exclusive — picking one clears the
                        other. Leave both off for the safe default
                        (existing files untouched).
                      </p>
                    </div>

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
                          data-testid="quick-install-copy-bare-curl"
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
                        {quickInstallMode === "force" ? (
                          <>
                            <code className="font-mono">--force</code>{" "}
                            mode: every target file at the install paths
                            will be overwritten, including files this
                            installer didn&rsquo;t create.
                          </>
                        ) : quickInstallMode === "upgrade" ? (
                          <>
                            <code className="font-mono">--upgrade</code>{" "}
                            mode: only files this installer previously
                            wrote (tracked in the manifest) will be
                            refreshed. Other files are left alone.
                          </>
                        ) : (
                          <>
                            Idempotent and safe to re-run. Existing skill
                            files are skipped — toggle{" "}
                            <code className="font-mono">--upgrade</code>{" "}
                            or{" "}
                            <code className="font-mono">--force</code>{" "}
                            above to overwrite.
                          </>
                        )}
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
 * /api/skills/live-skills. Supports the subset our agent registry uses:
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
        Launch instructions will appear here once the live-skills template loads.
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

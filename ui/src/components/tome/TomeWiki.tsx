"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Eye,
  EyeOff,
  HelpCircle,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
  Settings,
  Target,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChatPanel } from "@/components/tome/ChatPanel";
import { TalkPanel } from "@/components/tome/TalkPanel";
import { ProjectSettingsPanel } from "@/components/tome/ProjectSettingsPanel";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import { IngestPanel } from "@/components/tome/IngestPanel";
import { IngestRunView } from "@/components/tome/IngestRunView";
import { PageHistoryView } from "@/components/tome/PageHistoryView";
import { Breadcrumb, type Crumb } from "@/components/tome/Breadcrumb";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "@/types/tome";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
}

/** Browser-local flag so the first-run walkthrough only auto-opens once. */
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

type MainView =
  | { kind: "agent" }
  | { kind: "talk" }
  | { kind: "settings" }
  | { kind: "page"; path: string }
  | { kind: "pageHistory"; path: string }
  | { kind: "ingest" }
  | { kind: "ingestRun"; runId: string };

/**
 * Map the active view to its URL segments under `/projects/<slug>/tome`. The
 * view lives in the route (not React state) so every surface is deep-linkable
 * and browser back/forward work. Wiki page paths (which contain `/` and `.md`)
 * are namespaced under `wiki/` / `history/` so they can't collide with the
 * reserved `talk` / `ingest` segments.
 */
function viewToPath(slug: string, view: MainView): string {
  const base = `/projects/${slug}/tome`;
  switch (view.kind) {
    case "agent":
      return base;
    case "talk":
      return `${base}/talk`;
    case "settings":
      return `${base}/settings`;
    case "ingest":
      return `${base}/ingest`;
    case "ingestRun":
      return `${base}/ingest/${encodeURIComponent(view.runId)}`;
    case "page":
      return `${base}/wiki/${view.path}`;
    case "pageHistory":
      return `${base}/history/${view.path}`;
  }
}

/** Parse the catch-all segments back into a view. Unknown shapes fall to agent. */
function pathToView(segments: string[]): MainView {
  const [head, ...rest] = segments;
  switch (head) {
    case undefined:
      return { kind: "agent" };
    case "talk":
      return { kind: "talk" };
    case "settings":
      return { kind: "settings" };
    case "ingest":
      return rest[0]
        ? { kind: "ingestRun", runId: rest[0] }
        : { kind: "ingest" };
    case "wiki":
      return rest.length
        ? { kind: "page", path: rest.join("/") }
        : { kind: "agent" };
    case "history":
      return rest.length
        ? { kind: "pageHistory", path: rest.join("/") }
        : { kind: "agent" };
    default:
      return { kind: "agent" };
  }
}

function pageTitleOf(path: string, markdown: string): string {
  const [fm] = parseFrontmatter(markdown);
  return typeof fm.title === "string"
    ? fm.title
    : (SPEC_BY_PATH.get(path)?.title ?? path);
}

export function TomeWiki({ slug }: { slug: string }) {
  // The active view lives in the URL (deep-linkable, back/forward works), but we
  // navigate with `history.pushState` rather than `router.push` so this client
  // component never remounts — only the derived `view` changes, swapping the
  // main pane while the sidebar, breadcrumb, and loaded page tree persist. Next
  // syncs pushState into `usePathname`, so direct loads and popstate still work.
  const pathname = usePathname();
  const base = `/projects/${slug}/tome`;
  const segments = useMemo(() => {
    if (!pathname) return [];
    const rest = pathname.startsWith(base) ? pathname.slice(base.length) : "";
    return rest.split("/").map(decodeURIComponent).filter(Boolean);
  }, [pathname, base]);
  // The active view is derived from the URL — Agent is the landing view.
  const view = useMemo(() => pathToView(segments), [segments]);
  const navigate = useCallback(
    (next: MainView) => {
      const url = viewToPath(slug, next);
      if (url !== pathname) window.history.pushState(null, "", url);
    },
    [slug, pathname],
  );

  const [data, setData] = useState<PagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // First-run onboarding: project title (for the modal copy) + open state.
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  // BHAG awareness: this project's kind, the initiatives it's tagged with, and
  // the BHAG entities those initiatives resolve to (for the up-link chip).
  const [projectType, setProjectType] = useState<"project" | "bhag">("project");
  const [initiatives, setInitiatives] = useState<string[]>([]);
  const [parentBhags, setParentBhags] = useState<{ slug: string; name: string }[]>([]);
  const isBhag = projectType === "bhag";
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  // "New page" popover + hidden file picker for the Wiki rail action cluster.
  const [newPageOpen, setNewPageOpen] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const newPageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const json = await res.json();
      setData(json?.data as PagesResponse);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  // Locked = an ingest is in flight. Derived from the same ingest-run signal
  // the ingest panel polls (no extra project fetch). Drives the editor's
  // read-only banner. On the running→idle transition, reload pages so the
  // agent's fresh rewrite shows without a manual refresh.
  const [locked, setLocked] = useState(false);
  const prevLockedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/tome/projects/${slug}/ingests`);
        if (!res.ok) return;
        const json = await res.json();
        const runs = (json?.data?.runs ?? []) as Array<{ status?: string }>;
        const active = runs.some(
          (r) => r.status === "running" || r.status === "queued",
        );
        if (cancelled) return;
        if (prevLockedRef.current && !active) void load();
        prevLockedRef.current = active;
        setLocked(active);
      } catch {
        /* best-effort — leave the last known state */
      }
    };
    void check();
    const t = setInterval(check, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [slug, load]);

  // Project title (onboarding modal copy) + BHAG awareness (kind + the
  // initiatives this project is tagged with).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const p = body?.data?.project;
        if (!p) return;
        if (typeof p.title === "string" && p.title) setProjectTitle(p.title);
        setProjectType(p.type === "bhag" ? "bhag" : "project");
        setInitiatives(Array.isArray(p.labels?.initiatives) ? p.labels.initiatives : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Resolve this project's initiative tags to BHAG entities so a regular
  // project can surface a clickable up-link to its strategic goal(s). Skipped
  // for BHAGs themselves and for untagged projects.
  useEffect(() => {
    if (isBhag || initiatives.length === 0) {
      setParentBhags([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=bhag`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const all = (body?.data?.projects ?? []) as { slug: string; name: string }[];
        const want = new Set(initiatives.map((i) => normLabel(i)));
        setParentBhags(all.filter((b) => want.has(normLabel(b.name))));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, isBhag, initiatives]);

  // Show the first-run walkthrough once per browser. The Help button reopens it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(ONBOARDING_SEEN_KEY)) {
      setOnboardingOpen(true);
    }
  }, []);

  const handleOnboardingChange = useCallback((open: boolean) => {
    setOnboardingOpen(open);
    if (!open && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
    }
  }, []);

  const openPage = useCallback(
    (path: string) => navigate({ kind: "page", path }),
    [navigate],
  );
  const openArtifact = useCallback((path: string) => setArtifactPath(path), []);

  const loading = data === null && !error;
  const isEmpty = data !== null && Object.keys(data.pages).length === 0;

  const writeMarkdown = useCallback(
    async (path: string, markdown: string, message: string) => {
      const res = await fetch(`/api/tome/projects/${slug}/pages/${path}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, message }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setData((prev) =>
        prev ? { ...prev, pages: { ...prev.pages, [path]: markdown } } : prev,
      );
    },
    [slug],
  );

  // Create a page from a (possibly nested) path. Adds .md if no extension,
  // seeds an H1 from the leaf name, then opens it. Backed by PUT /pages.
  const createPage = useCallback(
    async (rawPath: string) => {
      let path = rawPath.trim().replace(/^\/+/, "");
      if (!path) return;
      if (!/\.(md|mdx)$/i.test(path)) path += ".md";
      if (data?.pages[path] !== undefined) {
        openPage(path);
        return;
      }
      const leaf = path.replace(/\.(md|mdx)$/i, "").split("/").pop() ?? path;
      try {
        await writeMarkdown(path, `# ${leaf}\n`, `create ${path}`);
        await load();
        openPage(path);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [data, writeMarkdown, load, openPage],
  );

  const deletePage = useCallback(
    async (path: string) => {
      if (typeof window !== "undefined" && !window.confirm(`Remove ${path}?`))
        return;
      try {
        const res = await fetch(`/api/tome/projects/${slug}/pages/${path}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
        // Leave any view that was showing the now-deleted page.
        if (
          (view.kind === "page" || view.kind === "pageHistory") &&
          view.path === path
        ) {
          navigate({ kind: "agent" });
        }
        setArtifactPath((p) => (p === path ? null : p));
        await load();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [slug, load, view, navigate],
  );

  // Import .md/.mdx files as wiki pages (each file's text → PUT /pages).
  // Nested layout is preserved via webkitRelativePath when a folder is dropped.
  const uploadPages = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => /\.(md|mdx)$/i.test(f.name));
      if (list.length === 0) return;
      try {
        for (const f of list) {
          const rel =
            (f as File & { webkitRelativePath?: string }).webkitRelativePath ||
            f.name;
          const path = rel.replace(/^\/+/, "");
          const text = await f.text();
          await writeMarkdown(path, text, `upload ${path}`);
        }
        await load();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [writeMarkdown, load],
  );

  const crumbs = useMemo<Crumb[]>(() => {
    switch (view.kind) {
      case "agent":
        return [{ label: "Agent" }];
      case "talk":
        return [{ label: "Talk" }];
      case "settings":
        return [{ label: "Settings" }];
      case "page": {
        const pages = data?.pages ?? {};
        const md = pages[view.path] ?? "";
        const segments = view.path.split("/");
        const folders = segments.slice(0, -1); // ancestor folders, leaf excluded
        const crumbs: Crumb[] = [];
        let prefix = "";
        for (const seg of folders) {
          prefix = prefix ? `${prefix}/${seg}` : seg;
          // Clickable to the folder's landing page if one exists (nest-parent
          // `<folder>.md`, or a conventional index/overview under it).
          const indexPath = [`${prefix}.md`, `${prefix}/index.md`, `${prefix}/overview.md`].find(
            (p) => pages[p] !== undefined,
          );
          crumbs.push(
            indexPath
              ? { label: seg, onClick: () => navigate({ kind: "page", path: indexPath }) }
              : { label: seg },
          );
        }
        crumbs.push({ label: pageTitleOf(view.path, md) });
        return crumbs;
      }
      case "pageHistory": {
        const md = data?.pages[view.path] ?? "";
        const path = view.path;
        return [
          {
            label: pageTitleOf(path, md),
            onClick: () => navigate({ kind: "page", path }),
          },
          { label: "History" },
        ];
      }
      case "ingest":
        return [{ label: "Ingest" }];
      case "ingestRun":
        return [
          {
            label: "Ingest",
            onClick: () => navigate({ kind: "ingest" }),
          },
          { label: "Run" },
        ];
    }
  }, [view, data, navigate]);

  // Initiative tag (normalized) → its BHAG wiki entity, when one exists.
  const bhagByInitiative = useMemo(
    () => new Map(parentBhags.map((b) => [normLabel(b.name), b])),
    [parentBhags],
  );

  const navActive = {
    agent: view.kind === "agent",
    talk: view.kind === "talk",
    settings: view.kind === "settings",
    ingest: view.kind === "ingest" || view.kind === "ingestRun",
    page:
      view.kind === "page" || view.kind === "pageHistory" ? view.path : null,
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center gap-1 border-b px-4 py-3 text-sm">
          {/* Back to the projects list. The project's own detail/apps page is
              skipped (it redirects into Tome); reach it via `?apps=1` if needed. */}
          <Link href="/projects">
            <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1">
              <ArrowLeft className="h-4 w-4" />
              Projects
            </Button>
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Breadcrumb
            items={[
              { label: projectTitle ?? slug, onClick: () => navigate({ kind: "agent" }) },
              ...crumbs,
            ]}
          />
          {isBhag && (
            <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-700/50 bg-violet-950/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
              <Target className="h-3 w-3" />
              BHAG
            </span>
          )}
          {/* Up-links: a project can be tagged to many BHAGs (initiatives are
              multi-value tags). Render a chip per tag; the ones promoted to a
              BHAG wiki link to it, the rest show membership without a link. */}
          {!isBhag &&
            initiatives.map((init) => {
              const b = bhagByInitiative.get(normLabel(init));
              return b ? (
                <Tooltip key={init}>
                  <TooltipTrigger asChild>
                    <Link
                      href={`/projects/${b.slug}/tome`}
                      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-700/50 bg-violet-950/30 px-2 py-0.5 text-[11px] font-medium text-violet-300 transition hover:border-violet-500 hover:bg-violet-900/50"
                    >
                      <Target className="h-3 w-3" />
                      {b.name}
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open the BHAG wiki: {b.name}</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip key={init}>
                  <TooltipTrigger asChild>
                    <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-800/30 px-2 py-0.5 text-[11px] font-medium text-violet-300/60">
                      <Target className="h-3 w-3" />
                      {init}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="w-56 whitespace-normal">
                    Tagged to the BHAG &ldquo;{init}&rdquo;. No wiki yet. Create one from the Projects hub.
                  </TooltipContent>
                </Tooltip>
              );
            })}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <McpConnectDialog />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                  onClick={() => setOnboardingOpen(true)}
                  aria-label="What is TOME?"
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">What is TOME?</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {error && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Side nav: Chat + Ingest destinations, then the wiki page tree. */}
          <aside className="w-64 shrink-0 border-r">
            <ScrollArea className="h-full">
              <div className="flex flex-col p-3">
                <div className="flex flex-col gap-0.5">
                  <NavItem
                    icon={<MessageSquare className="h-4 w-4" />}
                    label="Agent"
                    active={navActive.agent}
                    onClick={() => navigate({ kind: "agent" })}
                    tipTitle="Agent"
                    tipDescription="Chat with the project's agent: ask it questions about the project, or have it draft, refine, and reorganize the wiki pages it reads and writes."
                  />
                  <NavItem
                    icon={<RefreshCw className="h-4 w-4" />}
                    label={isBhag ? "Synthesize" : "Ingest"}
                    active={navActive.ingest}
                    onClick={() => navigate({ kind: "ingest" })}
                    tipTitle={isBhag ? "Synthesize" : "Ingest"}
                    tipDescription={
                      isBhag
                        ? "Synthesize this BHAG: the agent reads the wikis of the projects tagged to it and writes the strategic view. A BHAG has no sources of its own."
                        : "Start an ingest run that (re)builds the wiki from the project's attached sources: GitHub repos, Confluence spaces, and Webex rooms."
                    }
                  />
                  <NavItem
                    icon={<MessagesSquare className="h-4 w-4" />}
                    label="Talk"
                    active={navActive.talk}
                    onClick={() => navigate({ kind: "talk" })}
                    tipTitle="Talk"
                    tipDescription="The project's talk page: discussion about the context, powered by Mycelium. People and agents post here; the wiki holds the context, this holds the conversation."
                  />
                  <NavItem
                    icon={<Settings className="h-4 w-4" />}
                    label="Settings"
                    active={navActive.settings}
                    onClick={() => navigate({ kind: "settings" })}
                    tipTitle="Settings"
                    tipDescription="Reconfigure this project: its title, description, and sources (GitHub repos, Confluence spaces, Webex rooms). Changes apply to future ingests."
                  />
                </div>

                <div className="mt-4 flex items-center justify-between gap-1 px-2 pb-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Wiki
                  </span>
                  <div className="flex items-center gap-0.5 text-muted-foreground">
                    {!isEmpty && !loading && (
                      <button
                        type="button"
                        onClick={() => setShowHidden((v) => !v)}
                        title={showHidden ? "Hide agent-only pages" : "Show agent-only pages"}
                        className="rounded p-1 hover:bg-muted hover:text-foreground"
                      >
                        {showHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    {!loading && (
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        title="Upload .md files as pages (or drag onto the editor)"
                        aria-label="Upload pages"
                        className="rounded p-1 hover:bg-muted hover:text-foreground"
                      >
                        <Upload className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!loading && (
                      <Popover
                        open={newPageOpen}
                        onOpenChange={(o) => {
                          setNewPageOpen(o);
                          if (o) {
                            setTimeout(() => newPageInputRef.current?.focus(), 0);
                          } else {
                            setNewPageName("");
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            title="New page"
                            aria-label="New page"
                            className="rounded p-1 hover:bg-muted hover:text-foreground"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" side="bottom" className="w-72 p-3">
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const name = newPageName.trim();
                              if (!name) return;
                              void createPage(name);
                              setNewPageOpen(false);
                              setNewPageName("");
                            }}
                            className="space-y-2"
                          >
                            <label
                              htmlFor="tome-new-page-input"
                              className="text-[11px] font-semibold text-foreground"
                            >
                              New page path
                            </label>
                            <Input
                              id="tome-new-page-input"
                              ref={newPageInputRef}
                              value={newPageName}
                              onChange={(e) => setNewPageName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  setNewPageOpen(false);
                                  setNewPageName("");
                                }
                              }}
                              placeholder="objectives/q3.md"
                              className="h-8 font-mono text-xs"
                              aria-label="New page path"
                            />
                            <p className="text-[10px] leading-snug text-muted-foreground">
                              Use <span className="font-mono">/</span> to nest into folders, e.g.{" "}
                              <span className="font-mono">objectives/q3.md</span>.
                            </p>
                            <div className="flex items-center justify-between gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setNewPageOpen(false);
                                  setNewPageName("");
                                  uploadInputRef.current?.click();
                                }}
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                <Upload className="h-3.5 w-3.5" />
                                Upload instead
                              </button>
                              <Button type="submit" size="sm" className="h-7 px-2.5 text-[11px]" disabled={!newPageName.trim()}>
                                Create
                              </Button>
                            </div>
                          </form>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>

                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".md,.mdx,text/markdown"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) void uploadPages(files);
                    e.target.value = "";
                  }}
                />

                {loading ? (
                  <SidebarSkeleton />
                ) : isEmpty ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    <p className="mb-2">No wiki pages yet.</p>
                    <Button size="sm" onClick={() => navigate({ kind: "ingest" })}>
                      Run an ingest
                    </Button>
                  </div>
                ) : (
                  data && (
                    <WikiSidebar
                      tree={data.tree}
                      selectedPath={navActive.page}
                      onSelect={openPage}
                      showHidden={showHidden}
                      onDelete={deletePage}
                    />
                  )
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Main pane: replaced wholesale by the active view. */}
          <main className="flex flex-1 overflow-hidden">
            {view.kind === "agent" ? (
              <>
                <div className="min-w-0 flex-1">
                  <ChatPanel slug={slug} onPagesChanged={load} onOpenPage={openArtifact} />
                </div>
                {artifactPath && (
                  <div className="w-[45%] min-w-[360px] shrink-0 border-l">
                    {data && data.pages[artifactPath] !== undefined ? (
                      <WikiPageView
                        slug={slug}
                        path={artifactPath}
                        markdown={data.pages[artifactPath]}
                        onWrite={writeMarkdown}
                        onReload={load}
                        onClose={() => setArtifactPath(null)}
                        locked={locked}
                        onNavigate={openArtifact}
                      />
                    ) : (
                      <ContentLoading />
                    )}
                  </div>
                )}
              </>
            ) : view.kind === "talk" ? (
              <div className="min-w-0 flex-1">
                <TalkPanel slug={slug} onOpenPage={(path) => navigate({ kind: "page", path })} />
              </div>
            ) : view.kind === "settings" ? (
              <div className="min-w-0 flex-1">
                <ProjectSettingsPanel slug={slug} />
              </div>
            ) : view.kind === "ingest" ? (
              <div className="min-w-0 flex-1">
                <IngestPanel
                  slug={slug}
                  canEdit
                  isBhag={isBhag}
                  onOpenRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onRunStarted={(runId) => navigate({ kind: "ingestRun", runId })}
                />
              </div>
            ) : view.kind === "ingestRun" ? (
              <div className="min-w-0 flex-1">
                <IngestRunView slug={slug} runId={view.runId} onPagesChanged={load} />
              </div>
            ) : view.kind === "pageHistory" ? (
              <div className="min-w-0 flex-1">
                <PageHistoryView slug={slug} path={view.path} />
              </div>
            ) : (
              // page
              <div className="min-w-0 flex-1">
                {loading ? (
                  <ContentLoading />
                ) : data && data.pages[view.path] !== undefined ? (
                  <WikiPageView
                    slug={slug}
                    path={view.path}
                    markdown={data.pages[view.path]}
                    onWrite={writeMarkdown}
                    onReload={load}
                    onOpenHistory={() =>
                      navigate({ kind: "pageHistory", path: view.path })
                    }
                    locked={locked}
                    onNavigate={(path) => navigate({ kind: "page", path })}
                  />
                ) : (
                  <p className="p-8 text-sm text-muted-foreground">Page not found.</p>
                )}
              </div>
            )}
          </main>
        </div>
      </div>

      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={handleOnboardingChange}
        projectName={projectTitle ?? undefined}
      />
    </TooltipProvider>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
  tipTitle,
  tipDescription,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  tipTitle?: string;
  tipDescription?: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-muted",
        active && "bg-muted text-primary",
      )}
    >
      {icon}
      {label}
    </button>
  );

  if (!tipTitle) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        className="flex w-64 flex-col gap-1 whitespace-normal text-[11px] font-normal normal-case leading-relaxed"
      >
        <span className="text-xs font-semibold">{tipTitle}</span>
        <span className="opacity-70">{tipDescription}</span>
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarSkeleton() {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-1/2", "w-3/5", "w-2/5"];
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden>
      {widths.map((w, i) => (
        <div key={i} className={cn("h-4 animate-pulse rounded bg-muted", w)} />
      ))}
    </div>
  );
}

function ContentLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-8 py-10" aria-hidden>
      <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

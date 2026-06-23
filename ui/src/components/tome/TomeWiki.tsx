"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
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
import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import { IngestPanel } from "@/components/tome/IngestPanel";
import { IngestRunView } from "@/components/tome/IngestRunView";
import { PageHistoryView } from "@/components/tome/PageHistoryView";
import { Breadcrumb, type Crumb } from "@/components/tome/Breadcrumb";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "@/types/tome";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
}

type MainView =
  | { kind: "agent" }
  | { kind: "talk" }
  | { kind: "page"; path: string }
  | { kind: "pageHistory"; path: string }
  | { kind: "ingest" }
  | { kind: "ingestRun"; runId: string };

function pageTitleOf(path: string, markdown: string): string {
  const [fm] = parseFrontmatter(markdown);
  return typeof fm.title === "string"
    ? fm.title
    : (SPEC_BY_PATH.get(path)?.title ?? path);
}

export function TomeWiki({ slug }: { slug: string }) {
  const [data, setData] = useState<PagesResponse | null>(null);
  // The project's display name for the breadcrumb (falls back to the slug).
  const [title, setTitle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Chat is the landing view; wiki + ingest live below it in the nav.
  const [view, setView] = useState<MainView>({ kind: "agent" });
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [seeding, setSeeding] = useState(false);
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

  // Project display name for the breadcrumb root.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${slug}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const t = body?.data?.project?.title;
        if (typeof t === "string" && t) setTitle(t);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const openPage = useCallback((path: string) => {
    setView({ kind: "page", path });
  }, []);
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
        setView((v) =>
          v.kind === "page" && v.path === path ? { kind: "agent" } : v,
        );
        setArtifactPath((p) => (p === path ? null : p));
        await load();
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    },
    [slug, load],
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

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`, { method: "POST" });
      if (!res.ok) throw new Error(`seed failed (${res.status})`);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSeeding(false);
    }
  }, [slug, load]);

  const crumbs = useMemo<Crumb[]>(() => {
    switch (view.kind) {
      case "agent":
        return [{ label: "Agent" }];
      case "talk":
        return [{ label: "Talk" }];
      case "page": {
        const md = data?.pages[view.path] ?? "";
        return [{ label: pageTitleOf(view.path, md) }];
      }
      case "pageHistory": {
        const md = data?.pages[view.path] ?? "";
        const path = view.path;
        return [
          {
            label: pageTitleOf(path, md),
            onClick: () => setView({ kind: "page", path }),
          },
          { label: "History" },
        ];
      }
      case "ingest":
        return [{ label: "Schedule new ingest" }];
      case "ingestRun":
        return [
          { label: "Schedule new ingest", onClick: () => setView({ kind: "ingest" }) },
          { label: "Run" },
        ];
    }
  }, [view, data]);

  const navActive = {
    agent: view.kind === "agent",
    talk: view.kind === "talk",
    ingest: view.kind === "ingest" || view.kind === "ingestRun",
    page:
      view.kind === "page" || view.kind === "pageHistory" ? view.path : null,
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center gap-1 border-b px-4 py-3 text-sm">
          <Link href={`/projects/${slug}`}>
            <Button variant="ghost" size="sm" className="h-auto gap-1.5 px-2 py-1">
              <ArrowLeft className="h-4 w-4" />
              {title ?? slug}
            </Button>
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Breadcrumb
            items={[
              { label: "tome", onClick: () => setView({ kind: "agent" }) },
              ...crumbs,
            ]}
          />
          <div className="ml-auto shrink-0">
            <McpConnectDialog />
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
                    onClick={() => setView({ kind: "agent" })}
                    tipTitle="Agent"
                    tipDescription="Chat with the editing agent that reads and writes this project's wiki pages — ask it to draft, refine, or reorganize content."
                  />
                  <NavItem
                    icon={<RefreshCw className="h-4 w-4" />}
                    label="Schedule new ingest"
                    active={navActive.ingest}
                    onClick={() => setView({ kind: "ingest" })}
                    tipTitle="Schedule new ingest"
                    tipDescription="Start an ingest run that (re)builds the wiki from the project's attached sources — GitHub repos, Confluence spaces, and Webex rooms."
                  />
                  <NavItem
                    icon={<MessagesSquare className="h-4 w-4" />}
                    label="Talk"
                    active={navActive.talk}
                    onClick={() => setView({ kind: "talk" })}
                    tipTitle="Talk"
                    tipDescription="The project's talk page — discussion about the context, powered by Mycelium. People and agents post here; the wiki holds the context, this holds the conversation."
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
                    <Button size="sm" onClick={handleSeed} disabled={seeding}>
                      {seeding ? "Seeding…" : "Seed wiki"}
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
                      />
                    ) : (
                      <ContentLoading />
                    )}
                  </div>
                )}
              </>
            ) : view.kind === "talk" ? (
              <div className="min-w-0 flex-1">
                <TalkPanel slug={slug} />
              </div>
            ) : view.kind === "ingest" ? (
              <div className="min-w-0 flex-1">
                <IngestPanel
                  slug={slug}
                  canEdit
                  onOpenRun={(runId) => setView({ kind: "ingestRun", runId })}
                  onRunStarted={(runId) => setView({ kind: "ingestRun", runId })}
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
                      setView({ kind: "pageHistory", path: view.path })
                    }
                  />
                ) : (
                  <p className="p-8 text-sm text-muted-foreground">Page not found.</p>
                )}
              </div>
            )}
          </main>
        </div>
      </div>
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

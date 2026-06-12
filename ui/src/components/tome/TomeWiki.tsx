"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Eye, EyeOff, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatPanel } from "@/components/tome/ChatPanel";
import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "@/types/tome";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
}

type View = "chat" | "page";

export function TomeWiki({ slug }: { slug: string }) {
  const [data, setData] = useState<PagesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Chat is the landing view; the wiki lives below it in the nav.
  const [view, setView] = useState<View>("chat");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Artifact pane: a page opened from a chat reference, shown right of chat.
  const [artifactPath, setArtifactPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [seeding, setSeeding] = useState(false);

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

  const openPage = useCallback((path: string) => {
    setView("page");
    setSelectedPath(path);
  }, []);

  // Open a page in the artifact pane (from a chat tool reference). Falls back
  // to the full page view if chat isn't the active surface.
  const openArtifact = useCallback((path: string) => {
    setArtifactPath(path);
  }, []);

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

  const handleSeed = useCallback(async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch(`/api/tome/projects/${slug}/pages`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`seed failed (${res.status})`);
      await load();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSeeding(false);
    }
  }, [slug, load]);

  const artifactMarkdown =
    artifactPath && data ? data.pages[artifactPath] : undefined;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <Link href={`/projects/${slug}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              {slug}
            </Button>
          </Link>
        </header>

        {error && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Side nav: Chat on top, the wiki page tree below it. */}
          <aside className="w-64 shrink-0 border-r">
            <ScrollArea className="h-full">
              <div className="flex flex-col p-3">
            <button
              type="button"
              onClick={() => setView("chat")}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-medium transition-colors hover:bg-muted",
                view === "chat" && "bg-muted text-primary",
              )}
            >
              <MessageSquare className="h-4 w-4" />
              Chat
            </button>

            <div className="mt-4 flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Wiki
              </span>
              {!isEmpty && (
                <button
                  type="button"
                  onClick={() => setShowHidden((v) => !v)}
                  title={showHidden ? "Hide agent-only pages" : "Show agent-only pages"}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showHidden ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>

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
                  selectedPath={view === "page" ? selectedPath : null}
                  onSelect={openPage}
                  showHidden={showHidden}
                />
              )
            )}
              </div>
            </ScrollArea>
          </aside>

          {/* Main pane: chat (default, with optional artifact pane) or a page. */}
          {view === "chat" ? (
            <main className="flex flex-1 overflow-hidden">
              <div className="min-w-0 flex-1">
                <ChatPanel
                  slug={slug}
                  onPagesChanged={load}
                  onOpenPage={openArtifact}
                />
              </div>
              {artifactPath && (
                <div className="w-[45%] min-w-[360px] shrink-0 border-l">
                  {artifactMarkdown !== undefined ? (
                    <WikiPageView
                      slug={slug}
                      path={artifactPath}
                      markdown={artifactMarkdown}
                      onWrite={writeMarkdown}
                      onReload={load}
                      onClose={() => setArtifactPath(null)}
                    />
                  ) : (
                    <ContentLoading />
                  )}
                </div>
              )}
            </main>
          ) : (
            <main className="flex flex-1 flex-col overflow-hidden">
              {loading ? (
                <ContentLoading />
              ) : selectedPath && data && data.pages[selectedPath] !== undefined ? (
                <WikiPageView
                  slug={slug}
                  path={selectedPath}
                  markdown={data.pages[selectedPath]}
                  onWrite={writeMarkdown}
                  onReload={load}
                />
              ) : (
                <p className="p-8 text-sm text-muted-foreground">
                  Select a page from the sidebar.
                </p>
              )}
            </main>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

/** Shimmer placeholder rows for the wiki tree while pages load. */
function SidebarSkeleton() {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-1/2", "w-3/5", "w-2/5"];
  return (
    <div className="space-y-2 px-2 py-1" aria-hidden>
      {widths.map((w, i) => (
        <div
          key={i}
          className={cn("h-4 animate-pulse rounded bg-muted", w)}
        />
      ))}
    </div>
  );
}

/** Loading placeholder for the page / artifact content area. */
function ContentLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-8 py-10" aria-hidden>
      <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
      </div>
      <div className="space-y-2 pt-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

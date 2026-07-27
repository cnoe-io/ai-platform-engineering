"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  HelpCircle,
  Layers,
  Link2,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Plus,
  RefreshCw,
  Settings,
  Target,
  Upload,
  UserX,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { FeedPanel } from "@/components/tome/FeedPanel";
import { GistsPanel } from "@/components/tome/GistsPanel";
import { GistView } from "@/components/tome/GistView";
import { TomeLoading } from "@/components/tome/TomeLoading";
import { ProjectSettingsPanel } from "@/components/tome/ProjectSettingsPanel";
import { OnboardingModal } from "@/components/tome/OnboardingModal";
import { WikiSidebar } from "@/components/tome/WikiSidebar";
import { WikiPageView } from "@/components/tome/WikiPageView";
import type { GlossaryPreview } from "@/components/tome/CrepeEditor";
import { parseTomeHref } from "@/lib/tome/tome-links";
import { StandupView } from "@/components/tome/StandupView";
import { IngestPanel } from "@/components/tome/IngestPanel";
import { IngestRunView } from "@/components/tome/IngestRunView";
import { DraftReviewView } from "@/components/tome/DraftReviewView";
import { EngagementPanel } from "@/components/tome/EngagementPanel";
import { PageHistoryView } from "@/components/tome/PageHistoryView";
import { Breadcrumb, type Crumb } from "@/components/tome/Breadcrumb";
import { McpConnectDialog } from "@/components/tome/McpConnectDialog";
import { TomeProductFeedback } from "@/components/tome/TomeProductFeedback";
import { EdgeGraphDialog } from "@/components/tome/EdgeGraphDialog";
import { parseFrontmatter, SPEC_BY_PATH } from "@/lib/tome/schema";
import { normLabel } from "@/lib/projects/labels";
import { cn } from "@/lib/utils";
import type { PageTreeNode } from "@/types/tome";
import { isSynthesizedType, type ProjectType } from "@/types/projects";

interface PagesResponse {
  slug: string;
  tree: PageTreeNode[];
  pages: Record<string, string>;
}

/** An edge authored in another project, pointing at this one. */
interface IncomingEdge {
  source_project_slug: string;
  path: string;
  relation: string;
  source: string;
  target: string;
  confidence: string | null;
  status: string;
}

/** Browser-local flag so the first-run walkthrough only auto-opens once. */
const ONBOARDING_SEEN_KEY = "tome.onboarding.seen";

type MainView =
  | { kind: "agent" }
  | { kind: "standup" }
  | { kind: "feed" }
  | { kind: "gists" }
  | { kind: "gist"; id: string }
  | { kind: "settings" }
  | { kind: "insights" }
  | { kind: "page"; path: string }
  | { kind: "pageHistory"; path: string }
  | { kind: "ingest" }
  | { kind: "ingestRun"; runId: string }
  | { kind: "draftReview"; runId: string };

/**
 * Map the active view to its URL segments under `/projects/<slug>/tome`. The
 * view lives in the route (not React state) so every surface is deep-linkable
 * and browser back/forward work. Wiki page paths (which contain `/` and `.md`)
 * are namespaced under `wiki/` / `history/` so they can't collide with the
 * reserved `feed` / `ingest` segments.
 */
function viewToPath(slug: string, view: MainView): string {
  const base = `/projects/${slug}/tome`;
  switch (view.kind) {
    case "agent":
      return base;
    case "standup":
      return `${base}/standup`;
    case "feed":
      return `${base}/feed`;
    case "gists":
      return `${base}/gists`;
    case "gist":
      return `${base}/gists/${encodeURIComponent(view.id)}`;
    case "settings":
      return `${base}/settings`;
    case "insights":
      return `${base}/insights`;
    case "ingest":
      return `${base}/ingest`;
    case "ingestRun":
      return `${base}/ingest/${encodeURIComponent(view.runId)}`;
    case "draftReview":
      return `${base}/ingest/${encodeURIComponent(view.runId)}/review`;
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
    case "standup":
      return { kind: "standup" };
    case "feed":
      return { kind: "feed" };
    case "gists":
      return rest[0] ? { kind: "gist", id: rest[0] } : { kind: "gists" };
    case "settings":
      return { kind: "settings" };
    case "insights":
      return { kind: "insights" };
    case "ingest":
      return rest[0]
        ? rest[1] === "review"
          ? { kind: "draftReview", runId: rest[0] }
          : { kind: "ingestRun", runId: rest[0] }
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
  const [projectMeta, setProjectMeta] = useState<{
    description: string | null;
    status: string | null;
    teamName: string | null;
    tags: string[];
    dataSteward: string | null;
  }>({ description: null, status: null, teamName: null, tags: [], dataSteward: null });
  const [projectMetaLoading, setProjectMetaLoading] = useState(true);
  // BHAG/Area awareness: this project's kind, the initiatives it's tagged
  // with, and the BHAG entities those initiatives resolve to (for the up-link
  // chip).
  const [projectType, setProjectType] = useState<ProjectType>("project");
  const [initiatives, setInitiatives] = useState<string[]>([]);
  const [areaTags, setAreaTags] = useState<string[]>([]);
  const [parentBhags, setParentBhags] = useState<{ slug: string; name: string }[]>([]);
  const [parentAreas, setParentAreas] = useState<
    { slug: string; name: string; parentBhagName?: string }[]
  >([]);
  // Every BHAG entity (fetched once, unconditionally, for both this project's
  // direct BHAG tags AND resolving an Area's transitive parent BHAG below).
  const [allBhags, setAllBhags] = useState<{ slug: string; name: string }[]>([]);
  const isBhag = projectType === "bhag";
  const isArea = projectType === "area";
  const isSynthesized = isSynthesizedType(projectType);
  // For a BHAG/Area: its own name (the label children are tagged with) and
  // the child projects that resolve from it — surfaced as down-links in the nav.
  const [projectName, setProjectName] = useState("");
  const [childProjects, setChildProjects] = useState<{ slug: string; title: string }[]>([]);
  // A BHAG's down-links, split like ProjectsHub: Areas tagged to it (their own
  // nested project counts) and skip-level projects tagged directly (no area).
  const [childAreas, setChildAreas] = useState<
    { slug: string; title: string; projectCount: number }[]
  >([]);
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
  const [awaitingReview, setAwaitingReview] = useState(false);
  const prevLockedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/tome/projects/${slug}/ingests`);
        if (!res.ok) return;
        const json = await res.json();
        const runs = (json?.data?.runs ?? []) as Array<{ status?: string }>;
        const reviewing = runs.some((r) => r.status === "awaiting_review");
        const active =
          reviewing || runs.some((r) => r.status === "running" || r.status === "queued");
        if (cancelled) return;
        if (prevLockedRef.current && !active) void load();
        prevLockedRef.current = active;
        setLocked(active);
        setAwaitingReview(reviewing);
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
        setProjectName(p.name ?? p.title ?? "");
        setProjectType((p.type as ProjectType) ?? "project");
        setInitiatives(Array.isArray(p.labels?.initiatives) ? p.labels.initiatives : []);
        setAreaTags(Array.isArray(p.labels?.areas) ? p.labels.areas : []);
        setProjectMeta({
          description: typeof p.description === "string" ? p.description : null,
          status: typeof p.status === "string" ? p.status : null,
          teamName: typeof p.team_name === "string" ? p.team_name : null,
          tags: Array.isArray(p.tags) ? p.tags.filter((t: unknown) => typeof t === "string") : [],
          dataSteward: typeof p.data_steward === "string" ? p.data_steward : null,
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setProjectMetaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Fetch every BHAG entity once (unconditionally, unless this page IS a
  // BHAG) — used both to resolve this project's direct BHAG tags below and,
  // further down, to resolve an Area's transitive parent BHAG.
  useEffect(() => {
    if (isBhag) {
      setAllBhags([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=bhag`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setAllBhags((body?.data?.projects ?? []) as { slug: string; name: string }[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, isBhag]);

  const bhagByLabelAll = useMemo(
    () => new Map(allBhags.map((b) => [normLabel(b.name), b])),
    [allBhags],
  );

  // Resolve this project's initiative tags to BHAG entities so a regular
  // project — or an Area, which tags its own parent BHAG the same way —
  // can surface a clickable up-link to its strategic goal(s). Only a true
  // BHAG has no parent to resolve; an Area's `initiatives` tag IS its
  // parent BHAG and must still resolve here.
  useEffect(() => {
    if (isBhag || initiatives.length === 0) {
      setParentBhags([]);
      return;
    }
    const want = new Set(initiatives.map((i) => normLabel(i)));
    setParentBhags(allBhags.filter((b) => want.has(normLabel(b.name))));
  }, [isBhag, initiatives, allBhags]);

  // Resolve this project's area tags to Area entities, mirroring the BHAG
  // up-link above (sky-blue chip instead of the primary-colored BHAG one). A
  // BHAG itself skips this (no parent), but an Area still tags a parent BHAG
  // via the up-link above, not this one. Carries the Area's own parent-BHAG
  // name (its `labels.initiatives[0]`) so a project that ONLY tags an Area —
  // never the BHAG directly — can still show a transitive BHAG chip below.
  useEffect(() => {
    if (isBhag || areaTags.length === 0) {
      setParentAreas([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const all = (body?.data?.projects ?? []) as {
          slug: string;
          name: string;
          labels?: { initiatives?: string[] };
        }[];
        const want = new Set(areaTags.map((a) => normLabel(a)));
        setParentAreas(
          all
            .filter((a) => want.has(normLabel(a.name)))
            .map((a) => ({ slug: a.slug, name: a.name, parentBhagName: a.labels?.initiatives?.[0] })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug, isBhag, areaTags]);

  // BHAGs inherited transitively via an Area tag — only for BHAGs this
  // project doesn't ALSO tag directly (avoids a duplicate chip for legacy
  // data that tags both). Rendered as a distinct "via Area" chip below.
  const transitiveBhags = useMemo(() => {
    const directNorm = new Set(initiatives.map((i) => normLabel(i)));
    const seen = new Set<string>();
    const out: { slug: string; name: string; viaAreaName: string }[] = [];
    for (const a of parentAreas) {
      if (!a.parentBhagName) continue;
      const key = normLabel(a.parentBhagName);
      if (directNorm.has(key) || seen.has(key)) continue;
      const b = bhagByLabelAll.get(key);
      if (b) {
        out.push({ ...b, viaAreaName: a.name });
        seen.add(key);
      }
    }
    return out;
  }, [parentAreas, initiatives, bhagByLabelAll]);

  // For a BHAG/Area, resolve the projects tagged to it so the nav can list
  // them as down-links. A BHAG's children tag it via `labels.initiatives`
  // (`?initiative=`); an Area's children tag it via `labels.areas`
  // (`?area=`) — mirrors the child-resolution split in `lib/tome/bhag.ts`.
  useEffect(() => {
    if (!isSynthesized || !projectName) {
      setChildProjects([]);
      return;
    }
    let cancelled = false;
    const param = isArea ? "area" : "initiative";
    fetch(`/api/projects?${param}=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        const kids = (body?.data?.projects ?? []) as { slug: string; title?: string; name?: string }[];
        setChildProjects(
          kids.map((k) => ({ slug: k.slug, title: k.title || k.name || k.slug })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isSynthesized, isArea, projectName]);

  // For a BHAG specifically, also resolve the Areas tagged to it (via
  // `labels.initiatives`), each with its own tagged-project count, so the
  // down-links split into Areas + "tagged directly" skip-level projects —
  // mirroring ProjectsHub's nested BHAG → Area → Project view.
  useEffect(() => {
    if (!isBhag || !projectName) {
      setChildAreas([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects?type=area&initiative=${encodeURIComponent(projectName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (body) => {
        if (cancelled) return;
        const areaList = (body?.data?.projects ?? []) as { slug: string; name: string; title?: string }[];
        const withCounts = await Promise.all(
          areaList.map(async (a) => {
            try {
              const r = await fetch(`/api/projects?area=${encodeURIComponent(a.name)}`);
              const b = r.ok ? await r.json() : null;
              const count = Array.isArray(b?.data?.projects) ? b.data.projects.length : 0;
              return { slug: a.slug, title: a.title || a.name, projectCount: count };
            } catch {
              return { slug: a.slug, title: a.title || a.name, projectCount: 0 };
            }
          }),
        );
        if (!cancelled) setChildAreas(withCounts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isBhag, projectName]);

  // Edges authored in OTHER projects that target this one — the
  // backlink half; outgoing edges are ordinary pages under this project's own
  // `edges/` dir and already show in the tree above.
  const [incomingEdges, setIncomingEdges] = useState<IncomingEdge[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tome/projects/${slug}/edges`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        setIncomingEdges((body?.data?.incoming ?? []) as IncomingEdge[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

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

  // Resolve a glossary reference to its definition for the hover card. A
  // same-project (bare) term is already loaded in `data.pages` and resolves
  // from memory; a cross-project `tome://@<project>/glossary/<slug>` ref goes
  // through the resolver endpoint.
  const glossaryPreview = useCallback(
    async (ref: string): Promise<GlossaryPreview | null> => {
      const target = parseTomeHref(ref);
      if (!target?.glossaryTerm) return null;

      // Same-project (bare): every page is loaded, so a miss is *definitively*
      // unresolved (return null → dangling). No fetch needed.
      if (!target.project) {
        const md = data?.pages[`glossary/${target.glossaryTerm}.md`];
        if (md === undefined) return null;
        const [fm, bodyRaw] = parseFrontmatter(md);
        const termStr = String(fm.term ?? fm.title ?? target.glossaryTerm);
        const expansion =
          typeof fm.expansion === "string" && fm.expansion.trim()
            ? fm.expansion.trim()
            : undefined;
        const definition = bodyRaw.replace(/^#.*$/m, "").trim().slice(0, 400);
        return { term: termStr, expansion, definition };
      }

      // Cross-project: a non-ok response is transient — throw so the caller
      // leaves the link unmarked. A resolved not-found returns null (dangling).
      const res = await fetch(
        `/api/tome/projects/${slug}/resolve?ref=${encodeURIComponent(ref)}`,
      );
      if (!res.ok) throw new Error(`resolve failed (${res.status})`);
      const d = (await res.json())?.data;
      if (d?.kind === "glossary" && d.found) {
        return {
          term: d.term ?? target.glossaryTerm,
          expansion: d.expansion,
          definition: d.definition ?? "",
        };
      }
      return null;
    },
    [data, slug],
  );

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

  // Rename a page: write its markdown to the new path, then tombstone the old
  // one (there's no move endpoint). History starts fresh on the new path.
  const renamePage = useCallback(
    async (oldPath: string, rawNew: string) => {
      let next = rawNew.trim().replace(/^\/+/, "");
      if (!next) return;
      if (!/\.(md|mdx)$/i.test(next)) next += ".md";
      if (next === oldPath) return;
      if (data?.pages[next] !== undefined) {
        throw new Error(`A page already exists at ${next}`);
      }
      const md = data?.pages[oldPath];
      if (md === undefined) throw new Error("Page not found");
      await writeMarkdown(next, md, `rename ${oldPath} to ${next}`);
      const res = await fetch(`/api/tome/projects/${slug}/pages/${oldPath}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`rename failed to remove old page (${res.status})`);
      await load();
      if (view.kind === "page" && view.path === oldPath) {
        navigate({ kind: "page", path: next });
      }
      setArtifactPath((p) => (p === oldPath ? next : p));
    },
    [data, slug, writeMarkdown, load, navigate, view],
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
      case "standup":
        return [{ label: "Standup" }];
      case "feed":
        return [{ label: "Activity" }];
      case "gists":
        return [{ label: "Gists" }];
      case "gist":
        return [
          { label: "Gists", onClick: () => navigate({ kind: "gists" }) },
          { label: "Gist" },
        ];
      case "settings":
        return [{ label: "Settings" }];
      case "insights":
        return [{ label: "Insights" }];
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
      case "draftReview":
        return [
          {
            label: "Ingest",
            onClick: () => navigate({ kind: "ingest" }),
          },
          {
            label: "Run",
            onClick: () => navigate({ kind: "ingestRun", runId: view.runId }),
          },
          { label: "Review" },
        ];
      default: {
        // Exhaustiveness check: a MainView variant with no case here is a
        // compile error, not a silent `undefined` return.
        const exhaustive: never = view;
        return exhaustive;
      }
    }
  }, [view, data, navigate]);

  // Initiative tag (normalized) → its BHAG wiki entity, when one exists.
  const bhagByInitiative = useMemo(
    () => new Map(parentBhags.map((b) => [normLabel(b.name), b])),
    [parentBhags],
  );
  // Area tag (normalized) → its Area wiki entity, when one exists.
  const areaByLabel = useMemo(
    () => new Map(parentAreas.map((a) => [normLabel(a.name), a])),
    [parentAreas],
  );

  // BHAG → Area → Project up-links, shown as breadcrumb segments instead of
  // badge chips now that the hierarchy is explicit. Only the first tag at
  // each level is shown — a breadcrumb is inherently a single path, unlike
  // the badge cluster which could list every tag.
  const hierarchyCrumbs = useMemo<Crumb[]>(() => {
    const out: Crumb[] = [];
    if (isArea) {
      const b = initiatives.length > 0 ? bhagByInitiative.get(normLabel(initiatives[0])) : undefined;
      if (b) {
        out.push({
          label: b.name,
          href: `/projects/${b.slug}/tome`,
          icon: <Target className="h-3.5 w-3.5 shrink-0 text-primary" />,
          colorClass: "text-primary",
        });
      }
    } else if (!isBhag) {
      const directBhag =
        initiatives.length > 0 ? bhagByInitiative.get(normLabel(initiatives[0])) : undefined;
      const bhagCrumb = directBhag ?? transitiveBhags[0];
      if (bhagCrumb) {
        out.push({
          label: bhagCrumb.name,
          href: `/projects/${bhagCrumb.slug}/tome`,
          icon: <Target className="h-3.5 w-3.5 shrink-0 text-primary" />,
          colorClass: "text-primary",
        });
      }
      const areaEntity = areaTags.length > 0 ? areaByLabel.get(normLabel(areaTags[0])) : undefined;
      if (areaEntity) {
        out.push({
          label: areaEntity.name,
          href: `/projects/${areaEntity.slug}/tome`,
          icon: <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />,
          colorClass: "text-sky-600 dark:text-sky-400",
        });
      }
    }
    return out;
  }, [isArea, isBhag, initiatives, bhagByInitiative, transitiveBhags, areaTags, areaByLabel]);

  const navActive = {
    agent: view.kind === "agent",
    standup: view.kind === "standup",
    feed: view.kind === "feed",
    gists: view.kind === "gists" || view.kind === "gist",
    settings: view.kind === "settings",
    insights: view.kind === "insights",
    ingest:
      view.kind === "ingest" || view.kind === "ingestRun" || view.kind === "draftReview",
    page:
      view.kind === "page" || view.kind === "pageHistory" ? view.path : null,
  };

  const feedbackPagePath =
    view.kind === "page" || view.kind === "pageHistory" ? view.path : undefined;

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col">
        <header className="flex items-center gap-1 px-4 py-2 text-sm">
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
              ...hierarchyCrumbs,
              {
                label: projectTitle ?? slug,
                onClick: () => navigate({ kind: "agent" }),
                icon: isBhag ? (
                  <Target className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : isArea ? (
                  <Layers className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                ) : undefined,
                colorClass: isBhag ? "text-primary" : isArea ? "text-sky-600 dark:text-sky-400" : undefined,
              },
              ...crumbs,
            ]}
          />
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <TomeProductFeedback projectSlug={slug} pagePath={feedbackPagePath} />
            <EdgeGraphDialog slug={slug} />
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

        <div className="border-b pb-3 pl-6 pr-4 pt-0">
          {projectMetaLoading ? (
            <div className="flex flex-col gap-2" data-testid="skeleton">
              <div className="h-5 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
              <div className="flex gap-1.5">
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold leading-tight">
                {projectTitle ?? slug}
              </h1>
              {projectMeta.description && (
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {projectMeta.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {/* No type badge here: the breadcrumb's own page segment now
                    carries the same icon+color (Target+primary for BHAG,
                    Layers+sky for Area) — see `hierarchyCrumbs` and the
                    project-title crumb above — so it isn't duplicated here.
                    BHAG/Area membership (what this page belongs to) is also
                    a breadcrumb segment now instead of a chip cluster. */}
                {projectMeta.teamName && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="gap-1">
                        <Users className="h-3 w-3" />
                        Team: {projectMeta.teamName}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Owning team</TooltipContent>
                  </Tooltip>
                )}
                {projectMeta.dataSteward ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="gap-1">
                        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary">
                          {projectMeta.dataSteward.split("@")[0].split(/[.\-_]/).slice(0, 2).map((p: string) => p[0]?.toUpperCase()).join("")}
                        </span>
                        {projectMeta.dataSteward.split("@")[0]}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>Data steward: {projectMeta.dataSteward}</TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="outline" className="gap-1 text-muted-foreground">
                        <UserX className="h-3 w-3" />
                        No data steward
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>No data steward assigned. Set one in project settings.</TooltipContent>
                  </Tooltip>
                )}
                {projectMeta.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        {error && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Side nav: Chat + Ingest destinations, then the wiki page tree. */}
          <aside className="w-80 shrink-0 border-r">
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
                    icon={
                      <RefreshCw
                        className={cn("h-4 w-4", locked && !awaitingReview && "animate-spin")}
                      />
                    }
                    label={isSynthesized ? "Synthesize" : "Ingest"}
                    active={navActive.ingest}
                    onClick={() => navigate({ kind: "ingest" })}
                    tipTitle={isSynthesized ? "Synthesize" : "Ingest"}
                    tipDescription={
                      isSynthesized
                        ? `Synthesize this ${isArea ? "area" : "BHAG"}: the agent reads the wikis of the projects tagged to it and writes the strategic view. ${isArea ? "An area" : "A BHAG"} has no sources of its own.`
                        : "Start an ingest run that (re)builds the wiki from the project's attached sources: GitHub repos, Confluence spaces, and Webex rooms."
                    }
                    tag={awaitingReview ? "needs review" : undefined}
                  />
                  <NavItem
                    icon={<MessagesSquare className="h-4 w-4" />}
                    label="Activity"
                    active={navActive.feed}
                    onClick={() => navigate({ kind: "feed" })}
                    tipTitle="Activity"
                    tipDescription="The project's activity feed: GitHub and ingest events, shared gists, plus live discussion, powered by Mycelium. People and agents post here; the wiki holds the context, this holds the activity and signal around it."
                  />
                  <NavItem
                    icon={<FileText className="h-4 w-4" />}
                    label="Gists"
                    active={navActive.gists}
                    onClick={() => navigate({ kind: "gists" })}
                    tipTitle="Gists"
                    tipDescription="Quick, non-committal chunks of context (a prompt, an agent memory, a snippet) saved without becoming part of the curated wiki. Share one into the activity feed when a teammate should see it."
                  />
                  <NavItem
                    icon={<Activity className="h-4 w-4" />}
                    label="Insights"
                    active={navActive.insights}
                    onClick={() => navigate({ kind: "insights" })}
                    tipTitle="Insights"
                    tipDescription="How this project's wiki and chat are being used: who's chatting, how much, and this project's own ingestion and wiki-size numbers."
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
                    Reports
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <NavItem
                    icon={<Newspaper className="h-4 w-4" />}
                    label="Standup"
                    active={navActive.standup}
                    onClick={() => navigate({ kind: "standup" })}
                    tipTitle="Standup"
                    tipDescription="The project's report card: headline, blockers, and what's next. Rewritten by the agent on every ingest."
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
                      {isSynthesized ? "Synthesize" : "Run an ingest"}
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

                {/* Synthesized-type down-links: the projects tagged to this
                    BHAG/Area. Links out to each project's own wiki — the
                    roll-up reads these same children; this makes the
                    hierarchy navigable (#92). */}
                {isSynthesized && (
                  <div className="mt-4">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {isBhag ? "Areas & Projects" : "Projects"}
                    </div>
                    {isBhag ? (
                      childAreas.length === 0 && childProjects.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground/70">
                          No areas or projects tagged to this BHAG yet.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {childAreas.length > 0 && (
                            <div className="flex flex-col gap-0.5 pl-3">
                              {childAreas.map((area) => (
                                <Link
                                  key={area.slug}
                                  href={`/projects/${area.slug}/tome`}
                                  className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-sky-600 transition hover:bg-accent dark:text-sky-400"
                                >
                                  <Layers className="h-4 w-4 shrink-0" />
                                  <span className="truncate">{area.title}</span>
                                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                                    {area.projectCount}
                                  </span>
                                  <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                                </Link>
                              ))}
                            </div>
                          )}
                          {childAreas.length > 0 && childProjects.length > 0 && (
                            <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                              Tagged directly (no area)
                            </p>
                          )}
                          {childProjects.length > 0 && (
                            <div className="flex flex-col gap-0.5">
                              {childProjects.map((child) => (
                                <Link
                                  key={child.slug}
                                  href={`/projects/${child.slug}/tome`}
                                  className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                                >
                                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <span className="truncate">{child.title}</span>
                                  <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    ) : childProjects.length === 0 ? (
                      <p className="px-2 py-1 text-xs text-muted-foreground/70">
                        No projects tagged to this area yet.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {childProjects.map((child) => (
                          <Link
                            key={child.slug}
                            href={`/projects/${child.slug}/tome`}
                            className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                          >
                            <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate">{child.title}</span>
                            <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Incoming edges: relationships authored in OTHER
                    projects that point at this one. Outgoing edges are
                    ordinary pages under this project's own `edges/` dir and
                    already show in the tree above. */}
                {incomingEdges.length > 0 && (
                  <div className="mt-4">
                    <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Referenced by
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {incomingEdges.map((e) => (
                        <Link
                          key={`${e.source_project_slug}:${e.path}`}
                          href={`/projects/${e.source_project_slug}/tome/wiki/${e.path}`}
                          title={`${e.source} ${e.relation} ${e.target}`}
                          className="group flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground/80 transition hover:bg-accent hover:text-foreground"
                        >
                          <Link2 className="h-4 w-4 shrink-0 text-amber-500" />
                          <span className="truncate">
                            {e.source_project_slug}: {e.relation}
                          </span>
                          <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-60" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </aside>

          {/* Main pane: replaced wholesale by the active view. */}
          <main className="flex flex-1 overflow-hidden">
            {view.kind === "agent" ? (
              <>
                <div className="min-w-0 flex-1">
                  <ChatPanel
                    slug={slug}
                    onPagesChanged={load}
                    onOpenPage={openArtifact}
                    glossaryPreview={glossaryPreview}
                  />
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
                        awaitingReview={awaitingReview}
                        onNavigate={openArtifact}
                        glossaryPreview={glossaryPreview}
                        onRename={renamePage}
                      />
                    ) : (
                      <TomeLoading />
                    )}
                  </div>
                )}
              </>
            ) : view.kind === "standup" ? (
              <div className="min-w-0 flex-1">
                <StandupView
                  markdown={data?.pages["standup.md"]}
                  onNavigate={(path) => navigate({ kind: "page", path })}
                  glossaryPreview={glossaryPreview}
                  onStartIngest={() => navigate({ kind: "ingest" })}
                  isSynthesized={isSynthesized}
                />
              </div>
            ) : view.kind === "feed" ? (
              <div className="min-w-0 flex-1">
                <FeedPanel
                  slug={slug}
                  onOpenPage={(path) => navigate({ kind: "page", path })}
                  onOpenIngestRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onOpenGist={(id) => navigate({ kind: "gist", id })}
                />
              </div>
            ) : view.kind === "gists" ? (
              <div className="min-w-0 flex-1">
                <GistsPanel slug={slug} onOpenGist={(id) => navigate({ kind: "gist", id })} />
              </div>
            ) : view.kind === "gist" ? (
              <div className="min-w-0 flex-1">
                <GistView key={view.id} slug={slug} id={view.id} onBack={() => navigate({ kind: "gists" })} />
              </div>
            ) : view.kind === "settings" ? (
              <div className="min-w-0 flex-1">
                <ProjectSettingsPanel slug={slug} />
              </div>
            ) : view.kind === "insights" ? (
              <div className="min-w-0 flex-1 overflow-auto">
                <EngagementPanel slug={slug} />
              </div>
            ) : view.kind === "ingest" ? (
              <div className="min-w-0 flex-1">
                <IngestPanel
                  slug={slug}
                  canEdit
                  isSynthesized={isSynthesized}
                  entityKind={isArea ? "area" : "bhag"}
                  onOpenRun={(runId) => navigate({ kind: "ingestRun", runId })}
                  onReviewDraft={(runId) => navigate({ kind: "draftReview", runId })}
                  onRunStarted={(runId) => navigate({ kind: "ingestRun", runId })}
                />
              </div>
            ) : view.kind === "ingestRun" ? (
              <div className="min-w-0 flex-1">
                <IngestRunView
                  key={view.runId}
                  slug={slug}
                  runId={view.runId}
                  onPagesChanged={load}
                  onReviewDraft={(runId) => navigate({ kind: "draftReview", runId })}
                />
              </div>
            ) : view.kind === "draftReview" ? (
              <div className="min-w-0 flex-1">
                <DraftReviewView
                  key={view.runId}
                  slug={slug}
                  runId={view.runId}
                  onResolved={() => {
                    void load();
                    navigate({ kind: "ingestRun", runId: view.runId });
                  }}
                />
              </div>
            ) : view.kind === "pageHistory" ? (
              <div className="min-w-0 flex-1">
                <PageHistoryView slug={slug} path={view.path} />
              </div>
            ) : (
              // page
              <div className="min-w-0 flex-1">
                {loading ? (
                  <TomeLoading />
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
                    awaitingReview={awaitingReview}
                    onNavigate={(path) => navigate({ kind: "page", path })}
                    glossaryPreview={glossaryPreview}
                    onRename={renamePage}
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
  tag,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  tipTitle?: string;
  tipDescription?: React.ReactNode;
  /** Small trailing badge, e.g. "needs review". */
  tag?: string;
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
      <span className="flex-1 truncate">{label}</span>
      {tag && (
        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
          {tag}
        </span>
      )}
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


"use client";

// The projects tagged to a BHAG (via `labels.initiatives`). Rendered inside the
// BHAG's Settings (in place of the Sources editor) and on the Synthesize page.
// A BHAG has no connectors — its "sources" are the wikis of the projects beneath
// it, which the agent reads to synthesize the strategic view.
//
// On the Synthesize page (`preflight`), each project shows a resource-access
// indicator: a child re-ingest only refreshes what the triggering user's
// credentials can actually reach, so this previews which children will refresh.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, FolderKanban, Layers, Loader2, X } from "lucide-react";

import {
  preflightRollup,
  type PreflightResult,
  type PreflightState,
} from "@/lib/tome/preflight";
import { normLabel } from "@/lib/projects/labels";
import type { ProjectDocument } from "@/types/projects";

type ChildProject = ProjectDocument & {
  page_count?: number | null;
};

/** Run `fn` over items with at most `limit` in flight at once. */
async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * The projects tagged to a synthesized (BHAG or Area) entity — via
 * `labels.initiatives` for a BHAG, `labels.areas` for an Area. Rendered
 * inside the entity's Settings (in place of the Sources editor) and on its
 * Synthesize page. Neither kind has connectors of its own — its "sources"
 * are the wikis of the projects beneath it, which the agent reads to
 * synthesize the strategic view.
 */
export function ChildProjectsPanel({
  bhagName,
  entityKind = "bhag",
  preflight = false,
  editable = false,
  onCount,
}: {
  /** The parent entity's name (the label value children are tagged with). */
  bhagName: string;
  /** Which kind of synthesized entity this is — drives the label dimension
   * (`labels.initiatives` vs `labels.areas`) and copy. */
  entityKind?: "bhag" | "area";
  /** Check + show each project's resource access (Synthesize page). */
  preflight?: boolean;
  /** Allow adding/removing tagged projects (Settings). */
  editable?: boolean;
  /** Reports the tagged-project count to the caller (for the section title). */
  onCount?: (n: number) => void;
}) {
  const labelDim = entityKind === "area" ? "areas" : "initiatives";
  const queryParam = entityKind === "area" ? "area" : "initiative";
  const entityLabel = entityKind === "area" ? "area" : "BHAG";
  const [projects, setProjects] = useState<ChildProject[]>([]);
  // project _id -> the Area name it was pulled in through, for a BHAG's
  // synthesis-preview view — surfaced on the card so it's clear this project
  // isn't tagged to the BHAG directly.
  const [viaArea, setViaArea] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // project_id -> access state (absent = still checking).
  const [access, setAccess] = useState<Record<string, PreflightState>>({});
  // Untagged candidate projects for the "Add project" dropdown (editable).
  const [candidates, setCandidates] = useState<ChildProject[]>([]);
  const [mutating, setMutating] = useState(false);

  // Children are tagged with the parent's name as an initiative/area label;
  // the list API filters by that dimension (OR within it) and excludes BHAGs.
  //
  // For a non-editable BHAG view (the synthesis preview), a direct-tag query
  // alone undercounts: BHAG synthesis actually reads through its Areas too
  // (mirrors `resolveBhagChildren` server-side), so a project that only tags
  // an Area — never the BHAG directly — belongs in this list as well. The
  // editable Settings view for a BHAG stays direct-tag-only on purpose: it's
  // for adding/removing a project's *direct* (skip-level) tag, not editing
  // through an Area.
  const loadTagged = useCallback(async () => {
    setError(null);
    try {
      if (entityKind === "bhag" && !editable) {
        const [areaRes, directRes] = await Promise.all([
          fetch(`/api/projects?type=area&initiative=${encodeURIComponent(bhagName)}`),
          fetch(`/api/projects?initiative=${encodeURIComponent(bhagName)}`),
        ]);
        if (!areaRes.ok && !directRes.ok) throw new Error("Failed to load projects");
        const areasList = areaRes.ok
          ? (((await areaRes.json()).data?.projects ?? []) as { name: string }[])
          : [];
        const directList = directRes.ok
          ? (((await directRes.json()).data?.projects ?? []) as ChildProject[])
          : [];
        const areaProjectLists = await Promise.all(
          areasList.map(async (a) => {
            const r = await fetch(`/api/projects?area=${encodeURIComponent(a.name)}`);
            if (!r.ok) return { areaName: a.name, list: [] as ChildProject[] };
            const body = await r.json();
            return { areaName: a.name, list: (body.data?.projects ?? []) as ChildProject[] };
          }),
        );
        const byId = new Map<string, ChildProject>();
        for (const p of directList) byId.set(String(p._id), p);
        const via: Record<string, string> = {};
        for (const { areaName, list } of areaProjectLists) {
          for (const p of list) {
            byId.set(String(p._id), p);
            via[String(p._id)] = areaName;
          }
        }
        const combined = [...byId.values()];
        setProjects(combined);
        setViaArea(via);
        onCount?.(combined.length);
        return;
      }
      const res = await fetch(`/api/projects?${queryParam}=${encodeURIComponent(bhagName)}`);
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error ?? "Failed to load projects");
      const list = (b.data?.projects ?? []) as ChildProject[];
      setProjects(list);
      setViaArea({});
      onCount?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bhagName, queryParam, onCount, entityKind, editable]);

  // Projects not yet tagged to this entity (the add menu). `/api/projects`
  // excludes BHAGs/Areas by default.
  const loadCandidates = useCallback(async () => {
    if (!editable) return;
    try {
      const res = await fetch(`/api/projects`);
      const b = await res.json();
      if (!res.ok) return;
      const all = (b.data?.projects ?? []) as ChildProject[];
      const want = normLabel(bhagName);
      setCandidates(
        all.filter((p) => !(p.labels?.[labelDim] ?? []).some((i) => normLabel(i) === want)),
      );
    } catch {
      /* best-effort — the add menu just stays empty */
    }
  }, [editable, bhagName, labelDim]);

  useEffect(() => {
    setLoading(true);
    void loadTagged();
  }, [loadTagged]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const patchInitiatives = async (
    slug: string,
    dim: "initiatives" | "areas",
    values: string[],
  ) => {
    const res = await fetch(`/api/projects/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [dim]: values }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `Update failed (${res.status})`);
    }
  };

  const addProject = async (target: ChildProject) => {
    setMutating(true);
    setError(null);
    try {
      const current = target.labels?.[labelDim] ?? [];
      await patchInitiatives(target.slug, labelDim, [...current, bhagName]);
      await Promise.all([loadTagged(), loadCandidates()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMutating(false);
    }
  };

  const removeProject = async (child: ChildProject) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Remove "${child.title}" from the ${bhagName} ${entityLabel}?`)
    ) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const want = normLabel(bhagName);
      const next = (child.labels?.[labelDim] ?? []).filter((i) => normLabel(i) !== want);
      await patchInitiatives(child.slug, labelDim, next);
      await Promise.all([loadTagged(), loadCandidates()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setMutating(false);
    }
  };

  // Resource-access preflight per child (Synthesize page only). Bounded parallel
  // so opening the page doesn't fire N checks at once; each row fills in as it
  // resolves.
  useEffect(() => {
    if (!preflight || projects.length === 0) return;
    let cancelled = false;
    setAccess({});
    void mapLimit(projects, 4, async (p) => {
      let state: PreflightState = "unknown";
      try {
        const res = await fetch(`/api/tome/projects/${p.slug}/preflight`, { method: "POST" });
        if (res.ok) {
          const b = await res.json();
          state = preflightRollup(b.data as PreflightResult);
        }
      } catch {
        /* leave unknown */
      }
      if (!cancelled) setAccess((prev) => ({ ...prev, [String(p._id)]: state }));
    });
    return () => {
      cancelled = true;
    };
  }, [preflight, projects]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Projects tagged to this {entityLabel}. The agent reads their wikis to synthesize this{" "}
        {entityLabel}&apos;s wiki. Add one here, or tag a project from its own Settings under{" "}
        {entityKind === "area" ? "Areas" : "BHAG / Initiatives"}.
      </p>

      {editable && (
        <div className="flex items-center gap-2">
          <select
            value=""
            disabled={mutating || candidates.length === 0}
            onChange={(e) => {
              const c = candidates.find((x) => x.slug === e.target.value);
              if (c) void addProject(c);
            }}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="" disabled>
              {candidates.length === 0 ? "No more projects to add" : `Add a project to this ${entityLabel}…`}
            </option>
            {candidates.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.title}
              </option>
            ))}
          </select>
          {mutating && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Fixed-height scroll region so the list (or its skeleton) never reflows
          the content below it when projects load in. */}
      <div className="h-64 overflow-y-auto">
        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[82px] animate-pulse rounded-lg border border-border/60 bg-card/50"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No projects tagged yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add <span className="font-medium text-foreground">{bhagName}</span> under{" "}
              {entityKind === "area" ? "Areas" : "BHAG / Initiatives"} on a project to ladder it
              up to this {entityLabel}.
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <div
                key={String(p._id)}
                className="group flex flex-col rounded-lg border border-border/60 bg-card/50 p-3 transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.slug}/tome`}
                    className="font-medium leading-snug hover:text-primary"
                  >
                    {p.title}
                  </Link>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => void removeProject(p)}
                      disabled={mutating}
                      title={`Remove from ${bhagName} ${entityLabel}`}
                      aria-label={`Remove ${p.title}`}
                      className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground/50">{p.team_name}</span>
                <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" />
                  {p.page_count ?? 0} {(p.page_count ?? 0) === 1 ? "page" : "pages"}
                </span>
                {viaArea[String(p._id)] && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400">
                    <Layers className="h-3 w-3" />
                    via Area: {viaArea[String(p._id)]}
                  </span>
                )}
                {preflight && <AccessLine state={access[String(p._id)]} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Resource-access indicator for one child on the Synthesize page. */
function AccessLine({ state }: { state: PreflightState | undefined }) {
  if (state === undefined) {
    return (
      <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking access…
      </span>
    );
  }
  const spec: Record<PreflightState, { dot: string; label: string }> = {
    ok: { dot: "bg-emerald-500", label: "Access confirmed" },
    access_issue: { dot: "bg-amber-500", label: "Some sources blocked" },
    no_token: { dot: "bg-destructive", label: "Not connected" },
    unknown: { dot: "bg-muted-foreground/50", label: "Access unknown" },
  };
  const s = spec[state];
  return (
    <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

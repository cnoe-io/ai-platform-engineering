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
import { BookOpen, FolderKanban, Loader2, X } from "lucide-react";

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

export function BhagProjectsPanel({
  bhagName,
  preflight = false,
  editable = false,
  onCount,
}: {
  bhagName: string;
  /** Check + show each project's resource access (Synthesize page). */
  preflight?: boolean;
  /** Allow adding/removing tagged projects (Settings). */
  editable?: boolean;
  /** Reports the tagged-project count to the caller (for the section title). */
  onCount?: (n: number) => void;
}) {
  const [projects, setProjects] = useState<ChildProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // project_id -> access state (absent = still checking).
  const [access, setAccess] = useState<Record<string, PreflightState>>({});
  // Untagged candidate projects for the "Add project" dropdown (editable).
  const [candidates, setCandidates] = useState<ChildProject[]>([]);
  const [mutating, setMutating] = useState(false);

  // Children are tagged with the BHAG's name as an initiative label; the list
  // API filters by initiative (OR within the dimension) and excludes BHAGs.
  const loadTagged = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects?initiative=${encodeURIComponent(bhagName)}`);
      const b = await res.json();
      if (!res.ok) throw new Error(b?.error ?? "Failed to load projects");
      const list = (b.data?.projects ?? []) as ChildProject[];
      setProjects(list);
      onCount?.(list.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [bhagName, onCount]);

  // Non-BHAG projects not yet tagged to this BHAG (the add menu). `/api/projects`
  // excludes BHAGs by default.
  const loadCandidates = useCallback(async () => {
    if (!editable) return;
    try {
      const res = await fetch(`/api/projects`);
      const b = await res.json();
      if (!res.ok) return;
      const all = (b.data?.projects ?? []) as ChildProject[];
      const want = normLabel(bhagName);
      setCandidates(
        all.filter((p) => !(p.labels?.initiatives ?? []).some((i) => normLabel(i) === want)),
      );
    } catch {
      /* best-effort — the add menu just stays empty */
    }
  }, [editable, bhagName]);

  useEffect(() => {
    setLoading(true);
    void loadTagged();
  }, [loadTagged]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const patchInitiatives = async (slug: string, initiatives: string[]) => {
    const res = await fetch(`/api/projects/${slug}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initiatives }),
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
      const current = target.labels?.initiatives ?? [];
      await patchInitiatives(target.slug, [...current, bhagName]);
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
      !window.confirm(`Remove "${child.title}" from the ${bhagName} BHAG?`)
    ) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const want = normLabel(bhagName);
      const next = (child.labels?.initiatives ?? []).filter((i) => normLabel(i) !== want);
      await patchInitiatives(child.slug, next);
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
        Projects tagged to this BHAG. The agent reads their wikis to synthesize this BHAG&apos;s
        wiki. Add one here, or tag a project from its own Settings under BHAG / Initiatives.
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
              {candidates.length === 0 ? "No more projects to add" : "Add a project to this BHAG…"}
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
              Add <span className="font-medium text-foreground">{bhagName}</span> under BHAG /
              Initiatives on a project to ladder it up to this goal.
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <div
                key={String(p._id)}
                className="group flex flex-col rounded-lg border border-border/60 bg-card/50 p-3 transition hover:border-violet-500/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/projects/${p.slug}/tome`}
                    className="font-medium leading-snug hover:text-violet-600 dark:hover:text-violet-300"
                  >
                    {p.title}
                  </Link>
                  {editable && (
                    <button
                      type="button"
                      onClick={() => void removeProject(p)}
                      disabled={mutating}
                      title={`Remove from ${bhagName}`}
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

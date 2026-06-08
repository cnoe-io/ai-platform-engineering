// assisted-by claude code claude-opus-4-8
//
// Project label dimensions (Domain · BHAG/Initiative · Swim Lane) — free-form,
// multi-value, grouped case/whitespace-insensitively. Pure helpers (unit
// tested); no DB or server-runtime imports so they load in any test env.

import type { ProjectDocument, ProjectLabels } from "@/types/projects";

/** Normalized grouping key: case- and whitespace-insensitive. */
export function normLabel(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Trim, drop empties, dedup-by-normalized (keeping first original spelling). */
export function cleanLabelList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = normLabel(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Sanitize an inbound labels object from a request body. */
export function sanitizeLabels(
  input: unknown,
  domainFallback?: string,
): ProjectLabels {
  const obj = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const domainRaw =
    typeof obj.domain === "string" && obj.domain.trim()
      ? obj.domain.trim()
      : domainFallback?.trim() || undefined;
  const labels: ProjectLabels = {
    initiatives: cleanLabelList(obj.initiatives),
    swimlanes: cleanLabelList(obj.swimlanes),
  };
  if (domainRaw) labels.domain = domainRaw;
  return labels;
}

export interface FacetValue {
  value: string; // display spelling
  count: number;
}

export interface ProjectFacets {
  domains: FacetValue[];
  initiatives: FacetValue[];
  swimlanes: FacetValue[];
  total: number;
}

/** Build faceted counts across a set of projects, grouped by normalized key. */
export function computeFacets(projects: ProjectDocument[]): ProjectFacets {
  const dims: Record<"domains" | "initiatives" | "swimlanes", Map<string, FacetValue>> = {
    domains: new Map(),
    initiatives: new Map(),
    swimlanes: new Map(),
  };

  const bump = (
    dim: "domains" | "initiatives" | "swimlanes",
    raw: string | undefined,
  ) => {
    if (!raw || !raw.trim()) return;
    const key = normLabel(raw);
    const existing = dims[dim].get(key);
    if (existing) existing.count += 1;
    else dims[dim].set(key, { value: raw.trim(), count: 1 });
  };

  for (const p of projects) {
    const labels = p.labels ?? {};
    bump("domains", labels.domain ?? p.domain);
    for (const i of labels.initiatives ?? []) bump("initiatives", i);
    for (const s of labels.swimlanes ?? []) bump("swimlanes", s);
  }

  const sortDesc = (m: Map<string, FacetValue>) =>
    [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    domains: sortDesc(dims.domains),
    initiatives: sortDesc(dims.initiatives),
    swimlanes: sortDesc(dims.swimlanes),
    total: projects.length,
  };
}

/** Does a project match a label filter? (AND across dimensions, OR within.) */
export function projectMatchesLabels(
  project: ProjectDocument,
  filter: { domains?: string[]; initiatives?: string[]; swimlanes?: string[] },
): boolean {
  const labels = project.labels ?? {};
  const projDomain = labels.domain ?? project.domain;
  const has = (values: string[] | undefined, candidates: (string | undefined)[]) => {
    if (!values || values.length === 0) return true;
    const want = new Set(values.map(normLabel));
    return candidates.some((c) => c && want.has(normLabel(c)));
  };
  return (
    has(filter.domains, [projDomain]) &&
    has(filter.initiatives, labels.initiatives ?? []) &&
    has(filter.swimlanes, labels.swimlanes ?? [])
  );
}

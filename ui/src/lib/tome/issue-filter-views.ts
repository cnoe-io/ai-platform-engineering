export const ISSUE_FILTER_ALL = "all";
export const ISSUE_FILTER_NONE = "__none__";

export interface IssueFilters {
  query: string;
  contentType: string;
  state: string;
  repository: string;
  label: string;
  assignee: string;
  author: string;
  milestone: string;
  priority: string;
}

export interface IssueFilterView {
  id: string;
  title: string;
  filters: IssueFilters;
}

export interface StoredIssueFilterViews {
  version: 1;
  custom: IssueFilterView[];
  order: string[];
}

const FILTER_VALUE_LIMIT = 500;
const VIEW_ID_LIMIT = 100;
const VIEW_TITLE_LIMIT = 80;
const MAX_CUSTOM_VIEWS = 50;

export function emptyIssueFilters(): IssueFilters {
  return {
    query: "",
    contentType: ISSUE_FILTER_ALL,
    state: ISSUE_FILTER_ALL,
    repository: ISSUE_FILTER_ALL,
    label: ISSUE_FILTER_ALL,
    assignee: ISSUE_FILTER_ALL,
    author: ISSUE_FILTER_ALL,
    milestone: ISSUE_FILTER_ALL,
    priority: ISSUE_FILTER_ALL,
  };
}

export function issueFiltersForLabel(label: string): IssueFilters {
  return { ...emptyIssueFilters(), label: cleanValue(label, ISSUE_FILTER_ALL) };
}

export const DEFAULT_ISSUE_FILTER_VIEWS: IssueFilterView[] = [
  {
    id: "tome-tracker",
    title: "Tome Tracker",
    filters: issueFiltersForLabel("tome-tracker"),
  },
  { id: "decision", title: "Decisions", filters: issueFiltersForLabel("decision") },
  { id: "critical", title: "Critical", filters: issueFiltersForLabel("critical") },
];

function cleanValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, FILTER_VALUE_LIMIT)
    : fallback;
}

export function normalizeIssueFilters(value: unknown): IssueFilters {
  const candidate = value && typeof value === "object"
    ? value as Partial<IssueFilters>
    : {};
  return {
    query: typeof candidate.query === "string"
      ? candidate.query.slice(0, FILTER_VALUE_LIMIT)
      : "",
    contentType: cleanValue(candidate.contentType, ISSUE_FILTER_ALL),
    state: cleanValue(candidate.state, ISSUE_FILTER_ALL),
    repository: cleanValue(candidate.repository, ISSUE_FILTER_ALL),
    label: cleanValue(candidate.label, ISSUE_FILTER_ALL),
    assignee: cleanValue(candidate.assignee, ISSUE_FILTER_ALL),
    author: cleanValue(candidate.author, ISSUE_FILTER_ALL),
    milestone: cleanValue(candidate.milestone, ISSUE_FILTER_ALL),
    priority: cleanValue(candidate.priority, ISSUE_FILTER_ALL),
  };
}

export function normalizeIssueFilterView(value: unknown): IssueFilterView | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IssueFilterView> & { label?: unknown };
  const id = cleanValue(candidate.id, "").slice(0, VIEW_ID_LIMIT);
  const title = cleanValue(candidate.title, "").slice(0, VIEW_TITLE_LIMIT);
  if (!id || !title) return null;
  return {
    id,
    title,
    filters: normalizeIssueFilters(candidate.filters),
  };
}

export function normalizeStoredIssueFilterViews(
  value: unknown,
): StoredIssueFilterViews {
  const candidate = value && typeof value === "object"
    ? value as Partial<StoredIssueFilterViews>
    : {};
  const defaultIds = new Set(
    DEFAULT_ISSUE_FILTER_VIEWS.map(({ id }) => id.toLowerCase()),
  );
  const seen = new Set(defaultIds);
  const custom: IssueFilterView[] = [];
  if (Array.isArray(candidate.custom)) {
    for (const raw of candidate.custom) {
      const view = normalizeIssueFilterView(raw);
      if (!view || seen.has(view.id.toLowerCase())) continue;
      seen.add(view.id.toLowerCase());
      custom.push(view);
      if (custom.length >= MAX_CUSTOM_VIEWS) break;
    }
  }
  const knownIds = new Map(
    [...DEFAULT_ISSUE_FILTER_VIEWS, ...custom].map(({ id }) => [
      id.toLowerCase(),
      id,
    ]),
  );
  const order: string[] = [];
  const ordered = new Set<string>();
  if (Array.isArray(candidate.order)) {
    for (const raw of candidate.order) {
      if (typeof raw !== "string") continue;
      const id = knownIds.get(raw.toLowerCase());
      if (!id || ordered.has(id.toLowerCase())) continue;
      ordered.add(id.toLowerCase());
      order.push(id);
    }
  }
  for (const { id } of [...DEFAULT_ISSUE_FILTER_VIEWS, ...custom]) {
    if (!ordered.has(id.toLowerCase())) order.push(id);
  }
  return { version: 1, custom, order };
}

export function migrateLegacyIssueLabelViews(value: unknown): StoredIssueFilterViews {
  const candidate = Array.isArray(value)
    ? { custom: value, order: [] }
    : value && typeof value === "object"
      ? value as { custom?: unknown; order?: unknown }
      : {};
  const rawCustom = Array.isArray(candidate.custom) ? candidate.custom : [];
  const seenLabels = new Set(
    DEFAULT_ISSUE_FILTER_VIEWS.map(({ filters }) => filters.label.toLowerCase()),
  );
  const custom: IssueFilterView[] = rawCustom.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const legacy = raw as { label?: unknown; title?: unknown };
    const label = cleanValue(legacy.label, "");
    const title = cleanValue(legacy.title, "").slice(0, VIEW_TITLE_LIMIT);
    if (!label || !title || seenLabels.has(label.toLowerCase())) return [];
    seenLabels.add(label.toLowerCase());
    return [{
      id: issueFilterViewId(title, label),
      title,
      filters: issueFiltersForLabel(label),
    }];
  });
  const idByLegacyLabel = new Map(custom.map((view) => [
    view.filters.label.toLowerCase(),
    view.id,
  ]));
  const order = Array.isArray(candidate.order)
    ? candidate.order.flatMap((raw) => {
        if (typeof raw !== "string") return [];
        const defaultView = DEFAULT_ISSUE_FILTER_VIEWS.find(
          ({ filters }) => filters.label.toLowerCase() === raw.toLowerCase(),
        );
        const id = defaultView?.id ?? idByLegacyLabel.get(raw.toLowerCase());
        return id ? [id] : [];
      })
    : [];
  return normalizeStoredIssueFilterViews({ custom, order });
}

function issueFilterViewId(title: string, fallback: string): string {
  return (title || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, VIEW_ID_LIMIT) || "saved-filter";
}

export function uniqueIssueFilterViewId(
  title: string,
  existingIds: string[],
): string {
  const base = issueFilterViewId(title, "saved-filter");
  const existing = new Set(existingIds.map((id) => id.toLowerCase()));
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix <= MAX_CUSTOM_VIEWS + 2; suffix += 1) {
    const candidate = `${base.slice(0, VIEW_ID_LIMIT - String(suffix).length - 1)}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base.slice(0, VIEW_ID_LIMIT - 9)}-${Date.now().toString(36)}`;
}

export function issueFiltersEqual(left: IssueFilters, right: IssueFilters): boolean {
  return (Object.keys(emptyIssueFilters()) as Array<keyof IssueFilters>).every(
    (key) => left[key] === right[key],
  );
}

export function hasIssueFilters(filters: IssueFilters): boolean {
  return Boolean(filters.query.trim()) ||
    filters.contentType !== ISSUE_FILTER_ALL ||
    filters.state !== ISSUE_FILTER_ALL ||
    filters.repository !== ISSUE_FILTER_ALL ||
    filters.label !== ISSUE_FILTER_ALL ||
    filters.assignee !== ISSUE_FILTER_ALL ||
    filters.author !== ISSUE_FILTER_ALL ||
    filters.milestone !== ISSUE_FILTER_ALL ||
    filters.priority !== ISSUE_FILTER_ALL;
}

export function reorderIssueFilterViews(
  views: IssueFilterView[],
  sourceId: string,
  targetId: string,
): IssueFilterView[] {
  const sourceIndex = views.findIndex(
    ({ id }) => id.toLowerCase() === sourceId.toLowerCase(),
  );
  const targetIndex = views.findIndex(
    ({ id }) => id.toLowerCase() === targetId.toLowerCase(),
  );
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return views;
  }
  const reordered = [...views];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  return reordered;
}

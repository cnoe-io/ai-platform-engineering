export const TOME_TRACKER_PREFIX = "tome:";

export interface TomeTrackedIssueLabel {
  id: string;
  label: string;
  title: string;
}

export const TOME_TRACKED_ISSUE_LABELS: readonly TomeTrackedIssueLabel[] = [
  { id: "critical", label: "tome:critical", title: "Critical" },
  { id: "in-progress", label: "tome:in-progress", title: "In Progress" },
  { id: "completed", label: "tome:completed", title: "Completed" },
] as const;

const CUSTOM_TRACKER_SUFFIX = /^[a-z0-9](?:[a-z0-9-]{0,47}[a-z0-9])?$/;

export function customTomeTrackerLabel(suffix: string): string | null {
  const normalized = suffix.trim().toLowerCase();
  if (!CUSTOM_TRACKER_SUFFIX.test(normalized)) return null;
  const label = `${TOME_TRACKER_PREFIX}${normalized}`;
  return TOME_TRACKED_ISSUE_LABELS.some((tracked) => tracked.label === label)
    ? null
    : label;
}

export function tomeTrackedIssueLabel(label: string): TomeTrackedIssueLabel {
  const normalized = label.trim().toLowerCase();
  const builtIn = TOME_TRACKED_ISSUE_LABELS.find(
    (tracked) => tracked.label === normalized,
  );
  if (builtIn) return builtIn;
  const suffix = normalized.slice(TOME_TRACKER_PREFIX.length);
  return {
    id: suffix,
    label: normalized,
    title: suffix.split("-").map(
      (word) => word.charAt(0).toUpperCase() + word.slice(1),
    ).join(" "),
  };
}

export function normalizeCustomTomeTrackerLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string" || !raw.startsWith(TOME_TRACKER_PREFIX)) continue;
    const label = customTomeTrackerLabel(raw.slice(TOME_TRACKER_PREFIX.length));
    if (label) labels.add(label);
  }
  return [...labels].sort((left, right) => left.localeCompare(right)).slice(0, 20);
}

export function isTomeTrackedIssueLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return TOME_TRACKED_ISSUE_LABELS.some(
    (tracked) => tracked.label === normalized,
  );
}

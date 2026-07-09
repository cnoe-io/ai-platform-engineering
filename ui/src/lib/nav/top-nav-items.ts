// Shared catalog + helpers for admin-customizable top navigation.
//
// The AppHeader builds its full list of nav tabs (built-in tabs + any pinned
// agentic apps), then applies the admin-configured order + hidden set via
// `applyTopNavConfig`. The admin "Navigation" settings tab edits that same
// config. Both sides key off the stable `key` strings below.
//
// assisted-by claude code claude-opus-4-8

export interface TopNavItemMeta {
  key: string;
  /** Human label shown in the admin reorder/toggle editor. */
  label: string;
}

/**
 * Canonical built-in top-nav tabs in their default display order. Pinned
 * agentic apps (key `app-<appId>`) are appended dynamically by the header and
 * surfaced in the admin editor by fetching the installed-apps list — they are
 * not listed here because they vary per deployment.
 */
export const BUILT_IN_TOP_NAV_ITEMS: TopNavItemMeta[] = [
  { key: "home", label: "Home" },
  { key: "chat", label: "Chat" },
  { key: "skills", label: "Skills" },
  { key: "workflows", label: "Workflows" },
  { key: "knowledge", label: "Knowledge Bases" },
  { key: "dynamic-agents", label: "Agents" },
  { key: "credentials", label: "Connections" },
  { key: "admin", label: "Admin" },
];

export const DEFAULT_TOP_NAV_ORDER: string[] = BUILT_IN_TOP_NAV_ITEMS.map(
  (item) => item.key,
);

export interface TopNavConfig {
  /** Ordered list of nav keys. Keys not present keep their default order. */
  order: string[];
  /** Nav keys an admin has disabled (hidden from the top nav). */
  hidden: string[];
}

export const EMPTY_TOP_NAV_CONFIG: TopNavConfig = { order: [], hidden: [] };

/** Coerce arbitrary input (API payload / Mongo doc) into a safe TopNavConfig. */
export function normalizeTopNavConfig(input: unknown): TopNavConfig {
  const rec =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const order = Array.isArray(rec.order)
    ? rec.order.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  const hidden = Array.isArray(rec.hidden)
    ? rec.hidden.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  // De-dupe while preserving first occurrence.
  return {
    order: Array.from(new Set(order)),
    hidden: Array.from(new Set(hidden)),
  };
}

/**
 * Apply an admin nav config to a list of items keyed by `key`:
 *  - drop any item whose key is in `hidden`
 *  - sort by `order` (listed keys first, in that order; unlisted keys keep
 *    their original relative order at the end)
 * Array.prototype.sort is stable (ES2019+), so unlisted items stay put.
 */
export function applyTopNavConfig<T extends { key: string }>(
  items: T[],
  config: TopNavConfig | null | undefined,
): T[] {
  const hidden = new Set(config?.hidden ?? []);
  const visible = items.filter((item) => !hidden.has(item.key));
  const order = config?.order ?? [];
  if (order.length === 0) return visible;
  const rank = new Map(order.map((key, idx) => [key, idx] as const));
  const END = Number.MAX_SAFE_INTEGER;
  return [...visible].sort(
    (a, b) => (rank.get(a.key) ?? END) - (rank.get(b.key) ?? END),
  );
}

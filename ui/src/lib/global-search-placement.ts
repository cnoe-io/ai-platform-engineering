export const GLOBAL_SEARCH_PLACEMENTS = [
  "sidebar",
  "header-right",
  "header-center",
] as const;

export type GlobalSearchPlacement = typeof GLOBAL_SEARCH_PLACEMENTS[number];

export const DEFAULT_GLOBAL_SEARCH_PLACEMENT: GlobalSearchPlacement = "sidebar";

export function normalizeGlobalSearchPlacement(
  value: unknown,
): GlobalSearchPlacement | null {
  return typeof value === "string" && (
    GLOBAL_SEARCH_PLACEMENTS as readonly string[]
  ).includes(value)
    ? value as GlobalSearchPlacement
    : null;
}

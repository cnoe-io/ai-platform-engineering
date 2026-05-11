// assisted-by Codex Codex-sonnet-4-6

import { ApiError } from "@/lib/api-error";
import type { AgenticAppPackageCatalogMeta } from "@/types/agentic-app";

const ALLOWED_CATALOG_KEYS = new Set<keyof AgenticAppPackageCatalogMeta>([
  "categories",
  "capabilities",
]);

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Parse admin-supplied `catalog` JSON: only `categories` and `capabilities`
 * (each string[]) are allowed. Unknown keys or wrong element types → 400.
 * `undefined` means omit catalog from persistence; explicit `{}` yields an empty meta object.
 */
export function parseAgenticPackageCatalogInput(
  raw: unknown,
): AgenticAppPackageCatalogMeta | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ApiError("catalog must be an object with optional categories and capabilities", 400);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_CATALOG_KEYS.has(key as keyof AgenticAppPackageCatalogMeta)) {
      throw new ApiError(`catalog has unknown key "${key}"`, 400);
    }
  }
  const out: AgenticAppPackageCatalogMeta = {};
  if (obj.categories !== undefined) {
    if (!isStringArray(obj.categories)) {
      throw new ApiError("catalog.categories must be an array of strings", 400);
    }
    out.categories = obj.categories;
  }
  if (obj.capabilities !== undefined) {
    if (!isStringArray(obj.capabilities)) {
      throw new ApiError("catalog.capabilities must be an array of strings", 400);
    }
    out.capabilities = obj.capabilities;
  }
  return out;
}

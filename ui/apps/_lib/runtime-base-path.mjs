/**
 * Resolve the browser-facing base path supplied by the trusted CAIPE gateway.
 * Direct/local runtime access continues to use the configured fallback.
 */
export function resolveAgenticAppRuntimeBasePath(headers, fallback, appId) {
  const raw = headers?.["x-forwarded-prefix"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const expected = `/api/agentic-apps/runtime/${encodeURIComponent(appId)}`;
  return candidate === expected ? expected : normalizeBasePath(fallback);
}

export function resolveAgenticAppSurface(headers) {
  const raw = headers?.["x-caipe-surface"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  return candidate === "hosted" ? "hosted" : "standalone";
}

function normalizeBasePath(value) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

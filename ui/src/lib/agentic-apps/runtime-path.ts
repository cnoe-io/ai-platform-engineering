export const AGENTIC_APP_RUNTIME_GATEWAY_BASE = "/api/agentic-apps/runtime";

/** Build the private same-origin gateway URL loaded by the app shell iframe. */
export function buildAgenticAppRuntimePath(appId: string, path: string[] = []): string {
  const encodedAppId = encodeURIComponent(appId);
  const encodedPath = path.map((part) => encodeURIComponent(part)).join("/");
  return `${AGENTIC_APP_RUNTIME_GATEWAY_BASE}/${encodedAppId}${encodedPath ? `/${encodedPath}` : ""}`;
}

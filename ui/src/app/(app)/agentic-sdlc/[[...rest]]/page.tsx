// assisted-by Codex Codex-sonnet-4-6

import { permanentRedirect } from "next/navigation";

interface RouteParams {
  params: Promise<{ rest?: string[] }>;
}

/**
 * Legacy URL compatibility shim.
 *
 * Agentic SDLC moved to `/apps/agentic-sdlc/...` so it goes through the
 * Agentic Apps contract (registry + RBAC + install/enabled gates). Any
 * existing bookmarks, GitHub PR links, or stale `<Link>` references hit
 * this catch-all and are 308'd to the canonical path. The route segment
 * `[[...rest]]` is optional, so `/agentic-sdlc` itself also redirects.
 */
export default async function LegacyAgenticSdlcRedirect({ params }: RouteParams) {
  const { rest } = await params;
  const tail = Array.isArray(rest) && rest.length > 0 ? `/${rest.join("/")}` : "";
  permanentRedirect(`/apps/agentic-sdlc${tail}`);
}

/**
 * GET / PUT /api/agentic-sdlc/me/panel-prefs?surface=repo_detail|home
 *
 * Per-user, per-surface UI preferences for the Agentic SDLC. Each
 * surface (repo_detail, home) has an independent preference profile
 * so the user can configure them separately.
 *
 * GET   → returns the user's preferences for the surface, or the
 *         defaults from the registry if nothing is stored.
 * PUT   → upserts the preferences for the surface and returns the
 *         normalised, stored value.
 *
 * Both routes are auth-gated by `requireAgenticSdlcReader`, which
 * already supports the SHIP_LOOP_ALLOW_NO_AUTH dev escape hatch.
 *
 * Server-only.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import {
  defaultPreferences,
  normalisePreferences,
  type PanelPreferences,
} from "@/lib/agentic-sdlc/panel-preferences";
import type { PanelSurface } from "@/lib/agentic-sdlc/panel-registry";
import { requireAgenticSdlcReader } from "@/lib/agentic-sdlc/agentic-sdlc-auth";
import { withAgenticSdlcGate } from "@/lib/agentic-sdlc/guard";
import {
  readPanelPreferences,
  writePanelPreferences,
} from "@/lib/agentic-sdlc/user-prefs-store";

function parseSurface(req: Request): PanelSurface | null {
  const url = new URL(req.url);
  const v = url.searchParams.get("surface");
  if (v === "repo_detail" || v === "home") return v;
  return null;
}

async function handleGet(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }
  const surface = parseSurface(req);
  if (!surface) {
    return Response.json(
      { error: "bad_request", message: "Missing or invalid surface." },
      { status: 400 },
    );
  }
  try {
    const prefs = await readPanelPreferences(reader.user.email, surface);
    return Response.json({ preferences: prefs });
  } catch {
    // Mongo not reachable in dev — fall back to defaults rather than
    // turning the panel into a 500 page.
    return Response.json({ preferences: defaultPreferences(surface) });
  }
}

async function handlePut(req: Request): Promise<Response> {
  const reader = await requireAgenticSdlcReader(req);
  if (!reader) {
    return Response.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 },
    );
  }
  const surface = parseSurface(req);
  if (!surface) {
    return Response.json(
      { error: "bad_request", message: "Missing or invalid surface." },
      { status: 400 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "bad_request", message: "Body must be JSON." },
      { status: 400 },
    );
  }
  const incoming = (body as { preferences?: unknown })?.preferences;
  const normalised: PanelPreferences = normalisePreferences(incoming, surface);
  try {
    const stored = await writePanelPreferences(
      reader.user.email,
      surface,
      normalised,
    );
    return Response.json({ preferences: stored });
  } catch {
    // Persistence failure is non-fatal at the API surface — the client
    // keeps its localStorage copy and will retry on next change.
    return Response.json(
      { preferences: normalised, persisted: false },
      { status: 202 },
    );
  }
}

export const GET = withAgenticSdlcGate(handleGet);
export const PUT = withAgenticSdlcGate(handlePut);

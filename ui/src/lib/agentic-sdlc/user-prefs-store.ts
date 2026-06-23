/**
 * Mongo-backed storage for per-user Agentic SDLC UI preferences.
 *
 * Schema (collection `agentic_sdlc_user_prefs`):
 *   {
 *     _id?: ObjectId,
 *     user_email: string,              // primary key
 *     panel_prefs: {
 *       repo_detail?: PanelPreferences,
 *       home?: PanelPreferences,
 *     },
 *     updated_at: Date,
 *   }
 *
 * Server-only. Never import from a client component.
 *
 * assisted-by Codex Codex-sonnet-4-6
 */

import type { Collection, Document } from "mongodb";

import { getCollection } from "@/lib/mongodb";
import {
  defaultPreferences,
  normalisePreferences,
  type PanelPreferences,
} from "@/lib/agentic-sdlc/panel-preferences";
import type { PanelSurface } from "@/lib/agentic-sdlc/panel-registry";

export const AGENTIC_SDLC_USER_PREFS_COLLECTION = "agentic_sdlc_user_prefs";

interface UserPrefsDocument extends Document {
  user_email: string;
  panel_prefs: Partial<Record<PanelSurface, PanelPreferences>>;
  updated_at: Date;
}

async function getUserPrefsCollection(): Promise<Collection<UserPrefsDocument>> {
  return getCollection<UserPrefsDocument>(AGENTIC_SDLC_USER_PREFS_COLLECTION);
}

export async function readPanelPreferences(
  userEmail: string,
  surface: PanelSurface,
): Promise<PanelPreferences> {
  const col = await getUserPrefsCollection();
  const doc = await col.findOne(
    { user_email: userEmail },
    { projection: { _id: 0, panel_prefs: 1 } },
  );
  const raw = doc?.panel_prefs?.[surface];
  if (!raw) return defaultPreferences(surface);
  return normalisePreferences(raw, surface);
}

export async function writePanelPreferences(
  userEmail: string,
  surface: PanelSurface,
  preferences: PanelPreferences,
): Promise<PanelPreferences> {
  const col = await getUserPrefsCollection();
  const normalised = normalisePreferences(preferences, surface);
  await col.updateOne(
    { user_email: userEmail },
    {
      $set: {
        [`panel_prefs.${surface}`]: normalised,
        updated_at: new Date(),
      },
      $setOnInsert: { user_email: userEmail },
    },
    { upsert: true },
  );
  return normalised;
}

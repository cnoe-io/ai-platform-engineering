/**
 * Typed wrappers around getCollection() for the Agentic SDLC's three
 * collections. Server-only; do not import from a client component.
 */

import type { Collection } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  AGENTIC_SDLC_COLLECTIONS,
  type OnboardedRepo,
  type AgenticSdlcEvent,
  type AgenticSdlcArtifact,
} from "@/types/agentic-sdlc";

export async function getAgenticSdlcReposCollection(): Promise<
  Collection<OnboardedRepo>
> {
  return getCollection<OnboardedRepo>(AGENTIC_SDLC_COLLECTIONS.REPOS);
}

export async function getAgenticSdlcEventsCollection(): Promise<
  Collection<AgenticSdlcEvent>
> {
  return getCollection<AgenticSdlcEvent>(AGENTIC_SDLC_COLLECTIONS.EVENTS);
}

export async function getAgenticSdlcArtifactsCollection(): Promise<
  Collection<AgenticSdlcArtifact>
> {
  return getCollection<AgenticSdlcArtifact>(AGENTIC_SDLC_COLLECTIONS.ARTIFACTS);
}

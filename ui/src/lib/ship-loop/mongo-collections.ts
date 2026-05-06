/**
 * Typed wrappers around getCollection() for the Ship Loop's three
 * collections. Server-only; do not import from a client component.
 */

import type { Collection } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  SHIP_LOOP_COLLECTIONS,
  type OnboardedRepo,
  type ShipLoopEvent,
  type ShipLoopArtifact,
} from "@/types/ship-loop";

export async function getShipLoopReposCollection(): Promise<
  Collection<OnboardedRepo>
> {
  return getCollection<OnboardedRepo>(SHIP_LOOP_COLLECTIONS.REPOS);
}

export async function getShipLoopEventsCollection(): Promise<
  Collection<ShipLoopEvent>
> {
  return getCollection<ShipLoopEvent>(SHIP_LOOP_COLLECTIONS.EVENTS);
}

export async function getShipLoopArtifactsCollection(): Promise<
  Collection<ShipLoopArtifact>
> {
  return getCollection<ShipLoopArtifact>(SHIP_LOOP_COLLECTIONS.ARTIFACTS);
}

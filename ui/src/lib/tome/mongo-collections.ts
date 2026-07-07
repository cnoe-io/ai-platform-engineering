/**
 * Typed wrappers around getCollection() for Tome's index/metadata collections.
 * Server-only; do not import from a client component.
 *
 * NB: there is no projects collection here — Tome reuses CAIPE's existing
 * `projects` collection (see @/types/projects). These collections hold only
 * wiki-specific data, all keyed by `project_id`.
 */

import type { Collection } from "mongodb";
import { getCollection } from "@/lib/mongodb";
import {
  TOME_COLLECTIONS,
  type PageRevision,
  type Report,
  type IngestRun,
  type ChatSession,
  type ChatMessage,
  type EdgeIndexRow,
} from "@/types/tome";

export async function getTomePageRevisionsCollection(): Promise<
  Collection<PageRevision>
> {
  return getCollection<PageRevision>(TOME_COLLECTIONS.PAGE_REVISIONS);
}

export async function getTomeReportsCollection(): Promise<Collection<Report>> {
  return getCollection<Report>(TOME_COLLECTIONS.REPORTS);
}

export async function getTomeIngestRunsCollection(): Promise<
  Collection<IngestRun>
> {
  return getCollection<IngestRun>(TOME_COLLECTIONS.INGEST_RUNS);
}

export async function getTomeChatSessionsCollection(): Promise<
  Collection<ChatSession>
> {
  return getCollection<ChatSession>(TOME_COLLECTIONS.CHAT_SESSIONS);
}

export async function getTomeChatMessagesCollection(): Promise<
  Collection<ChatMessage>
> {
  return getCollection<ChatMessage>(TOME_COLLECTIONS.CHAT_MESSAGES);
}

export async function getTomeEdgesIndexCollection(): Promise<
  Collection<EdgeIndexRow>
> {
  return getCollection<EdgeIndexRow>(TOME_COLLECTIONS.EDGES_INDEX);
}

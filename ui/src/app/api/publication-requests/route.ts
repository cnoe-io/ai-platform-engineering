import { NextRequest } from "next/server";

import {
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  listPublicationRequestsForActor,
  publicationActorFromSession,
} from "@/lib/publication-approval.server";
import type {
  PublicationRequestStatus,
  PublicationResourceKind,
} from "@/types/publication-approval";

const STATUSES = new Set<PublicationRequestStatus>([
  "pending",
  "applying",
  "approved",
  "rejected",
  "cancelled",
  "superseded",
]);
const KINDS = new Set<PublicationResourceKind>([
  "rag_datasource",
  "rag_collection",
  "slack_channel",
  "webex_space",
]);

function commaList<T extends string>(
  value: string | null,
  allowed: Set<T>,
): T[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is T => allowed.has(item as T));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const actor = publicationActorFromSession(session);
  const params = request.nextUrl.searchParams;
  const limit = Number.parseInt(params.get("limit") ?? "100", 10);
  const requests = await listPublicationRequestsForActor(actor, {
    statuses: commaList(params.get("status"), STATUSES),
    kinds: commaList(params.get("kind"), KINDS),
    resourceIds: params.getAll("resource_id").map((id) => id.trim()).filter(Boolean),
    mine: params.get("mine") === "true",
    limit: Number.isFinite(limit) ? limit : 100,
  });
  return successResponse({ requests });
});

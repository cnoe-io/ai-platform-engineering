import type { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { isMongoDBConfigured } from "@/lib/mongodb";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import { isTomeServerEnabled } from "@/lib/tome/guard";
import {
  discoverMeetingSeries,
  interactiveWebexMeetingInvoker,
  meetingSeriesHostEligibility,
  webexMeetingSeriesDiscoveryWindow,
} from "@/lib/tome/webex-meeting-series";

export const dynamic = "force-dynamic";

/** Discover recurring meetings before a project exists during onboarding. */
export const GET = withErrorHandler(async (request: NextRequest) => {
  if (!isTomeServerEnabled()) {
    throw new ApiError("Not found", 404, "NOT_FOUND");
  }
  if (!isMongoDBConfigured) {
    throw new ApiError("MongoDB not configured", 503, "MONGODB_NOT_CONFIGURED");
  }
  const { user, session } = await getAuthFromBearerOrSession(request);
  requireInteractiveTomePrincipal(session);
  const invoke = await interactiveWebexMeetingInvoker(request, { user, session });
  const candidates = (await discoverMeetingSeries(invoke, webexMeetingSeriesDiscoveryWindow())).map(
    (candidate) => ({
      ...candidate,
      ...meetingSeriesHostEligibility(candidate, user.email),
    }),
  );
  return successResponse({ candidates });
});

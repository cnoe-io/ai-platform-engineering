import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { markInAppNotificationRead } from "@/lib/in-app-notifications.server";

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const { session } = await getAuthFromBearerOrSession(request);
  const subject = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!subject) throw new ApiError("Your session has expired. Please sign in again.", 401);
  const { id } = await context.params;
  const updated = await markInAppNotificationRead(subject, id);
  if (!updated) throw new ApiError("Notification not found", 404);
  return successResponse({ read: true });
});

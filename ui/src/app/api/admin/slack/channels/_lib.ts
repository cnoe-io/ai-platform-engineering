import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession, requireRbacPermission } from "@/lib/api-middleware";

export async function withSlackChannelRebacViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler();
}

export async function withSlackChannelRebacManageAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  return handler();
}

import { NextRequest } from "next/server";

import { getAuthFromBearerOrSession } from "@/lib/api-middleware";
import { requireAdminSurfaceManage } from "@/lib/rbac/require-openfga";
import { requireResourcePermission } from "@/lib/rbac/resource-authz";
import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

interface WebexSpaceTarget {
  workspaceId: string;
  spaceId: string;
}

export async function withWebexSpaceRebacViewAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>,
  target?: WebexSpaceTarget
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  if (target) {
    await requireResourcePermission(session, {
      type: "webex_space",
      id: webexSpaceSubjectId(target.workspaceId, target.spaceId),
      action: "read",
    }, { allowAdminBypass: true });
  } else {
    await requireAdminSurfaceManage(session, "webex");
  }
  return handler();
}

export async function withWebexSpaceRebacManageAuth<T>(
  request: NextRequest,
  handler: () => Promise<T>,
  target?: WebexSpaceTarget
): Promise<T> {
  const { session } = await getAuthFromBearerOrSession(request);
  if (target) {
    await requireResourcePermission(session, {
      type: "webex_space",
      id: webexSpaceSubjectId(target.workspaceId, target.spaceId),
      action: "manage",
    }, { allowAdminBypass: true });
  } else {
    await requireAdminSurfaceManage(session, "webex");
  }
  return handler();
}

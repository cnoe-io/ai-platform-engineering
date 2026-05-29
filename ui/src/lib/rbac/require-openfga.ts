import { ApiError } from "@/lib/api-error";
import { isDevAnonymousAuthEnabled } from "@/lib/auth/dev-auth-provider";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import {
  adminSurfaceObject,
  userProfileObject,
  type AdminSurface,
  type BaselineAdminSurface,
} from "@/lib/rbac/baseline-access";

export interface OpenFgaSessionSubject {
  sub?: string;
}

async function requireDerivedTuple(
  session: OpenFgaSessionSubject,
  relation: string,
  object: string,
  capability: string
): Promise<void> {
  if (isDevAnonymousAuthEnabled()) {
    return;
  }

  const subject = session.sub?.trim();
  if (!subject) {
    throw new ApiError("Your session has expired. Please sign in again.", 401, "NO_TOKEN", "session_expired", "sign_in");
  }

  try {
    const result = await checkOpenFgaTuple({
      user: `user:${subject}`,
      relation,
      object,
    });
    if (result.allowed) return;
  } catch {
    throw new ApiError(
      "Authorization service is temporarily unavailable. Please try again in a moment.",
      503,
      "PDP_UNAVAILABLE",
      "pdp_unavailable",
      "retry"
    );
  }

  throw new ApiError(
    "You do not have permission to view this read-only dashboard surface.",
    403,
    capability,
    "pdp_denied",
    "contact_admin"
  );
}

export function requireBaselineAdminSurfaceRead(
  session: OpenFgaSessionSubject,
  surface: BaselineAdminSurface
): Promise<void> {
  return requireDerivedTuple(
    session,
    "can_read",
    adminSurfaceObject(surface),
    `admin_surface:${surface}#can_read`
  );
}

export function requireAdminSurfaceManage(
  session: OpenFgaSessionSubject,
  surface: AdminSurface
): Promise<void> {
  return requireDerivedTuple(
    session,
    "can_manage",
    adminSurfaceObject(surface),
    `admin_surface:${surface}#can_manage`
  );
}

export function requireUserProfileRead(session: OpenFgaSessionSubject, subject: string): Promise<void> {
  return requireDerivedTuple(
    session,
    "can_read",
    userProfileObject(subject),
    `user_profile:${subject}#can_read`
  );
}

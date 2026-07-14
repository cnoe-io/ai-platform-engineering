import { ApiError } from "@/lib/api-error";
import {
  adminSurfaceObject,
  type AdminSurface,
} from "@/lib/rbac/baseline-access";
import { parseAdminSimulation } from "@/lib/rbac/admin-simulator";
import { getRealmUserByIdOrNull } from "@/lib/rbac/keycloak-admin";
import { checkOpenFgaTuple } from "@/lib/rbac/openfga";
import {
  hasOrganizationAdmin,
  type PlatformAdminSession,
} from "@/lib/rbac/platform-admin";

export interface AuthorizedAdminSimulationScope {
  openfgaUser: string;
  ownerEmail: string;
}

/**
 * Resolve an optional read-only access-preview subject for a data endpoint.
 * Preview parameters are accepted only from an organization admin; the
 * returned identity is then used for all downstream visibility checks.
 */
export async function resolveAuthorizedAdminSimulationScope(
  searchParams: URLSearchParams,
  session: PlatformAdminSession,
): Promise<AuthorizedAdminSimulationScope | null> {
  const simulation = parseAdminSimulation(searchParams);
  if (!simulation.active || !simulation.subject) return null;

  if (!(await hasOrganizationAdmin(session))) {
    throw new ApiError("Simulation requires organization admin access", 403);
  }

  let ownerEmail = "";
  if (simulation.subject.type === "user") {
    try {
      const user = await getRealmUserByIdOrNull(simulation.subject.id);
      ownerEmail = typeof user?.email === "string" ? user.email.trim() : "";
    } catch (error) {
      console.warn("[AdminSimulation] Failed to resolve preview user identity", {
        userId: simulation.subject.id,
        error,
      });
    }
  }

  return {
    openfgaUser: simulation.subject.openfga_user,
    ownerEmail,
  };
}

/** Fail closed when checking whether the preview subject has full surface access. */
export async function simulationSubjectCanManageAdminSurface(
  scope: AuthorizedAdminSimulationScope,
  surface: AdminSurface,
): Promise<boolean> {
  try {
    const decision = await checkOpenFgaTuple({
      user: scope.openfgaUser,
      relation: "can_manage",
      object: adminSurfaceObject(surface),
    });
    return decision.allowed;
  } catch {
    return false;
  }
}

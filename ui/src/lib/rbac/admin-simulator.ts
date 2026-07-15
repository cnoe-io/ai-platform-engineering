import { ApiError } from "@/lib/api-middleware";

export type AdminSimulationSubjectType = "user" | "team";
export type AdminSimulationTeamRelation = "member" | "admin";

export interface AdminSimulationSubject {
  type: AdminSimulationSubjectType;
  id: string;
  relation?: AdminSimulationTeamRelation;
  openfga_user: string;
  /** Canonical Keycloak display values, populated by simulation API routes. */
  display_name?: string;
  email?: string;
  /** Whether this subject can administer the organization. */
  organization_admin?: boolean;
}

export interface AdminSimulationContext {
  active: boolean;
  readonly: true;
  subject?: AdminSimulationSubject;
}

function readParam(searchParams: URLSearchParams, key: string): string {
  return searchParams.get(key)?.trim() ?? "";
}

function assertSafeObjectId(id: string, field: string): string {
  if (!id) {
    throw new ApiError(`${field} is required for simulation`, 400);
  }
  if (id.length > 256 || /[\s#]/.test(id)) {
    throw new ApiError(`${field} contains unsupported characters`, 400);
  }
  return id;
}

export function parseAdminSimulation(searchParams: URLSearchParams): AdminSimulationContext {
  const type = readParam(searchParams, "simulate_type");
  const rawId = readParam(searchParams, "simulate_id");
  const rawRelation = readParam(searchParams, "simulate_relation");

  if (!type && !rawId && !rawRelation) {
    return { active: false, readonly: true };
  }

  if (type !== "user" && type !== "team") {
    throw new ApiError('simulate_type must be "user" or "team"', 400);
  }

  const id = assertSafeObjectId(rawId, "simulate_id");
  if (type === "user") {
    if (rawRelation) {
      throw new ApiError("simulate_relation is only supported for team simulation", 400);
    }
    return {
      active: true,
      readonly: true,
      subject: {
        type,
        id,
        openfga_user: `user:${id}`,
      },
    };
  }

  const relation = rawRelation || "member";
  if (relation !== "member" && relation !== "admin") {
    throw new ApiError('simulate_relation must be "member" or "admin"', 400);
  }

  return {
    active: true,
    readonly: true,
    subject: {
      type,
      id,
      relation,
      openfga_user: `team:${id}#${relation}`,
    },
  };
}

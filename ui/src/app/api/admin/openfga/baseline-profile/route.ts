import { NextRequest } from "next/server";
import { ApiError, successResponse, withErrorHandler } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import {
  baselineBootstrapTuples,
  baselineGrantCatalog,
  baselineTupleKey,
  getBaselineFgaProfile,
  normalizeBaselineFgaProfile,
  saveBaselineFgaProfile,
  type BaselineFgaProfile,
} from "@/lib/rbac/baseline-access";
import { writeOpenFgaTuples, type OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { withOpenFgaAdminAuth, withOpenFgaViewAuth } from "../_lib";

type ApplyMode = "none" | "user" | "all";

interface BaselineProfileRequest {
  member_grants?: unknown;
  admin_grants?: unknown;
  apply?: {
    mode?: unknown;
    userId?: unknown;
    role?: unknown;
  };
}

interface UserIdentityDoc {
  email?: string;
  role?: string;
  keycloak_sub?: string;
  metadata?: {
    keycloak_sub?: string;
    sso_id?: string;
    role?: string;
  };
  subject?: string;
  sub?: string;
}

function parseBody(body: unknown): {
  profile: BaselineFgaProfile;
  apply: { mode: ApplyMode; userId?: string; role: "member" | "admin" };
} {
  if (!body || typeof body !== "object") {
    throw new ApiError("JSON body is required", 400);
  }
  const value = body as BaselineProfileRequest;
  if (!Array.isArray(value.member_grants) || !Array.isArray(value.admin_grants)) {
    throw new ApiError("member_grants and admin_grants arrays are required", 400);
  }
  const profile = normalizeBaselineFgaProfile({
    member_grants: value.member_grants,
    admin_grants: value.admin_grants,
    source: "mongo",
  });
  const mode = typeof value.apply?.mode === "string" ? value.apply.mode : "none";
  if (!["none", "user", "all"].includes(mode)) {
    throw new ApiError("apply.mode must be none, user, or all", 400);
  }
  const userId = typeof value.apply?.userId === "string" ? value.apply.userId.trim() : undefined;
  const role = value.apply?.role === "admin" ? "admin" : "member";
  if (mode === "user" && !userId) {
    throw new ApiError("apply.userId is required when apply.mode is user", 400);
  }
  return { profile, apply: { mode: mode as ApplyMode, userId, role } };
}

function subjectForUser(user: UserIdentityDoc): string | null {
  return (
    user.keycloak_sub?.trim() ||
    user.metadata?.keycloak_sub?.trim() ||
    user.subject?.trim() ||
    user.sub?.trim() ||
    user.metadata?.sso_id?.trim() ||
    null
  );
}

function isAdminUser(user: UserIdentityDoc): boolean {
  return user.role === "admin" || user.metadata?.role === "admin";
}

function diffTuples(previous: OpenFgaTupleKey[], next: OpenFgaTupleKey[]): OpenFgaTupleKey[] {
  const nextKeys = new Set(next.map(baselineTupleKey));
  return previous.filter((tuple) => !nextKeys.has(baselineTupleKey(tuple)));
}

async function usersForApplyAll(): Promise<Array<{ subject: string; isAdmin: boolean }>> {
  const users = await getCollection<UserIdentityDoc>("users");
  const rows = await users.find({}).limit(500).toArray();
  const subjects = new Map<string, { subject: string; isAdmin: boolean }>();
  for (const row of rows) {
    const subject = subjectForUser(row);
    if (!subject) continue;
    subjects.set(subject, { subject, isAdmin: isAdminUser(row) });
  }
  return Array.from(subjects.values());
}

async function reconcileProfile(input: {
  previousProfile: BaselineFgaProfile;
  nextProfile: BaselineFgaProfile;
  apply: { mode: ApplyMode; userId?: string; role: "member" | "admin" };
}): Promise<{ mode: ApplyMode; user_count: number; writes: number; deletes: number }> {
  if (input.apply.mode === "none") {
    return { mode: "none", user_count: 0, writes: 0, deletes: 0 };
  }

  const targets =
    input.apply.mode === "user"
      ? [{ subject: input.apply.userId ?? "", isAdmin: input.apply.role === "admin" }]
      : await usersForApplyAll();

  const writes: OpenFgaTupleKey[] = [];
  const deletes: OpenFgaTupleKey[] = [];
  for (const target of targets) {
    if (!target.subject) continue;
    const previousTuples = baselineBootstrapTuples(target.subject, target.isAdmin, input.previousProfile);
    const nextTuples = baselineBootstrapTuples(target.subject, target.isAdmin, input.nextProfile);
    writes.push(...nextTuples);
    deletes.push(...diffTuples(previousTuples, nextTuples));
  }

  if (writes.length === 0 && deletes.length === 0) {
    return { mode: input.apply.mode, user_count: targets.length, writes: 0, deletes: 0 };
  }

  const result = await writeOpenFgaTuples({ writes, deletes });
  return {
    mode: input.apply.mode,
    user_count: targets.length,
    writes: result.writes,
    deletes: result.deletes,
  };
}

export const GET = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaViewAuth(request, async () => {
    const profile = await getBaselineFgaProfile();
    return successResponse({
      profile,
      available_grants: baselineGrantCatalog(),
    });
  }),
);

export const PUT = withErrorHandler(async (request: NextRequest) =>
  withOpenFgaAdminAuth(request, async ({ user, session }) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Invalid JSON body", 400);
    }

    const previousProfile = await getBaselineFgaProfile();
    const parsed = parseBody(body);
    const nextProfile = await saveBaselineFgaProfile({
      member_grants: parsed.profile.member_grants,
      admin_grants: parsed.profile.admin_grants,
      updated_by: user.email,
    });
    const reconciliation = await reconcileProfile({
      previousProfile,
      nextProfile,
      apply: parsed.apply,
    });

    logOpenFgaRebacAuditEvent({
      tenantId: session?.org ?? "default",
      sub: session?.sub ?? user.email,
      operation: "update_baseline_profile",
      scope: "admin",
      resourceRef: `openfga_baseline_profile:${JSON.stringify({
        member_grants: nextProfile.member_grants.length,
        admin_grants: nextProfile.admin_grants.length,
        apply_mode: reconciliation.mode,
        user_count: reconciliation.user_count,
      })}`,
      email: user.email,
    });

    return successResponse({
      profile: nextProfile,
      available_grants: baselineGrantCatalog(),
      reconciliation,
    });
  }),
);

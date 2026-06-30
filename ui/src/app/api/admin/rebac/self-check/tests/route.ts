// assisted-by Codex Codex-sonnet-4-6

import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  requireRbacPermission,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import {
  RBAC_SELF_CHECK_TEST_SUITES,
  runRbacSelfCheckTests,
  type RbacSelfCheckTestRunOptions,
} from "@/lib/rbac/self-check-tests";
import type { Subject } from "@/lib/authz";
import type {
  RbacSelfCheckAssertionInput,
  RbacSelfCheckTestActorKey,
} from "@/types/rbac-self-check";

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .flatMap((entry) => entry.split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return undefined;
}

function callerSubjectFromSession(session: unknown): Subject | undefined {
  if (!session || typeof session !== "object") return undefined;
  const sub = (session as { sub?: unknown }).sub;
  if (typeof sub === "string" && sub.trim()) {
    return { type: "user", id: sub.trim() };
  }
  return undefined;
}

function parseActors(value: unknown): RbacSelfCheckTestRunOptions["actors"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: RbacSelfCheckTestRunOptions["actors"] = {};
  for (const key of ["org_admin", "member_user", "service_account", "unlinked_service_account"] satisfies RbacSelfCheckTestActorKey[]) {
    const actor = (value as Record<string, unknown>)[key];
    if (!actor) continue;
    if (typeof actor === "string") {
      out[key] = actor;
      continue;
    }
    if (typeof actor === "object" && !Array.isArray(actor)) {
      out[key] = actor;
    }
  }
  return out;
}

function parseAssertions(value: unknown): RbacSelfCheckAssertionInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ApiError("assertions must be an array.", 400);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError(`assertions[${index}] must be an object.`, 400);
    }
    const assertion = entry as Record<string, unknown>;
    const actor = assertion.actor;
    const resource = assertion.resource;
    if (!actor || typeof actor !== "object" || Array.isArray(actor)) {
      throw new ApiError(`assertions[${index}].actor is required.`, 400);
    }
    if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
      throw new ApiError(`assertions[${index}].resource is required.`, 400);
    }
    const actorRecord = actor as Record<string, unknown>;
    const resourceRecord = resource as Record<string, unknown>;
    const actorType = actorRecord.type;
    const actorId = actorRecord.id;
    const resourceType = resourceRecord.type;
    const resourceId = resourceRecord.id;
    const action = assertion.action;
    const expect = assertion.expect;
    if (actorType !== "user" && actorType !== "service_account") {
      throw new ApiError(`assertions[${index}].actor.type must be user or service_account.`, 400);
    }
    if (typeof actorId !== "string" || !actorId.trim()) {
      throw new ApiError(`assertions[${index}].actor.id is required.`, 400);
    }
    if (typeof resourceType !== "string" || !resourceType.trim()) {
      throw new ApiError(`assertions[${index}].resource.type is required.`, 400);
    }
    if (typeof resourceId !== "string" || !resourceId.trim()) {
      throw new ApiError(`assertions[${index}].resource.id is required.`, 400);
    }
    if (typeof action !== "string" || !action.trim()) {
      throw new ApiError(`assertions[${index}].action is required.`, 400);
    }
    if (expect !== "ALLOW" && expect !== "DENY") {
      throw new ApiError(`assertions[${index}].expect must be ALLOW or DENY.`, 400);
    }
    return {
      id: typeof assertion.id === "string" ? assertion.id : undefined,
      title: typeof assertion.title === "string" ? assertion.title : undefined,
      actor: {
        type: actorType,
        id: actorId.trim(),
        label: typeof actorRecord.label === "string" ? actorRecord.label : undefined,
      },
      resource: {
        type: resourceType.trim(),
        id: resourceId.trim(),
        label: typeof resourceRecord.label === "string" ? resourceRecord.label : undefined,
      },
      action: action.trim(),
      expect,
    };
  });
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "view");
  return successResponse({
    suites: RBAC_SELF_CHECK_TEST_SUITES,
    default_suites: RBAC_SELF_CHECK_TEST_SUITES
      .filter((suite) => suite.default_enabled)
      .map((suite) => suite.id),
    actors: ["org_admin", "member_user", "service_account", "unlinked_service_account"],
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const { session } = await getAuthFromBearerOrSession(request);
  await requireRbacPermission(session, "admin_ui", "admin");
  const body = (await request.json().catch(() => ({}))) as {
    suites?: unknown;
    actors?: unknown;
    assertions?: unknown;
  };

  const report = await runRbacSelfCheckTests({
    suites: parseStringArray(body.suites),
    actors: parseActors(body.actors),
    assertions: parseAssertions(body.assertions),
    callerSubject: callerSubjectFromSession(session),
  });
  return successResponse(report);
});

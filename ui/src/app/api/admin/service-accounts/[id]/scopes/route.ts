import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-config";
import {
  checkOpenFgaTuple,
  deleteExactOpenFgaTuples,
  listOpenFgaObjects,
  writeOpenFgaTuples,
} from "@/lib/rbac/openfga";
import { logOpenFgaRebacAuditEvent } from "@/lib/rbac/audit";
import { getBySub, updateScopesSnapshot } from "@/lib/service-accounts";
import {
  parseScope,
  scopeCheckTuple,
  scopeWriteTuple,
  type ScopeRef,
} from "@/lib/service-account-scopes";
import type { ServiceAccountScope } from "@/types/mongodb";

/**
 * Scope management for a service account (US3).
 *
 * `[id]` is the SA's OpenFGA subject id (`sa_sub`). Both verbs require the
 * caller to be able to MANAGE the SA (owning-team membership):
 *   check(user:<caller>, can_manage, service_account:<id>).
 *
 * POST  — add a scope (FR-015): the editor must ALSO hold the scope being
 *         granted (check(user:<editor>, <rel>, <object>) → 403 if unheld).
 * DELETE — remove a scope (FR-016): can_manage ONLY; the editor need NOT hold
 *         the scope.
 *
 * Neither verb touches the credential (FR-019) — only OpenFGA tuples + the
 * Mongo display snapshot change. Both audit (FR-026).
 */

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface ResolvedActor {
  callerSub: string;
  email?: string;
}

/** 401 helper. */
function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
}

/**
 * Common preamble: authenticate, parse the scope body, and enforce can_manage.
 * Returns either an early `response` (to return) or the validated context.
 */
async function authorizeScopeMutation(
  request: Request,
  id: string,
): Promise<
  | { response: NextResponse }
  | { actor: ResolvedActor; scope: ScopeRef }
> {
  const session = (await getServerSession(authOptions)) as {
    sub?: string;
    user?: { email?: string | null };
  } | null;
  if (!session?.user?.email || !session.sub) {
    return { response: unauthorized() };
  }

  if (!id) {
    return {
      response: NextResponse.json(
        { success: false, error: "Missing service account id" },
        { status: 400 },
      ),
    };
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      response: NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      ),
    };
  }
  const { scope, error } = parseScope(raw);
  if (!scope) {
    return {
      response: NextResponse.json({ success: false, error }, { status: 400 }),
    };
  }

  // can_manage gate (owning-team membership). 404 to non-members (don't reveal).
  const canManage = await checkOpenFgaTuple({
    user: `user:${session.sub}`,
    relation: "can_manage",
    object: `service_account:${id}`,
  });
  if (!canManage.allowed) {
    return {
      response: NextResponse.json(
        { success: false, error: "Service account not found" },
        { status: 404 },
      ),
    };
  }

  return { actor: { callerSub: session.sub, email: session.user.email ?? undefined }, scope };
}

/**
 * Read the SA's current scopes from OpenFGA (authoritative) and rebuild the
 * Mongo display snapshot after a mutation. `mutated` carries the just-changed
 * scope's added_by/added_at so the snapshot reflects who added it.
 */
async function refreshSnapshot(
  saSub: string,
  addedByForNew: { sub: string; at: Date },
): Promise<void> {
  const subject = `service_account:${saSub}`;
  const [agentObjects, toolObjects] = await Promise.all([
    listOpenFgaObjects({ user: subject, relation: "can_use", type: "agent" }),
    listOpenFgaObjects({ user: subject, relation: "can_call", type: "tool" }),
  ]);

  // Preserve prior added_by/added_at where we have them; default new entries to
  // the current editor/time.
  const prior = (await getBySub(saSub))?.scopes_snapshot ?? [];
  const priorByKey = new Map(prior.map((s) => [`${s.type}:${s.ref}`, s]));

  const build = (type: "agent" | "tool", objects: string[]): ServiceAccountScope[] =>
    objects.map((object) => {
      const ref = object.slice(object.indexOf(":") + 1);
      const existing = priorByKey.get(`${type}:${ref}`);
      return (
        existing ?? {
          type,
          ref,
          added_by: addedByForNew.sub,
          added_at: addedByForNew.at,
        }
      );
    });

  const snapshot = [
    ...build("agent", agentObjects.objects),
    ...build("tool", toolObjects.objects),
  ];
  await updateScopesSnapshot(saSub, snapshot);
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const pre = await authorizeScopeMutation(request, id);
  if ("response" in pre) return pre.response;
  const { actor, scope } = pre;

  try {
    // FR-015: the editor must hold the scope they're granting.
    const held = await checkOpenFgaTuple(scopeCheckTuple(scope, `user:${actor.callerSub}`));
    if (!held.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: "You cannot grant a scope you do not hold",
          data: { rejected_scope: scope },
        },
        { status: 403 },
      );
    }

    const saSubject = `service_account:${id}`;
    await writeOpenFgaTuples({ writes: [scopeWriteTuple(scope, saSubject)], deletes: [] });
    await refreshSnapshot(id, { sub: actor.callerSub, at: new Date() });

    logOpenFgaRebacAuditEvent({
      sub: actor.callerSub,
      operation: "service_account.scope_add",
      scope: "admin",
      resourceRef: `service_account:${id}`,
      email: actor.email,
      correlationId: `service_account.scope_add:${id}:${scope.type}:${scope.ref}`,
    });

    return NextResponse.json({ success: true, data: { added: scope } });
  } catch (error) {
    console.error("[service-accounts:scope_add] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add scope" },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const pre = await authorizeScopeMutation(request, id);
  if ("response" in pre) return pre.response;
  const { actor, scope } = pre;

  // FR-016: removal requires can_manage ONLY (already checked) — the editor
  // need NOT hold the scope. No scope-holding check here, by design.
  try {
    const saSubject = `service_account:${id}`;
    await deleteExactOpenFgaTuples([scopeWriteTuple(scope, saSubject)]);
    await refreshSnapshot(id, { sub: actor.callerSub, at: new Date() });

    logOpenFgaRebacAuditEvent({
      sub: actor.callerSub,
      operation: "service_account.scope_remove",
      scope: "admin",
      resourceRef: `service_account:${id}`,
      email: actor.email,
      correlationId: `service_account.scope_remove:${id}:${scope.type}:${scope.ref}`,
    });

    return NextResponse.json({ success: true, data: { removed: scope } });
  } catch (error) {
    console.error("[service-accounts:scope_remove] failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to remove scope" },
      { status: 503 },
    );
  }
}

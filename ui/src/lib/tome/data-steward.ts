import { ApiError } from "@/lib/api-middleware";
import {
  checkOpenFgaTuple,
  deleteExactOpenFgaTuples,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { isTomeAdmin, type TomeAdminSession } from "@/lib/rbac/tome-admin";
import { canReadTomeProject, tomeDataObject } from "@/lib/tome/access";
import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";
import {
  dataStewardOpenFgaSubject,
  resolveStoredDataSteward,
  validDataStewardSubjectId,
} from "@/lib/tome/steward-identity";
import type { DataStewardAssignment, ProjectDocument } from "@/types/projects";

const STEWARD_RELATION = "writer";
const WRITE_RELATION = "can_write";

export { tomeDataObject } from "@/lib/tome/access";
export {
  dataStewardOpenFgaSubject,
  resolveDataSteward,
  resolveStoredDataSteward,
} from "@/lib/tome/steward-identity";

export function dataStewardTuple(
  project: Pick<ProjectDocument, "_id" | "slug" | "type">,
  steward: DataStewardAssignment,
): OpenFgaTupleKey {
  return {
    user: dataStewardOpenFgaSubject(steward),
    relation: STEWARD_RELATION,
    object: tomeDataObject(project),
  };
}

export async function reconcileDataSteward(
  project: Pick<ProjectDocument, "_id" | "slug" | "type" | "data_steward">,
  next: DataStewardAssignment | null,
): Promise<void> {
  const previous = await resolveStoredDataSteward(project.data_steward).catch(() => null);
  const writes = next ? [dataStewardTuple(project, next)] : [];
  const deletes =
    previous && (!next || dataStewardOpenFgaSubject(previous) !== dataStewardOpenFgaSubject(next))
      ? [dataStewardTuple(project, previous)]
      : [];
  const result = await writeOpenFgaTuples({ writes, deletes: [] });
  if (!result.enabled) {
    throw new ApiError("OpenFGA is not configured", 503, "OPENFGA_NOT_CONFIGURED");
  }
  if (deletes.length > 0) {
    const existing = (
      await Promise.all(
        deletes.map(async (tuple) => {
          const result = await readOpenFgaTuples({ tuple, pageSize: 1 });
          return result.tuples.some(
            (stored) =>
              stored.key.user === tuple.user &&
              stored.key.relation === tuple.relation &&
              stored.key.object === tuple.object,
          )
            ? tuple
            : null;
        }),
      )
    ).filter((tuple): tuple is OpenFgaTupleKey => tuple !== null);
    if (existing.length > 0) {
      await deleteExactOpenFgaTuples(existing);
    }
  }
}

interface TomePermissionInput {
  project: ProjectDocument;
  user: { email?: string | null };
  session: unknown;
}

function adminSession(input: TomePermissionInput): TomeAdminSession {
  const session = (input.session ?? {}) as TomeAdminSession;
  return {
    ...session,
    user: { ...session.user, email: input.user.email ?? session.user?.email },
  };
}

export function tomeSessionSubject(session: unknown): string | null {
  const sub = (session as { sub?: unknown } | null)?.sub;
  return typeof sub === "string" && validDataStewardSubjectId(sub) ? sub : null;
}

/**
 * Checks `can_write` for `sub` on `project`, self-repairing the missing
 * steward/membership edge (via `repairTomeAuthorizationForProject`) once on a
 * denial before checking again. Does NOT catch OpenFGA errors — callers
 * decide how to fail (see `canWriteAs` vs. `getTomeProjectPermissions`).
 */
async function resolveCanEdit(
  sub: string,
  project: ProjectDocument,
  userEmail?: string | null,
): Promise<boolean> {
  const check = async () =>
    checkOpenFgaTuple({
      user: `user:${sub}`,
      relation: WRITE_RELATION,
      object: tomeDataObject(project),
    });
  if ((await check()).allowed) return true;
  // Load lazily to avoid a module cycle: the reconciler uses the neutral
  // steward identity helpers, while this permission path calls it only on a
  // denied decision. It restores the document writer edge and, for a team
  // steward, this caller's membership edge only when an active canonical
  // membership-source row proves that relationship.
  const { repairTomeAuthorizationForProject } = await import("@/lib/tome/authorization-health");
  await repairTomeAuthorizationForProject({
    project,
    userSubject: sub,
    userEmail,
  });
  return (await check()).allowed;
}

/**
 * Returns true when `sub` is allowed to write pages for `project` — either
 * because they are a Tome admin (admin shortcut, no per-project tuple needed)
 * or because they hold `can_write` in OpenFGA. Fails-closed on errors.
 */
export async function canWriteAs(
  sub: string,
  project: ProjectDocument,
  userEmail?: string | null,
): Promise<boolean> {
  if (await isTomeAdmin({ sub })) return true;
  try {
    return await resolveCanEdit(sub, project, userEmail);
  } catch {
    return false;
  }
}

/**
 * Resolve the one permission used by every Tome data mutation. The OpenFGA
 * decision is authoritative; stored steward and canonical membership metadata
 * are used only to repair missing implied tuples before checking once more.
 * An OpenFGA outage fails every permission closed, even ones already
 * resolved (e.g. `canRead`), since the decision can no longer be trusted.
 */
export async function getTomeProjectPermissions(
  input: TomePermissionInput,
): Promise<{ canRead: boolean; canEdit: boolean; canManageSteward: boolean }> {
  requireInteractiveTomePrincipal(input.session);
  const canManageSteward = await isTomeAdmin(adminSession(input));
  if (canManageSteward) {
    return { canRead: true, canEdit: true, canManageSteward: true };
  }

  const sub = tomeSessionSubject(input.session);
  if (!sub) {
    return { canRead: false, canEdit: false, canManageSteward: false };
  }

  try {
    const canRead = await canReadTomeProject(sub, input.project);
    const canEdit = await resolveCanEdit(sub, input.project, input.user.email);
    return { canRead: canRead || canEdit, canEdit, canManageSteward: false };
  } catch {
    return { canRead: false, canEdit: false, canManageSteward: false };
  }
}

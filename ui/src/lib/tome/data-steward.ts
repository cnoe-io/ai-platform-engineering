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
 * Returns true when `sub` is allowed to write pages for `project` — either
 * because they are a Tome admin (admin shortcut, no per-project tuple needed)
 * or because they hold `can_write` in OpenFGA. Fails-closed on errors.
 */
export async function canWriteAs(
  sub: string,
  project: Pick<ProjectDocument, "_id" | "slug" | "type" | "data_steward">,
): Promise<boolean> {
  if (await isTomeAdmin({ sub })) return true;
  try {
    const result = await checkOpenFgaTuple({
      user: `user:${sub}`,
      relation: WRITE_RELATION,
      object: tomeDataObject(project),
    });
    if (result.allowed) return true;
    // Attempt self-repair: re-write the steward tuple if it exists in the DB
    // but is missing from FGA, then check once more.
    const steward = await resolveStoredDataSteward(project.data_steward).catch(() => null);
    if (!steward) return false;
    const repaired = await writeOpenFgaTuples({
      writes: [dataStewardTuple(project, steward)],
      deletes: [],
    });
    if (!repaired.enabled) return false;
    return (
      await checkOpenFgaTuple({
        user: `user:${sub}`,
        relation: WRITE_RELATION,
        object: tomeDataObject(project),
      })
    ).allowed;
  } catch {
    return false;
  }
}

/**
 * Resolve the one permission used by every Tome data mutation. The OpenFGA
 * decision is authoritative; stored steward metadata is used only to repair a
 * missing tuple before checking once more.
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
    const canEdit = await canWriteAs(sub, input.project);
    return { canRead: canRead || canEdit, canEdit, canManageSteward: false };
  } catch {
    return { canRead: false, canEdit: false, canManageSteward: false };
  }
}

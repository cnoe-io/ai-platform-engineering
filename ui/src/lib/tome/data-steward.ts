import { ObjectId } from "mongodb";

import { ApiError } from "@/lib/api-middleware";
import { getCollection } from "@/lib/mongodb";
import {
  checkOpenFgaTuple,
  deleteExactOpenFgaTuples,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import { isTomeAdmin, type TomeAdminSession } from "@/lib/rbac/tome-admin";
import { canReadTomeProject, tomeDataObject } from "@/lib/tome/access";
import type { User } from "@/types/mongodb";
import type {
  DataStewardAssignment,
  DataStewardInput,
  ProjectDocument,
  StoredDataSteward,
} from "@/types/projects";
import type { Team } from "@/types/teams";

const STEWARD_RELATION = "writer";
const WRITE_RELATION = "can_write";

export { tomeDataObject } from "@/lib/tome/access";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function userSubject(user: Pick<User, "keycloak_sub" | "metadata">): string | null {
  return user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || null;
}

function validSubjectId(value: string): boolean {
  return Boolean(value) && value.length <= 256 && !/[\s:#]/.test(value);
}

export function dataStewardOpenFgaSubject(steward: DataStewardAssignment): string {
  return steward.type === "team" ? `team:${steward.id}#member` : `user:${steward.id}`;
}

export function dataStewardTuple(
  project: Pick<ProjectDocument, "slug" | "type">,
  steward: DataStewardAssignment,
): OpenFgaTupleKey {
  return {
    user: dataStewardOpenFgaSubject(steward),
    relation: STEWARD_RELATION,
    object: tomeDataObject(project),
  };
}

async function resolveUserSteward(email: string): Promise<DataStewardAssignment> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 320 || !normalizedEmail.includes("@")) {
    throw new ApiError("Select a valid data-steward user", 400, "INVALID_DATA_STEWARD");
  }
  const users = await getCollection<User>("users");
  const user = await users.findOne({
    email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
  });
  const subject = user ? userSubject(user) : null;
  if (!user || !subject || !validSubjectId(subject)) {
    throw new ApiError(
      "The data steward must sign in to CAIPE before they can be assigned",
      400,
      "DATA_STEWARD_PROFILE_REQUIRED",
    );
  }
  return {
    type: "user",
    id: subject,
    name: user.name || user.email,
    email: user.email.toLowerCase(),
  };
}

async function resolveTeamSteward(teamId: string): Promise<DataStewardAssignment> {
  const normalized = teamId.trim();
  if (!normalized) {
    throw new ApiError("Select a data-steward team", 400, "INVALID_DATA_STEWARD");
  }
  const teams = await getCollection<Team>("teams");
  let team: Team | null = null;
  if (ObjectId.isValid(normalized)) {
    team = await teams.findOne({ _id: new ObjectId(normalized) as unknown as string });
  }
  if (!team) team = await teams.findOne({ slug: normalized });
  if (!team) {
    throw new ApiError("Data-steward team not found", 404, "DATA_STEWARD_TEAM_NOT_FOUND");
  }
  const slug = team.slug?.trim() || String(team._id);
  if (!validSubjectId(slug)) {
    throw new ApiError("Data-steward team has an invalid identity", 400, "INVALID_DATA_STEWARD");
  }
  return { type: "team", id: slug, name: team.name || slug };
}

export async function resolveDataSteward(
  input: DataStewardInput | StoredDataSteward | null | undefined,
): Promise<DataStewardAssignment | null> {
  if (!input) return null;
  if (typeof input === "string") return resolveUserSteward(input);
  if (input.type === "user") {
    if (
      "id" in input &&
      typeof input.id === "string" &&
      validSubjectId(input.id) &&
      typeof input.name === "string"
    ) {
      return {
        type: "user",
        id: input.id,
        name: input.name,
        ...("email" in input && typeof input.email === "string"
          ? { email: input.email.toLowerCase() }
          : {}),
      };
    }
    if ("email" in input && typeof input.email === "string") {
      return resolveUserSteward(input.email);
    }
  }
  if (input.type === "team") {
    if (
      "id" in input &&
      typeof input.id === "string" &&
      validSubjectId(input.id) &&
      typeof input.name === "string"
    ) {
      return { type: "team", id: input.id, name: input.name };
    }
    if ("team_id" in input && typeof input.team_id === "string") {
      return resolveTeamSteward(input.team_id);
    }
  }
  throw new ApiError("Invalid data-steward assignment", 400, "INVALID_DATA_STEWARD");
}

export async function reconcileDataSteward(
  project: Pick<ProjectDocument, "slug" | "type" | "data_steward">,
  next: DataStewardAssignment | null,
): Promise<void> {
  const previous = await resolveDataSteward(project.data_steward).catch(() => null);
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
  return typeof sub === "string" && validSubjectId(sub) ? sub : null;
}

/**
 * Resolve the one permission used by every Tome data mutation. The OpenFGA
 * decision is authoritative; stored steward metadata is used only to repair a
 * missing tuple before checking once more.
 */
export async function getTomeProjectPermissions(
  input: TomePermissionInput,
): Promise<{ canRead: boolean; canEdit: boolean; canManageSteward: boolean }> {
  const canManageSteward = await isTomeAdmin(adminSession(input));
  if (canManageSteward) {
    return { canRead: true, canEdit: true, canManageSteward: true };
  }

  const sub = tomeSessionSubject(input.session);
  if (!sub) {
    return { canRead: false, canEdit: false, canManageSteward: false };
  }
  const check = async () =>
    checkOpenFgaTuple({
      user: `user:${sub}`,
      relation: WRITE_RELATION,
      object: tomeDataObject(input.project),
    });

  try {
    const canRead = await canReadTomeProject(sub, input.project);
    if ((await check()).allowed) {
      return { canRead: true, canEdit: true, canManageSteward: false };
    }
    const steward = await resolveDataSteward(input.project.data_steward).catch(() => null);
    if (!steward) {
      return { canRead, canEdit: false, canManageSteward: false };
    }
    const repaired = await writeOpenFgaTuples({
      writes: [dataStewardTuple(input.project, steward)],
      deletes: [],
    });
    if (!repaired.enabled) {
      return { canRead, canEdit: false, canManageSteward: false };
    }
    const canEdit = (await check()).allowed;
    return {
      canRead: canRead || canEdit,
      canEdit,
      canManageSteward: false,
    };
  } catch {
    return { canRead: false, canEdit: false, canManageSteward: false };
  }
}

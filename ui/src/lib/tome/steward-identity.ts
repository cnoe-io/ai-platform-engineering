import { ObjectId } from "mongodb";

import { ApiError } from "@/lib/api-error";
import { getCollection } from "@/lib/mongodb";
import type { User } from "@/types/mongodb";
import type {
  DataStewardAssignment,
  DataStewardInput,
  StoredDataSteward,
} from "@/types/projects";
import type { Team } from "@/types/teams";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function userSubject(user: Pick<User, "keycloak_sub" | "metadata">): string | null {
  return user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || null;
}

export function validDataStewardSubjectId(value: string): boolean {
  return Boolean(value) && value.length <= 256 && !/[\s:#]/.test(value);
}

export function dataStewardOpenFgaSubject(steward: DataStewardAssignment): string {
  return steward.type === "team" ? `team:${steward.id}#member` : `user:${steward.id}`;
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
  if (!user || !subject || !validDataStewardSubjectId(subject)) {
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

async function resolveStoredUserSteward(
  steward: DataStewardAssignment,
): Promise<DataStewardAssignment> {
  const id = steward.id?.trim();
  const email = steward.email?.trim().toLowerCase();
  if ((!id || !validDataStewardSubjectId(id)) && !email) {
    throw new ApiError("Invalid stored data-steward user", 400, "INVALID_DATA_STEWARD");
  }
  const users = await getCollection<User>("users");
  let user: User | null = null;
  if (id && validDataStewardSubjectId(id)) {
    user = await users.findOne({
      $or: [{ keycloak_sub: id }, { "metadata.keycloak_sub": id }],
    });
  }
  if (!user && email) {
    user = await users.findOne({
      email: { $regex: `^${escapeRegex(email)}$`, $options: "i" },
    });
  }
  const subject = user ? userSubject(user) : null;
  if (!user || !subject || !validDataStewardSubjectId(subject)) {
    throw new ApiError(
      "The stored data steward no longer has a CAIPE profile",
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
  if (!validDataStewardSubjectId(slug)) {
    throw new ApiError("Data-steward team has an invalid identity", 400, "INVALID_DATA_STEWARD");
  }
  return { type: "team", id: slug, name: team.name || slug };
}

export async function resolveDataSteward(
  input: DataStewardInput | null | undefined,
): Promise<DataStewardAssignment | null> {
  if (!input) return null;
  if (input.type === "user" && "email" in input && typeof input.email === "string") {
    return resolveUserSteward(input.email);
  }
  if (input.type === "team" && "team_id" in input && typeof input.team_id === "string") {
    return resolveTeamSteward(input.team_id);
  }
  throw new ApiError("Invalid data-steward assignment", 400, "INVALID_DATA_STEWARD");
}

/** Re-resolve persisted display metadata against trusted user/team records. */
export async function resolveStoredDataSteward(
  input: StoredDataSteward | null | undefined,
): Promise<DataStewardAssignment | null> {
  if (!input) return null;
  if (typeof input === "string") return resolveUserSteward(input);
  return input.type === "user"
    ? resolveStoredUserSteward(input)
    : resolveTeamSteward(input.id);
}

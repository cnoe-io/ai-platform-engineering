import { getCollection } from "@/lib/mongodb";
import { adminSurfaceObject } from "@/lib/rbac/baseline-access";
import {
  deleteExactOpenFgaTuples,
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import type { User } from "@/types/mongodb";

const TOME_ADMIN_OBJECT = adminSurfaceObject("tome");
const TOME_ADMIN_RELATION = "manager";
const USER_SUBJECT_PREFIX = "user:";
const MAX_DIRECT_ADMINS = 500;

export interface TomeAdminMember {
  subject: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
}

function storedUserSubject(user: Pick<User, "keycloak_sub" | "metadata">): string | null {
  return user.keycloak_sub?.trim() || user.metadata?.keycloak_sub?.trim() || null;
}

function tupleForSubject(subject: string): OpenFgaTupleKey {
  return {
    user: `${USER_SUBJECT_PREFIX}${subject}`,
    relation: TOME_ADMIN_RELATION,
    object: TOME_ADMIN_OBJECT,
  };
}

function validSubject(subject: string): boolean {
  return Boolean(subject) && subject.length <= 256 && !/[\s:#]/.test(subject);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function directAdminSubjects(): Promise<string[]> {
  const subjects = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({
      tuple: { relation: TOME_ADMIN_RELATION, object: TOME_ADMIN_OBJECT },
      pageSize: 100,
      continuationToken,
    });
    for (const tuple of page.tuples) {
      const user = tuple.key.user;
      if (!user.startsWith(USER_SUBJECT_PREFIX)) continue;
      const subject = user.slice(USER_SUBJECT_PREFIX.length);
      if (validSubject(subject)) subjects.add(subject);
      if (subjects.size >= MAX_DIRECT_ADMINS) break;
    }
    continuationToken = page.continuationToken;
  } while (continuationToken && subjects.size < MAX_DIRECT_ADMINS);
  return [...subjects];
}

export async function listDirectTomeAdmins(): Promise<TomeAdminMember[]> {
  const subjects = await directAdminSubjects();
  if (subjects.length === 0) return [];

  const users = await getCollection<User>("users");
  const records = await users
    .find({
      $or: [
        { keycloak_sub: { $in: subjects } },
        { "metadata.keycloak_sub": { $in: subjects } },
      ],
    })
    .project({
      email: 1,
      name: 1,
      avatar_url: 1,
      keycloak_sub: 1,
      "metadata.keycloak_sub": 1,
    })
    .toArray();
  const bySubject = new Map<string, User>();
  for (const user of records as User[]) {
    const subject = storedUserSubject(user);
    if (subject) bySubject.set(subject, user);
  }

  return subjects
    .flatMap((subject) => {
      const user = bySubject.get(subject);
      if (!user?.email) return [];
      return [
        {
          subject,
          email: user.email,
          name: user.name ?? null,
          avatar_url: user.avatar_url ?? null,
        },
      ];
    })
    .sort((a, b) =>
      (a.name || a.email || a.subject).localeCompare(b.name || b.email || b.subject),
    );
}

export async function grantTomeAdminByEmail(email: string): Promise<TomeAdminMember> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 320 || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid user email");
  }

  const users = await getCollection<User>("users");
  const user = await users.findOne({
    email: { $regex: `^${escapeRegex(normalizedEmail)}$`, $options: "i" },
  });
  if (!user) {
    throw new Error("User not found. They must sign in to CAIPE once before becoming a Tome admin.");
  }
  const subject = storedUserSubject(user);
  if (!subject || !validSubject(subject)) {
    throw new Error("User does not have a valid login identity yet. Ask them to sign in again.");
  }

  const result = await writeOpenFgaTuples({
    writes: [tupleForSubject(subject)],
    deletes: [],
  });
  if (!result.enabled) throw new Error("OpenFGA is not configured");

  return {
    subject,
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url ?? null,
  };
}

export async function revokeDirectTomeAdmin(
  subject: string,
  actingSubject: string,
): Promise<void> {
  const normalizedSubject = subject.trim();
  if (!validSubject(normalizedSubject)) throw new Error("Invalid Tome admin subject");
  if (normalizedSubject === actingSubject.trim()) {
    throw new Error("You cannot remove your own Tome admin access");
  }

  const subjects = await directAdminSubjects();
  if (!subjects.includes(normalizedSubject)) throw new Error("Tome admin grant not found");
  if (subjects.length <= 1) throw new Error("At least one direct Tome admin must remain");

  const result = await deleteExactOpenFgaTuples([tupleForSubject(normalizedSubject)]);
  if (!result.enabled) throw new Error("OpenFGA is not configured");
}

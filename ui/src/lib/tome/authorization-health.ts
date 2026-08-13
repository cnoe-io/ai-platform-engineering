import { randomUUID } from "crypto";

import { getCollection } from "@/lib/mongodb";
import {
  readOpenFgaTuples,
  writeOpenFgaTuples,
  type OpenFgaTupleKey,
} from "@/lib/rbac/openfga";
import {
  listActiveTeamMembershipSourcesBySlug,
  listActiveTeamMembershipSourcesForTeamUser,
  upsertTeamMembershipSource,
} from "@/lib/rbac/team-membership-source-store";
import {
  mongoRoleToOpenFgaRelations,
  resolveKeycloakUserSubject,
} from "@/lib/rbac/team-membership-sync";
import { readTeamOpenFgaTuples } from "@/lib/rbac/team-openfga-sync-status";
import { tomeDataObject } from "@/lib/tome/access";
import { auditTome } from "@/lib/tome/audit";
import {
  dataStewardOpenFgaSubject,
  resolveStoredDataSteward,
} from "@/lib/tome/steward-identity";
import type { TeamMembershipSource } from "@/types/identity-group-sync";
import type { DataStewardAssignment, ProjectDocument } from "@/types/projects";

const HEALTH_COLLECTION = "tome_authorization_health";
const SNAPSHOT_ID = "latest";
const LOCK_ID = "reconcile-lock";
const LOCK_TTL_MS = 4 * 60 * 1000;

export type TomeAuthorizationHealthStatus =
  | "healthy"
  | "reconciling"
  | "degraded"
  | "blocked";

export type TomeAuthorizationIssueCode =
  | "invalid_steward"
  | "missing_document_writer"
  | "membership_pending"
  | "membership_drifted"
  | "openfga_unavailable";

export interface TomeAuthorizationIssue {
  code: TomeAuthorizationIssueCode;
  project_id: string;
  project_slug: string;
  team_slug?: string;
  user_email?: string;
  message: string;
  repaired: boolean;
}

export interface TomeAuthorizationHealthSnapshot {
  status: TomeAuthorizationHealthStatus;
  trigger: string;
  started_at: string;
  completed_at?: string;
  projects_scanned: number;
  stewarded_projects: number;
  teams_scanned: number;
  relationships_checked: number;
  relationships_repaired: number;
  issues: TomeAuthorizationIssue[];
}

interface HealthDocument extends TomeAuthorizationHealthSnapshot {
  _id: string;
  lease_owner?: string;
  lease_expires_at?: Date;
}

interface ReconcileOptions {
  trigger: "startup" | "periodic" | "manual" | "request" | "inspect";
  repair: boolean;
  actor?: { id: string; email?: string };
}

function stewardTuple(
  project: Pick<ProjectDocument, "_id" | "slug" | "type">,
  steward: DataStewardAssignment,
): OpenFgaTupleKey {
  return {
    user: dataStewardOpenFgaSubject(steward),
    relation: "writer",
    object: tomeDataObject(project),
  };
}

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

async function exactTupleExists(tuple: OpenFgaTupleKey): Promise<boolean> {
  const result = await readOpenFgaTuples({ tuple, pageSize: 1 });
  return result.tuples.some((stored) => tupleKey(stored.key) === tupleKey(tuple));
}

async function resolveSourceSubject(
  source: TeamMembershipSource,
  teamSlug: string,
): Promise<string | undefined> {
  if (source.user_subject) return source.user_subject;
  if (!source.user_email) return undefined;
  const subject = await resolveKeycloakUserSubject(source.user_email, teamSlug);
  if (!subject) return undefined;
  await upsertTeamMembershipSource({
    ...source,
    user_subject: subject,
    last_applied_at: new Date().toISOString(),
  });
  return subject;
}

async function inspectTeam(
  teamSlug: string,
  repair: boolean,
): Promise<{
  checked: number;
  repaired: number;
  issues: Array<Omit<TomeAuthorizationIssue, "project_id" | "project_slug">>;
}> {
  const sources = await listActiveTeamMembershipSourcesBySlug(teamSlug);
  const issues: Array<Omit<TomeAuthorizationIssue, "project_id" | "project_slug">> = [];
  const expected: Array<{ tuple: OpenFgaTupleKey; source: TeamMembershipSource }> = [];

  for (const source of sources) {
    let subject = source.user_subject;
    if (!subject && repair) subject = await resolveSourceSubject(source, teamSlug);
    if (!subject) {
      issues.push({
        code: "membership_pending",
        team_slug: teamSlug,
        user_email: source.user_email,
        message: `Active membership for ${source.user_email || "an unknown user"} has no Keycloak subject.`,
        repaired: false,
      });
      continue;
    }
    for (const relation of mongoRoleToOpenFgaRelations(source.relationship)) {
      expected.push({
        tuple: { user: `user:${subject}`, relation, object: `team:${teamSlug}` },
        source,
      });
    }
  }

  const storedTuples = await readTeamOpenFgaTuples(teamSlug);
  if (storedTuples === null) throw new Error(`OpenFGA unavailable while reading team:${teamSlug}`);
  const storedTupleKeys = new Set(storedTuples.map(tupleKey));
  const missing = expected.filter((item) => !storedTupleKeys.has(tupleKey(item.tuple)));

  let repaired = 0;
  if (repair && missing.length > 0) {
    const result = await writeOpenFgaTuples({
      writes: missing.map((item) => item.tuple),
      deletes: [],
    });
    if (!result.enabled) throw new Error("OpenFGA is not configured");
    repaired = result.writes;
  }

  for (const item of missing) {
    const fixed = repair && (await exactTupleExists(item.tuple));
    issues.push({
      code: "membership_drifted",
      team_slug: teamSlug,
      user_email: item.source.user_email,
      message: `Expected ${item.tuple.user} #${item.tuple.relation} ${item.tuple.object} was missing.`,
      repaired: fixed,
    });
  }

  return { checked: expected.length, repaired, issues };
}

function publicSnapshot(document: HealthDocument): TomeAuthorizationHealthSnapshot {
  const { _id: _ignored, lease_owner: _owner, lease_expires_at: _expiry, ...snapshot } = document;
  return snapshot;
}

async function saveSnapshot(snapshot: TomeAuthorizationHealthSnapshot): Promise<void> {
  const collection = await getCollection<HealthDocument>(HEALTH_COLLECTION);
  await collection.updateOne(
    { _id: SNAPSHOT_ID },
    { $set: snapshot, $unset: { lease_owner: "", lease_expires_at: "" } },
    { upsert: true },
  );
}

async function acquireLease(snapshot: TomeAuthorizationHealthSnapshot): Promise<string | null> {
  const collection = await getCollection<HealthDocument>(HEALTH_COLLECTION);
  const owner = randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  const claimed = await collection.findOneAndUpdate(
    {
      _id: LOCK_ID,
      $or: [
        { lease_expires_at: { $lte: now } },
        { lease_expires_at: { $exists: false } },
      ],
    },
    {
      $set: {
        ...snapshot,
        status: "reconciling",
        lease_owner: owner,
        lease_expires_at: leaseExpiresAt,
      },
    },
    { returnDocument: "after" },
  );
  if (claimed?.lease_owner === owner) return owner;
  try {
    await collection.insertOne({
      _id: LOCK_ID,
      ...snapshot,
      status: "reconciling",
      lease_owner: owner,
      lease_expires_at: leaseExpiresAt,
    });
    return owner;
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return null;
    throw error;
  }
}

async function releaseLease(owner: string): Promise<void> {
  const collection = await getCollection<HealthDocument>(HEALTH_COLLECTION);
  await collection.deleteOne({ _id: LOCK_ID, lease_owner: owner });
}

/** Inspect or repair every relationship implied by Tome's canonical metadata. */
export async function reconcileTomeAuthorization(
  options: ReconcileOptions,
): Promise<TomeAuthorizationHealthSnapshot> {
  const startedAt = new Date().toISOString();
  const initial: TomeAuthorizationHealthSnapshot = {
    status: "reconciling",
    trigger: options.trigger,
    started_at: startedAt,
    projects_scanned: 0,
    stewarded_projects: 0,
    teams_scanned: 0,
    relationships_checked: 0,
    relationships_repaired: 0,
    issues: [],
  };
  const leaseOwner = options.repair ? await acquireLease(initial) : null;
  if (options.repair && !leaseOwner) {
    const current = await getTomeAuthorizationHealth();
    return current ?? initial;
  }

  try {
    const projects = await (
      await getCollection<ProjectDocument>("projects")
    ).find({}).toArray();
    initial.projects_scanned = projects.length;
    const teamCache = new Map<string, Awaited<ReturnType<typeof inspectTeam>>>();

    for (const project of projects) {
      if (!project.data_steward) continue;
      initial.stewarded_projects += 1;
      let steward: DataStewardAssignment | null;
      try {
        steward = await resolveStoredDataSteward(project.data_steward);
      } catch (error) {
        initial.issues.push({
          code: "invalid_steward",
          project_id: String(project._id ?? ""),
          project_slug: project.slug,
          message: error instanceof Error ? error.message : String(error),
          repaired: false,
        });
        continue;
      }
      if (!steward) continue;

      const expectedWriter = stewardTuple(project, steward);
      initial.relationships_checked += 1;
      let writerPresent = await exactTupleExists(expectedWriter);
      const writerWasMissing = !writerPresent;
      if (!writerPresent && options.repair) {
        const result = await writeOpenFgaTuples({ writes: [expectedWriter], deletes: [] });
        if (!result.enabled) throw new Error("OpenFGA is not configured");
        initial.relationships_repaired += result.writes;
        writerPresent = await exactTupleExists(expectedWriter);
      }
      if (writerWasMissing) {
        initial.issues.push({
          code: "missing_document_writer",
          project_id: String(project._id ?? ""),
          project_slug: project.slug,
          team_slug: steward.type === "team" ? steward.id : undefined,
          message: `Expected ${expectedWriter.user} #writer ${expectedWriter.object} was missing.`,
          repaired: writerPresent,
        });
      }

      if (steward.type === "team") {
        let team = teamCache.get(steward.id);
        if (!team) {
          team = await inspectTeam(steward.id, options.repair);
          teamCache.set(steward.id, team);
          initial.teams_scanned += 1;
          initial.relationships_checked += team.checked;
          initial.relationships_repaired += team.repaired;
        }
        initial.issues.push(
          ...team.issues.map((issue) => ({
            ...issue,
            project_id: String(project._id ?? ""),
            project_slug: project.slug,
          })),
        );
      }
    }

    const unresolved = initial.issues.filter((issue) => !issue.repaired);
    initial.status = unresolved.some((issue) =>
      issue.code === "invalid_steward" || issue.code === "membership_pending"
    )
      ? "blocked"
      : unresolved.length > 0
        ? "degraded"
        : "healthy";
    initial.completed_at = new Date().toISOString();
    await saveSnapshot(initial);

    if (options.repair && initial.relationships_repaired > 0) {
      auditTome({
        action: "tome.authorization.auto_repair",
        actor: options.actor
          ? { type: "user", id: options.actor.id, email: options.actor.email }
          : { type: "service", id: `tome-authorization-${options.trigger}` },
        projectSlug: "settings",
        metadata: {
          trigger: options.trigger,
          relationships_repaired: initial.relationships_repaired,
          status: initial.status,
        },
      });
    }
    return initial;
  } catch (error) {
    const failed: TomeAuthorizationHealthSnapshot = {
      ...initial,
      status: "blocked",
      completed_at: new Date().toISOString(),
      issues: [
        ...initial.issues,
        {
          code: "openfga_unavailable",
          project_id: "",
          project_slug: "settings",
          message: error instanceof Error ? error.message : String(error),
          repaired: false,
        },
      ],
    };
    await saveSnapshot(failed).catch(() => undefined);
    return failed;
  } finally {
    if (leaseOwner) await releaseLease(leaseOwner).catch(() => undefined);
  }
}

/** Read the durable status produced by the most recent scan. */
export async function getTomeAuthorizationHealth(): Promise<TomeAuthorizationHealthSnapshot | null> {
  const collection = await getCollection<HealthDocument>(HEALTH_COLLECTION);
  const lock = await collection.findOne({ _id: LOCK_ID });
  if (lock?.lease_expires_at && lock.lease_expires_at > new Date()) {
    return publicSnapshot({ ...lock, status: "reconciling" });
  }
  const snapshot = await collection.findOne({ _id: SNAPSHOT_ID });
  return snapshot ? publicSnapshot(snapshot) : null;
}

/** Request-time, caller-scoped fallback. It never invents membership intent. */
export async function repairTomeAuthorizationForProject(input: {
  project: ProjectDocument;
  userSubject: string;
  userEmail?: string | null;
}): Promise<number> {
  const steward = await resolveStoredDataSteward(input.project.data_steward);
  if (!steward) return 0;
  let repaired = 0;
  const writer = stewardTuple(input.project, steward);
  if (!(await exactTupleExists(writer))) {
    const result = await writeOpenFgaTuples({ writes: [writer], deletes: [] });
    if (!result.enabled) return 0;
    repaired += result.writes;
  }

  if (steward.type === "team") {
    const sources = await listActiveTeamMembershipSourcesForTeamUser({
      teamSlug: steward.id,
      userSubject: input.userSubject,
      userEmail: input.userEmail?.trim().toLowerCase() || undefined,
    });
    const matching = sources.filter((source) => {
      const emailMatches =
        Boolean(input.userEmail) &&
        source.user_email?.toLowerCase() === input.userEmail?.toLowerCase();
      // A populated-but-different subject is a contradiction, not drift. Do
      // not override it merely because an email happens to match; only the IdP
      // sync path may change an established identity link.
      return source.user_subject
        ? source.user_subject === input.userSubject
        : emailMatches;
    });
    const tuples: OpenFgaTupleKey[] = [];
    for (const source of matching) {
      if (!source.user_subject && source.user_email) {
        await upsertTeamMembershipSource({
          ...source,
          user_subject: input.userSubject,
          last_applied_at: new Date().toISOString(),
        });
      }
      for (const relation of mongoRoleToOpenFgaRelations(source.relationship)) {
        tuples.push({
          user: `user:${input.userSubject}`,
          relation,
          object: `team:${steward.id}`,
        });
      }
    }
    if (tuples.length > 0) {
      const result = await writeOpenFgaTuples({ writes: tuples, deletes: [] });
      if (result.enabled) repaired += result.writes;
    }
  }
  return repaired;
}

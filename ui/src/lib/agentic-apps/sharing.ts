import { organizationObjectId } from "@/lib/rbac/organization";
import type { OpenFgaTupleKey, TeamResourceTupleDiff } from "@/lib/rbac/openfga";
import type {
  AgenticAppInstallationRecord,
  AgenticAppTeamAccessGrant,
  AgenticAppTeamRole,
  AgenticAppVisibility,
} from "@/types/agentic-app";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;

export interface AgenticAppSharingTupleInput {
  appId: string;
  ownerSubject: string;
  visibility: AgenticAppVisibility;
  sharedWithTeams?: readonly string[];
  teamAccess?: readonly AgenticAppTeamAccessGrant[];
  previousVisibility?: AgenticAppVisibility;
  previousSharedWithTeams?: readonly string[];
  previousTeamAccess?: readonly AgenticAppTeamAccessGrant[];
}

export function effectiveAgenticAppVisibility(
  installation: Pick<AgenticAppInstallationRecord, "visibility"> | null | undefined,
): AgenticAppVisibility {
  const visibility = installation?.visibility;
  return visibility === "private" || visibility === "team" ? visibility : "global";
}

export function buildAgenticAppSharingTupleDiff(
  input: AgenticAppSharingTupleInput,
): TeamResourceTupleDiff {
  if (!OPENFGA_ID_PATTERN.test(input.appId)) {
    throw new Error(`Invalid OpenFGA agentic app id: ${input.appId}`);
  }
  if (!OPENFGA_ID_PATTERN.test(input.ownerSubject)) {
    throw new Error("A stable owner subject is required");
  }

  const object = `agentic_app:${input.appId}`;
  const previous = sharingTuples({
    object,
    ownerSubject: input.ownerSubject,
    visibility: input.previousVisibility ?? "global",
    sharedWithTeams: input.previousSharedWithTeams,
    teamAccess: input.previousTeamAccess,
  });
  const next = sharingTuples({
    object,
    ownerSubject: input.ownerSubject,
    visibility: input.visibility,
    sharedWithTeams: input.sharedWithTeams,
    teamAccess: input.teamAccess,
  });
  const previousKeys = new Set(previous.map(tupleKey));
  const nextKeys = new Set(next.map(tupleKey));
  const ownerTuple = next[0];

  return {
    // Reassert ownership on every sharing mutation. Legacy installation rows
    // predate owner tuples, and OpenFGA writes are idempotent.
    writes: [
      ownerTuple,
      ...next.slice(1).filter((tuple) => !previousKeys.has(tupleKey(tuple))),
    ],
    deletes: previous.filter((tuple) => !nextKeys.has(tupleKey(tuple))),
  };
}

function sharingTuples(input: {
  object: string;
  ownerSubject: string;
  visibility: AgenticAppVisibility;
  sharedWithTeams?: readonly string[];
  teamAccess?: readonly AgenticAppTeamAccessGrant[];
}): OpenFgaTupleKey[] {
  const tuples: OpenFgaTupleKey[] = [
    {
      user: `user:${input.ownerSubject}`,
      relation: "owner",
      object: input.object,
    },
  ];

  if (input.visibility === "global") {
    tuples.push(
      { user: "user:*", relation: "user", object: input.object },
      {
        user: `${organizationObjectId()}#admin`,
        relation: "manager",
        object: input.object,
      },
    );
  }

  if (input.visibility !== "private") {
    const legacyTeams = input.visibility === "team" ? input.sharedWithTeams : undefined;
    for (const grant of effectiveTeamAccess(input.teamAccess, legacyTeams)) {
      tuples.push(teamAccessTuple(grant, input.object));
    }
  }

  if (input.visibility === "team") {
    tuples.push({
      user: `${organizationObjectId()}#admin`,
      relation: "manager",
      object: input.object,
    });
  }

  return tuples;
}

/** Converts legacy team-only sharing into Viewer grants and canonicalizes role rows. */
export function effectiveAgenticAppTeamAccess(
  installation: Pick<AgenticAppInstallationRecord, "teamAccess" | "sharedWithTeams"> | null | undefined,
): AgenticAppTeamAccessGrant[] {
  return effectiveTeamAccess(installation?.teamAccess, installation?.sharedWithTeams);
}

function effectiveTeamAccess(
  teamAccess: readonly AgenticAppTeamAccessGrant[] | undefined,
  legacyTeams: readonly string[] | undefined,
): AgenticAppTeamAccessGrant[] {
  const byTeam = new Map<string, AgenticAppTeamRole>();
  for (const grant of teamAccess ?? []) {
    const slug = normalizeTeamSlug(grant.teamSlug);
    if (slug && isTeamRole(grant.role)) byTeam.set(slug, grant.role);
  }
  if (byTeam.size === 0) {
    for (const slug of normalizeTeamSlugs(legacyTeams)) byTeam.set(slug, "viewer");
  }
  return [...byTeam.entries()]
    .map(([teamSlug, role]) => ({ teamSlug, role }))
    .sort((a, b) => a.teamSlug.localeCompare(b.teamSlug));
}

function teamAccessTuple(grant: AgenticAppTeamAccessGrant, object: string): OpenFgaTupleKey {
  if (grant.role === "admin") {
    return { user: `team:${grant.teamSlug}#admin`, relation: "manager", object };
  }
  const relation = grant.role === "viewer" ? "user" : grant.role === "editor" ? "writer" : "approver";
  return { user: `team:${grant.teamSlug}#member`, relation, object };
}

function isTeamRole(value: string): value is AgenticAppTeamRole {
  return value === "viewer" || value === "editor" || value === "approver" || value === "admin";
}

function normalizeTeamSlug(value: string): string | null {
  const slug = value.trim().toLowerCase();
  return OPENFGA_ID_PATTERN.test(slug) ? slug : null;
}

function normalizeTeamSlugs(values: readonly string[] | undefined): string[] {
  const slugs = new Set<string>();
  for (const value of values ?? []) {
    const slug = normalizeTeamSlug(value);
    if (slug) slugs.add(slug);
  }
  return [...slugs];
}

function tupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user}\n${tuple.relation}\n${tuple.object}`;
}

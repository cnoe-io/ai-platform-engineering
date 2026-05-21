import { getCollection } from "@/lib/mongodb";
import type { OpenFgaTupleKey } from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";

export const BASELINE_ADMIN_SURFACES = ["users", "teams", "skills", "metrics", "health", "credentials"] as const;
export const PRIVILEGED_ADMIN_SURFACES = [
  "roles",
  "identity_group_sync",
  "slack",
  "webex",
  "feedback",
  "nps",
  "stats",
  "audit_logs",
  "action_audit",
  "openfga",
  "migrations",
] as const;

export type BaselineAdminSurface = (typeof BASELINE_ADMIN_SURFACES)[number];
export type PrivilegedAdminSurface = (typeof PRIVILEGED_ADMIN_SURFACES)[number];
export type AdminSurface = BaselineAdminSurface | PrivilegedAdminSurface;

export interface BaselineDiagnosticCheck {
  id: string;
  label: string;
  tuple: OpenFgaTupleKey;
  expected_member: boolean;
  expected_admin: boolean;
}

export interface BaselineFgaGrantDefinition {
  id: string;
  label: string;
  description: string;
  tuple: (subject: string) => OpenFgaTupleKey;
}

export interface BaselineFgaProfile {
  member_grants: string[];
  admin_grants: string[];
  updated_at?: string;
  updated_by?: string;
  source: "default" | "mongo";
}

type BaselineFgaProfileDoc = {
  _id: "default";
  member_grants?: unknown;
  admin_grants?: unknown;
  updated_at?: string;
  updated_by?: string;
} & Record<string, unknown>;

export const BASELINE_FGA_PROFILE_COLLECTION = "openfga_baseline_profiles";
export const BASELINE_FGA_PROFILE_ID = "default";

export function adminSurfaceObject(surface: string): string {
  return `admin_surface:${surface}`;
}

export function userProfileObject(subject: string): string {
  return `user_profile:${subject}`;
}

export function memberBaselineGrantDefinitions(): BaselineFgaGrantDefinition[] {
  return [
    {
      id: "organization-member",
      label: "Organization member",
      description: "Allows the user to use organization-scoped CAIPE resources.",
      tuple: (subject) => ({ user: `user:${subject}`, relation: "member", object: organizationObjectId() }),
    },
    {
      id: "platform-settings-read",
      label: "Read platform settings",
      description: "Allows non-admin users to read platform settings needed by the UI.",
      tuple: (subject) => ({
        user: `user:${subject}`,
        relation: "reader",
        object: "system_config:platform_settings",
      }),
    },
    {
      id: "own-profile-owner",
      label: "Own user profile",
      description: "Allows users to read and manage their own profile object.",
      tuple: (subject) => ({ user: `user:${subject}`, relation: "owner", object: userProfileObject(subject) }),
    },
    ...BASELINE_ADMIN_SURFACES.map((surface) => ({
      id: `admin-surface:${surface}:read`,
      label: `Read ${surface.replaceAll("_", " ")} admin surface`,
      description: `Shows the ${surface.replaceAll("_", " ")} admin tab in read-only mode for non-admin users.`,
      tuple: (subject: string) => ({
        user: `user:${subject}`,
        relation: "reader",
        object: adminSurfaceObject(surface),
      }),
    })),
  ];
}

export function adminBaselineGrantDefinitions(): BaselineFgaGrantDefinition[] {
  return [
    {
      id: "organization-admin",
      label: "Organization admin",
      description: "Allows the user to administer organization-scoped CAIPE resources.",
      tuple: (subject) => ({ user: `user:${subject}`, relation: "admin", object: organizationObjectId() }),
    },
    {
      id: "platform-settings-manage",
      label: "Manage platform settings",
      description: "Allows admins to update platform settings and system configuration.",
      tuple: (subject) => ({
        user: `user:${subject}`,
        relation: "manager",
        object: "system_config:platform_settings",
      }),
    },
    {
      id: "agentgateway-manage",
      label: "Manage AgentGateway MCP sync",
      description: "Allows admins to sync MCP servers through AgentGateway.",
      tuple: (subject) => ({ user: `user:${subject}`, relation: "manager", object: "mcp_server:agentgateway" }),
    },
    ...PRIVILEGED_ADMIN_SURFACES.map((surface) => ({
      id: `admin-surface:${surface}:manage`,
      label: `Manage ${surface.replaceAll("_", " ")} admin surface`,
      description: `Allows admins to manage the ${surface.replaceAll("_", " ")} admin surface.`,
      tuple: (subject: string) => ({
        user: `user:${subject}`,
        relation: "manager",
        object: adminSurfaceObject(surface),
      }),
    })),
  ];
}

function uniqueGrantIds(values: unknown, definitions: BaselineFgaGrantDefinition[]): string[] {
  const allowed = new Set(definitions.map((definition) => definition.id));
  const ids = Array.isArray(values) ? values : definitions.map((definition) => definition.id);
  const selected: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !allowed.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}

export function defaultBaselineFgaProfile(): BaselineFgaProfile {
  return {
    member_grants: memberBaselineGrantDefinitions().map((definition) => definition.id),
    admin_grants: adminBaselineGrantDefinitions().map((definition) => definition.id),
    source: "default",
  };
}

export function normalizeBaselineFgaProfile(input: {
  member_grants?: unknown;
  admin_grants?: unknown;
  updated_at?: string;
  updated_by?: string;
  source?: "default" | "mongo";
}): BaselineFgaProfile {
  return {
    member_grants: uniqueGrantIds(input.member_grants, memberBaselineGrantDefinitions()),
    admin_grants: uniqueGrantIds(input.admin_grants, adminBaselineGrantDefinitions()),
    updated_at: input.updated_at,
    updated_by: input.updated_by,
    source: input.source ?? "default",
  };
}

export async function getBaselineFgaProfile(): Promise<BaselineFgaProfile> {
  try {
    const collection = await getCollection<BaselineFgaProfileDoc>(BASELINE_FGA_PROFILE_COLLECTION);
    const doc = await collection.findOne({ _id: BASELINE_FGA_PROFILE_ID });
    if (!doc) return defaultBaselineFgaProfile();
    return normalizeBaselineFgaProfile({ ...doc, source: "mongo" });
  } catch {
    return defaultBaselineFgaProfile();
  }
}

export async function saveBaselineFgaProfile(input: {
  member_grants: string[];
  admin_grants: string[];
  updated_by: string;
}): Promise<BaselineFgaProfile> {
  const profile = normalizeBaselineFgaProfile({
    member_grants: input.member_grants,
    admin_grants: input.admin_grants,
    updated_at: new Date().toISOString(),
    updated_by: input.updated_by,
    source: "mongo",
  });
  const collection = await getCollection<BaselineFgaProfileDoc>(BASELINE_FGA_PROFILE_COLLECTION);
  await collection.updateOne(
    { _id: BASELINE_FGA_PROFILE_ID },
    {
      $set: {
        member_grants: profile.member_grants,
        admin_grants: profile.admin_grants,
        updated_at: profile.updated_at,
        updated_by: profile.updated_by,
      },
      $setOnInsert: { _id: BASELINE_FGA_PROFILE_ID },
    },
    { upsert: true },
  );
  return profile;
}

function tuplesFromGrantIds(
  subject: string,
  grantIds: string[],
  definitions: BaselineFgaGrantDefinition[],
): OpenFgaTupleKey[] {
  const selected = new Set(grantIds);
  return definitions
    .filter((definition) => selected.has(definition.id))
    .map((definition) => definition.tuple(subject));
}

export function baselineMemberTuples(
  subject: string,
  profile: BaselineFgaProfile = defaultBaselineFgaProfile(),
): OpenFgaTupleKey[] {
  return tuplesFromGrantIds(subject, profile.member_grants, memberBaselineGrantDefinitions());
}

export function baselineAdminTuples(
  subject: string,
  profile: BaselineFgaProfile = defaultBaselineFgaProfile(),
): OpenFgaTupleKey[] {
  return tuplesFromGrantIds(subject, profile.admin_grants, adminBaselineGrantDefinitions());
}

export function baselineBootstrapTuples(
  subject: string,
  isAdmin: boolean,
  profile: BaselineFgaProfile = defaultBaselineFgaProfile(),
): OpenFgaTupleKey[] {
  const memberTuples = baselineMemberTuples(subject, profile);
  return isAdmin ? [...memberTuples, ...baselineAdminTuples(subject, profile)] : memberTuples;
}

export function baselineDiagnosticChecks(
  subject: string,
  profile: BaselineFgaProfile = defaultBaselineFgaProfile(),
): BaselineDiagnosticCheck[] {
  return [
    ...memberBaselineGrantDefinitions().map((definition) => {
      const selected = profile.member_grants.includes(definition.id);
      return {
        id: `member-${definition.id}`,
        label: definition.label,
        tuple: materializedDiagnosticTuple(definition.tuple(subject)),
        expected_member: selected,
        expected_admin: selected,
      };
    }),
    ...adminBaselineGrantDefinitions().map((definition) => {
      const selected = profile.admin_grants.includes(definition.id);
      return {
        id: `admin-${definition.id}`,
        label: definition.label,
        tuple: materializedDiagnosticTuple(definition.tuple(subject)),
        expected_member: false,
        expected_admin: selected,
      };
    }),
  ];
}

function materializedDiagnosticTuple(tuple: OpenFgaTupleKey): OpenFgaTupleKey {
  const relationMap: Record<string, string> = {
    admin: "can_manage",
    manager: "can_manage",
    member: "can_use",
    owner: "can_read",
    reader: "can_read",
  };
  return { ...tuple, relation: relationMap[tuple.relation] ?? tuple.relation };
}

export function baselineGrantCatalog(): {
  member: BaselineFgaGrantDefinition[];
  admin: BaselineFgaGrantDefinition[];
} {
  return {
    member: memberBaselineGrantDefinitions(),
    admin: adminBaselineGrantDefinitions(),
  };
}

export function baselineTupleKey(tuple: OpenFgaTupleKey): string {
  return `${tuple.user}\u0000${tuple.relation}\u0000${tuple.object}`;
}

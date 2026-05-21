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

export function adminSurfaceObject(surface: string): string {
  return `admin_surface:${surface}`;
}

export function userProfileObject(subject: string): string {
  return `user_profile:${subject}`;
}

export function baselineMemberTuples(subject: string): OpenFgaTupleKey[] {
  return [
    { user: `user:${subject}`, relation: "member", object: organizationObjectId() },
    { user: `user:${subject}`, relation: "reader", object: "system_config:platform_settings" },
    { user: `user:${subject}`, relation: "owner", object: userProfileObject(subject) },
    ...BASELINE_ADMIN_SURFACES.map((surface) => ({
      user: `user:${subject}`,
      relation: "reader",
      object: adminSurfaceObject(surface),
    })),
  ];
}

export function baselineAdminTuples(subject: string): OpenFgaTupleKey[] {
  return [
    { user: `user:${subject}`, relation: "admin", object: organizationObjectId() },
    { user: `user:${subject}`, relation: "manager", object: "system_config:platform_settings" },
    { user: `user:${subject}`, relation: "manager", object: "mcp_server:agentgateway" },
  ];
}

export function baselineBootstrapTuples(subject: string, isAdmin: boolean): OpenFgaTupleKey[] {
  const memberTuples = baselineMemberTuples(subject);
  return isAdmin ? [...memberTuples, ...baselineAdminTuples(subject)] : memberTuples;
}

export function baselineDiagnosticChecks(subject: string): BaselineDiagnosticCheck[] {
  return [
    {
      id: "organization-use",
      label: "Organization baseline use",
      tuple: { user: `user:${subject}`, relation: "can_use", object: organizationObjectId() },
      expected_member: true,
      expected_admin: true,
    },
    {
      id: "organization-audit",
      label: "Organization audit/admin view",
      tuple: { user: `user:${subject}`, relation: "can_audit", object: organizationObjectId() },
      expected_member: false,
      expected_admin: true,
    },
    {
      id: "organization-manage",
      label: "Organization manage",
      tuple: { user: `user:${subject}`, relation: "can_manage", object: organizationObjectId() },
      expected_member: false,
      expected_admin: true,
    },
    {
      id: "platform-settings-read",
      label: "Platform settings read",
      tuple: { user: `user:${subject}`, relation: "can_read", object: "system_config:platform_settings" },
      expected_member: true,
      expected_admin: true,
    },
    {
      id: "platform-settings-manage",
      label: "Platform settings manage",
      tuple: { user: `user:${subject}`, relation: "can_manage", object: "system_config:platform_settings" },
      expected_member: false,
      expected_admin: true,
    },
    {
      id: "agentgateway-mcp-manage",
      label: "AgentGateway MCP sync manage",
      tuple: { user: `user:${subject}`, relation: "can_manage", object: "mcp_server:agentgateway" },
      expected_member: false,
      expected_admin: true,
    },
    {
      id: "own-profile-read",
      label: "Own profile read",
      tuple: { user: `user:${subject}`, relation: "can_read", object: userProfileObject(subject) },
      expected_member: true,
      expected_admin: true,
    },
    ...BASELINE_ADMIN_SURFACES.map((surface) => ({
      id: `baseline-${surface}-read`,
      label: `Read-only ${surface} admin surface`,
      tuple: { user: `user:${subject}`, relation: "can_read", object: adminSurfaceObject(surface) },
      expected_member: true,
      expected_admin: true,
    })),
    ...PRIVILEGED_ADMIN_SURFACES.map((surface) => ({
      id: `privileged-${surface}-manage`,
      label: `Manage ${surface} admin surface`,
      tuple: { user: `user:${subject}`, relation: "can_manage", object: adminSurfaceObject(surface) },
      expected_member: false,
      expected_admin: true,
    })),
  ];
}

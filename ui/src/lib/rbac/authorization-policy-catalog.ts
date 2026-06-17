import type {
UniversalRebacRelationship,
UniversalRebacResourceAction,
UniversalRebacResourceRef,
UniversalRebacResourceType,
UniversalRebacSubjectType,
} from "@/types/rbac-universal";

type SubjectRelation = NonNullable<UniversalRebacRelationship["subject"]["relation"]>;

interface PolicySubjectTemplate {
  type: UniversalRebacSubjectType;
  parameter: string;
  relation?: SubjectRelation;
}

interface PolicyResourceTemplate {
  type: UniversalRebacResourceType;
  parameter: string;
}

export interface AuthorizationPolicyGrantTemplate {
  subject: PolicySubjectTemplate;
  action: UniversalRebacResourceAction;
  resource: PolicyResourceTemplate;
}

export interface AuthorizationPolicyDefinition {
  id: string;
  family: string;
  surface: string;
  title: string;
  description: string;
  trigger: string;
  grants: readonly AuthorizationPolicyGrantTemplate[];
}

export const AUTHORIZATION_POLICIES = [
  {
    id: "slack_channel_team_assignment_v1",
    family: "messaging_team_assignment",
    surface: "slack",
    title: "Slack channel team assignment",
    description:
      "Assigning a Slack channel to a team lets team members use and manage the channel integration; team admins also manage it.",
    trigger: "admin assigns or reassigns a Slack channel to a team",
    grants: [
      {
        subject: { type: "team", parameter: "teamSlug", relation: "admin" },
        action: "manage",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "use",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "manage",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
    ],
  },
  {
    id: "webex_space_team_assignment_v1",
    family: "messaging_team_assignment",
    surface: "webex",
    title: "Webex space team assignment",
    description:
      "Assigning a Webex space to a team lets team members use the space integration; team admins manage it.",
    trigger: "admin assigns or reassigns a Webex space to a team",
    grants: [
      {
        subject: { type: "team", parameter: "teamSlug", relation: "admin" },
        action: "manage",
        resource: { type: "webex_space", parameter: "webexSpaceId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "use",
        resource: { type: "webex_space", parameter: "webexSpaceId" },
      },
    ],
  },
] as const satisfies readonly AuthorizationPolicyDefinition[];

export type AuthorizationPolicyId = (typeof AUTHORIZATION_POLICIES)[number]["id"];

export const AUTHORIZATION_POLICIES_BY_ID = new Map(
  AUTHORIZATION_POLICIES.map((policy) => [policy.id, policy])
);

export function listAuthorizationPolicies(): readonly AuthorizationPolicyDefinition[] {
  return AUTHORIZATION_POLICIES;
}

export function listAuthorizationPoliciesBySurface(
  surface: string
): readonly AuthorizationPolicyDefinition[] {
  return AUTHORIZATION_POLICIES.filter((policy) => policy.surface === surface);
}

export function listAuthorizationPoliciesByResourceType(
  resourceType: UniversalRebacResourceType
): readonly AuthorizationPolicyDefinition[] {
  return AUTHORIZATION_POLICIES.filter((policy) =>
    policy.grants.some((grant) => grant.resource.type === resourceType)
  );
}

export function getAuthorizationPolicy(id: AuthorizationPolicyId): AuthorizationPolicyDefinition {
  const policy = AUTHORIZATION_POLICIES_BY_ID.get(id);
  if (!policy) {
    throw new Error(`Unknown authorization policy: ${id}`);
  }
  return policy;
}

export function instantiatePolicyRelationships(
  policyId: AuthorizationPolicyId,
  parameters: Record<string, string>
): UniversalRebacRelationship[] {
  const policy = getAuthorizationPolicy(policyId);
  return policy.grants.map((grant) => ({
    subject: {
      type: grant.subject.type,
      id: readPolicyParameter(parameters, grant.subject.parameter, policy.id),
      ...(grant.subject.relation ? { relation: grant.subject.relation } : {}),
    },
    action: grant.action,
    resource: {
      type: grant.resource.type,
      id: readPolicyParameter(parameters, grant.resource.parameter, policy.id),
    } satisfies UniversalRebacResourceRef,
  }));
}

function readPolicyParameter(
  parameters: Record<string, string>,
  name: string,
  policyId: string
): string {
  const value = parameters[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} for authorization policy ${policyId}`);
  }
  return value;
}

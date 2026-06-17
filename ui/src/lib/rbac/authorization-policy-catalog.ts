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
  feature: {
    name: string;
    summary: string;
    subfeatures: readonly {
      name: string;
      behavior: string;
      authorization: string;
    }[];
  };
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
    feature: {
      name: "Slack integrations",
      summary:
        "Slack integrations let teams choose which bot routes and agents answer in their Slack channels.",
      subfeatures: [
        {
          name: "Configured channels",
          behavior: "Team members see the Slack channels shared with their team.",
          authorization: "A shared channel gives that team's members access to view and update that channel's routing.",
        },
        {
          name: "Channel routing",
          behavior: "Team members can choose which agent answers in a shared channel.",
          authorization: "The selected agent still needs to be usable by both the channel and the user's team.",
        },
        {
          name: "Slack message handling",
          behavior: "The Slack bot only dispatches a message when the channel route and the sender's team access line up.",
          authorization: "The runtime checks channel access and team agent access before calling the agent.",
        },
      ],
    },
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
    feature: {
      name: "Webex integrations",
      summary:
        "Webex integrations let teams connect spaces to CAIPE routing so messages can reach the right agents.",
      subfeatures: [
        {
          name: "Configured spaces",
          behavior: "Team members can use Webex spaces that are shared with their team.",
          authorization: "The space assignment creates team access for that Webex space.",
        },
        {
          name: "Space administration",
          behavior: "Team admins manage the Webex space integration settings.",
          authorization: "Management access stays with the team's admins for Webex space settings.",
        },
      ],
    },
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

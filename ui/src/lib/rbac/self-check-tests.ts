// assisted-by Codex Codex-sonnet-4-6

import type { Document,Filter } from "mongodb";

import {
  authorize,
  type Action,
  type AuthorizeResult,
  type ResourceType,
  type Subject,
  type SubjectType,
} from "@/lib/authz";
import { getCollection } from "@/lib/mongodb";
import { readOpenFgaTuples,type OpenFgaTuple } from "@/lib/rbac/openfga";
import { getUnlinkedServiceAccount } from "@/lib/rbac/unlinked-service-account";
import {
  RBAC_SELF_CHECKS,
  type RbacSelfCheckId,
} from "@/lib/rbac/self-check-catalog";
import { runRbacSelfCheck } from "@/lib/rbac/self-check";
import {
  UNIVERSAL_REBAC_RESOURCE_TYPE_NAMES,
  type UniversalRebacResourceAction,
  type UniversalRebacResourceType,
} from "@/types/rbac-universal";
import type {
  RbacSelfCheckAssertionInput,
  RbacSelfCheckReport,
  RbacSelfCheckTestActor,
  RbacSelfCheckTestActorKey,
  RbacSelfCheckTestCase,
  RbacSelfCheckTestCaseStatus,
  RbacSelfCheckTestCheck,
  RbacSelfCheckTestReport,
  RbacSelfCheckTestResource,
  RbacSelfCheckTestSuite,
  RbacSelfCheckTestSuiteDefinition,
  RbacSelfCheckTestSuiteId,
} from "@/types/rbac-self-check";

const OPENFGA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~@|*+=,/-]{0,191}$/;
const MAX_POLICY_TUPLES = 5_000;

type ActorOverrides = Partial<Record<RbacSelfCheckTestActorKey, string | {
  id?: string;
  subject_id?: string;
  type?: SubjectType;
  subject_type?: SubjectType;
  label?: string;
}>>;

export interface RbacSelfCheckTestRunOptions {
  suites?: string[];
  actors?: ActorOverrides;
  assertions?: RbacSelfCheckAssertionInput[];
  callerSubject?: Subject;
}

interface TeamDoc extends Document {
  slug?: string;
  name?: string;
  status?: string;
}

interface TeamMembershipSourceDoc extends Document {
  team_slug?: string;
  user_subject?: string;
  relationship?: string;
  status?: string;
}

interface DynamicAgentDoc extends Document {
  _id?: string;
  id?: string;
  name?: string;
  owner_subject?: string;
  owner_team_slug?: string | null;
  shared_with_teams?: string[];
  visibility?: string;
  allowed_tools?: Record<string, string[] | boolean>;
}

interface McpServerDoc extends Document {
  _id?: string;
  id?: string;
  name?: string;
  owner_subject?: string;
  owner_team_slug?: string | null;
  config_driven?: boolean;
}

interface LlmModelDoc extends Document {
  _id?: string;
  model_id?: string;
  name?: string;
  owner_subject?: string;
  config_driven?: boolean;
}

interface CredentialSecretRefDoc extends Document {
  id?: string;
  name?: string;
  owner?: { type?: string; id?: string };
  sharedWithTeams?: string[];
}

interface ServiceAccountDoc extends Document {
  sa_sub?: string;
  client_id?: string;
  name?: string;
  status?: string;
  is_platform_unlinked?: boolean;
  scopes_snapshot?: Array<{ type?: string; ref?: string }>;
}

interface MessagingGrantDoc extends Document {
  workspace_id?: string;
  channel_id?: string;
  space_id?: string;
  resource?: { type?: string; id?: string };
  actions?: string[];
}

interface SlackTeamMappingDoc extends Document {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  team_slug?: string;
}

interface WebexTeamMappingDoc extends Document {
  webex_workspace_id?: string;
  webex_space_id?: string;
  team_slug?: string;
}

interface SkillDoc extends Document {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
}

interface TaskDoc extends Document {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
}

interface ToolCatalogDoc extends Document {
  server_id?: string;
  tool_id?: string;
}

interface RbacSelfCheckTestInventory {
  teams: TeamDoc[];
  teamMembershipSources: TeamMembershipSourceDoc[];
  dynamicAgents: DynamicAgentDoc[];
  mcpServers: McpServerDoc[];
  llmModels: LlmModelDoc[];
  credentialSecretRefs: CredentialSecretRefDoc[];
  serviceAccounts: ServiceAccountDoc[];
  slackChannelGrants: MessagingGrantDoc[];
  slackChannelTeamMappings: SlackTeamMappingDoc[];
  webexSpaceGrants: MessagingGrantDoc[];
  webexSpaceTeamMappings: WebexTeamMappingDoc[];
  skills: SkillDoc[];
  tasks: TaskDoc[];
  mcpToolCatalog: ToolCatalogDoc[];
  policyTuples: Array<{ user: string; relation: string; object: string }>;
}

interface ResolvedActors {
  org_admin: RbacSelfCheckTestActor;
  member_user: RbacSelfCheckTestActor;
  service_account: RbacSelfCheckTestActor;
  unlinked_service_account: RbacSelfCheckTestActor;
}

type DecisionExpectation = "ALLOW" | "DENY";

export const RBAC_SELF_CHECK_TEST_SUITES: RbacSelfCheckTestSuiteDefinition[] = [
  {
    id: "team_memberships",
    label: "Teams",
    description: "Validate active team membership rows and team-derived access.",
    default_enabled: true,
  },
  {
    id: "credentials",
    label: "Credentials",
    description: "Check private and shared credential metadata/use relationships.",
    default_enabled: true,
  },
  {
    id: "mcp_servers",
    label: "MCP servers",
    description: "Check MCP server discover/use/invoke access for configured resources.",
    default_enabled: true,
  },
  {
    id: "data_sources",
    label: "Data sources",
    description: "Check data-source read inheritance from knowledge-base grants.",
    default_enabled: true,
  },
  {
    id: "knowledge_bases",
    label: "Knowledge bases",
    description: "Check knowledge-base read access from live OpenFGA grants.",
    default_enabled: true,
  },
  {
    id: "agents",
    label: "Agents",
    description: "Check agent can_use paths for team, global, and service-account scopes.",
    default_enabled: true,
  },
  {
    id: "agent_tools",
    label: "Agent tools",
    description: "Validate agent-to-tool caller grants authored by agent allowed_tools.",
    default_enabled: true,
  },
  {
    id: "skills",
    label: "Skills",
    description: "Probe skill use access when skill resources are present in OpenFGA.",
    default_enabled: true,
  },
  {
    id: "llm_models",
    label: "LLM models",
    description: "Check model read/manage grants for configured models.",
    default_enabled: true,
  },
  {
    id: "service_accounts",
    label: "Service accounts",
    description: "Check linked and unlinked service-account runtime scopes.",
    default_enabled: true,
  },
  {
    id: "slack",
    label: "Slack",
    description: "Check Slack channel team mappings and resource grants.",
    default_enabled: true,
  },
  {
    id: "webex",
    label: "Webex",
    description: "Check Webex space team mappings and resource grants.",
    default_enabled: true,
  },
  {
    id: "workflows",
    label: "Workflows",
    description: "Probe workflow/task template access when workflow resources exist.",
    default_enabled: false,
  },
  {
    id: "chat_sre_agent",
    label: "Chat with SRE Agent",
    description: "Probe the SRE agent path when an SRE/Outshift debug agent exists.",
    default_enabled: false,
  },
  {
    id: "custom_assertions",
    label: "Custom assertions",
    description: "Caller-supplied allow/deny checks for Playwright and CI lifecycle tests.",
    default_enabled: false,
  },
];

const SUITE_BY_ID = new Map<RbacSelfCheckTestSuiteId, RbacSelfCheckTestSuiteDefinition>(
  RBAC_SELF_CHECK_TEST_SUITES.map((suite) => [suite.id, suite]),
);

const SELF_CHECK_IDS_BY_SUITE: Partial<Record<RbacSelfCheckTestSuiteId, RbacSelfCheckId[]>> = {
  team_memberships: ["team_memberships"],
  credentials: ["credentials"],
  mcp_servers: ["mcp_servers"],
  agents: ["agent_access"],
  agent_tools: ["agent_tools"],
  llm_models: ["llm_models"],
  service_accounts: ["service_accounts"],
  slack: ["slack"],
  webex: ["webex"],
};

const RESOURCE_TYPES = new Set<string>(UNIVERSAL_REBAC_RESOURCE_TYPE_NAMES);
const ACTIONS = new Set<string>([
  "discover",
  "read",
  "use",
  "write",
  "create",
  "delete",
  "manage",
  "administer",
  "audit",
  "approve",
  "share",
  "call",
  "invoke",
  "map",
  "ingest",
  "read-metadata",
]);

function isValidOpenFgaId(value: unknown): value is string {
  return typeof value === "string" && OPENFGA_ID_PATTERN.test(value);
}

function isResourceType(value: string): value is UniversalRebacResourceType {
  return RESOURCE_TYPES.has(value);
}

function isAction(value: string): value is UniversalRebacResourceAction {
  return ACTIONS.has(value);
}

function normalizeSuiteIds(values?: string[]): RbacSelfCheckTestSuiteId[] {
  const selected = (values ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value): value is RbacSelfCheckTestSuiteId => SUITE_BY_ID.has(value as RbacSelfCheckTestSuiteId));
  if (selected.length > 0) return Array.from(new Set(selected));
  return RBAC_SELF_CHECK_TEST_SUITES
    .filter((suite) => suite.default_enabled)
    .map((suite) => suite.id);
}

function suiteDefinitionsFor(values?: string[]): RbacSelfCheckTestSuiteDefinition[] {
  return normalizeSuiteIds(values)
    .map((id) => SUITE_BY_ID.get(id))
    .filter((suite): suite is RbacSelfCheckTestSuiteDefinition => Boolean(suite));
}

function selfCheckIdsForSuites(suites: RbacSelfCheckTestSuiteDefinition[]): RbacSelfCheckId[] {
  const ids = suites.flatMap((suite) => SELF_CHECK_IDS_BY_SUITE[suite.id] ?? []);
  return Array.from(new Set(ids));
}

async function loadCollection<T extends Document>(collectionName: string, filter: Filter<T> = {}): Promise<T[]> {
  const collection = await getCollection<T>(collectionName);
  return (await collection.find(filter).toArray()) as T[];
}

async function readPolicyTuples(): Promise<RbacSelfCheckTestInventory["policyTuples"]> {
  const tuples: RbacSelfCheckTestInventory["policyTuples"] = [];
  let continuationToken: string | undefined;
  do {
    const page = await readOpenFgaTuples({ continuationToken, pageSize: 100 });
    tuples.push(
      ...page.tuples.map((tuple: OpenFgaTuple) => ({
        user: tuple.key.user,
        relation: tuple.key.relation,
        object: tuple.key.object,
      })),
    );
    continuationToken = page.continuationToken;
  } while (continuationToken && tuples.length < MAX_POLICY_TUPLES);
  return tuples;
}

async function loadInventory(): Promise<RbacSelfCheckTestInventory> {
  const [
    teams,
    teamMembershipSources,
    dynamicAgents,
    mcpServers,
    llmModels,
    credentialSecretRefs,
    serviceAccounts,
    slackChannelGrants,
    slackChannelTeamMappings,
    webexSpaceGrants,
    webexSpaceTeamMappings,
    skills,
    tasks,
    mcpToolCatalog,
    policyTuples,
  ] = await Promise.all([
    loadCollection<TeamDoc>("teams", { status: { $ne: "deleted" } }),
    loadCollection<TeamMembershipSourceDoc>("team_membership_sources", {
      status: "active",
      user_subject: { $exists: true, $ne: null },
    }),
    loadCollection<DynamicAgentDoc>("dynamic_agents", {
      deleted_at: { $exists: false },
      status: { $ne: "deleted" },
    }),
    loadCollection<McpServerDoc>("mcp_servers", {
      enabled: { $ne: false },
      status: { $ne: "deleted" },
    }),
    loadCollection<LlmModelDoc>("llm_models", { status: { $ne: "deleted" } }),
    loadCollection<CredentialSecretRefDoc>("credential_secret_refs"),
    loadCollection<ServiceAccountDoc>("service_accounts", { status: "active" }),
    loadCollection<MessagingGrantDoc>("slack_channel_grants", { status: "active" }),
    loadCollection<SlackTeamMappingDoc>("channel_team_mappings", { active: { $ne: false } }),
    loadCollection<MessagingGrantDoc>("webex_space_grants", { status: "active" }),
    loadCollection<WebexTeamMappingDoc>("webex_space_team_mappings", { active: { $ne: false } }),
    loadCollection<SkillDoc>("agent_skills"),
    loadCollection<TaskDoc>("task_configs"),
    loadCollection<ToolCatalogDoc>("mcp_tool_catalog"),
    readPolicyTuples(),
  ]);

  return {
    teams,
    teamMembershipSources,
    dynamicAgents,
    mcpServers,
    llmModels,
    credentialSecretRefs,
    serviceAccounts,
    slackChannelGrants,
    slackChannelTeamMappings,
    webexSpaceGrants,
    webexSpaceTeamMappings,
    skills,
    tasks,
    mcpToolCatalog,
    policyTuples,
  };
}

function subjectFromActor(actor: RbacSelfCheckTestActor): Subject | null {
  if (!actor.subject_id) return null;
  return { type: actor.subject_type, id: actor.subject_id };
}

function unresolvedActor(key: RbacSelfCheckTestActorKey, label: string, subjectType: SubjectType): RbacSelfCheckTestActor {
  return {
    key,
    label,
    subject_type: subjectType,
    source: "unresolved",
    resolved: false,
    team_slugs: [],
  };
}

function actorFromOverride(
  key: RbacSelfCheckTestActorKey,
  label: string,
  defaultSubjectType: SubjectType,
  override: ActorOverrides[RbacSelfCheckTestActorKey],
  teamSlugs: string[] = [],
): RbacSelfCheckTestActor | null {
  if (!override) return null;
  if (typeof override === "string") {
    return {
      key,
      label,
      subject_type: defaultSubjectType,
      subject_id: override,
      source: "request",
      resolved: true,
      team_slugs: teamSlugs,
    };
  }
  const subjectId = override.subject_id ?? override.id;
  if (!subjectId) return null;
  return {
    key,
    label: override.label ?? label,
    subject_type: override.subject_type ?? override.type ?? defaultSubjectType,
    subject_id: subjectId,
    source: "request",
    resolved: true,
    team_slugs: teamSlugs,
  };
}

function actorFromEnv(
  key: RbacSelfCheckTestActorKey,
  label: string,
  subjectType: SubjectType,
  envName: string,
  teamSlugs: string[] = [],
): RbacSelfCheckTestActor | null {
  const subjectId = process.env[envName]?.trim();
  if (!subjectId) return null;
  return {
    key,
    label,
    subject_type: subjectType,
    subject_id: subjectId,
    source: "env",
    resolved: true,
    team_slugs: teamSlugs,
  };
}

function activeTeamSlugs(inventory: RbacSelfCheckTestInventory): Set<string> {
  return new Set(
    inventory.teams
      .map((team) => team.slug)
      .filter(isValidOpenFgaId),
  );
}

function teamSlugsForUser(inventory: RbacSelfCheckTestInventory, subjectId: string): string[] {
  const activeTeams = activeTeamSlugs(inventory);
  return Array.from(new Set(
    inventory.teamMembershipSources
      .filter((row) => row.user_subject === subjectId)
      .filter((row) => row.relationship === "member" || row.relationship === "admin")
      .map((row) => row.team_slug)
      .filter((teamSlug): teamSlug is string => Boolean(teamSlug && activeTeams.has(teamSlug))),
  )).sort();
}

function firstMembershipSubject(inventory: RbacSelfCheckTestInventory): { subject: string; teamSlugs: string[] } | null {
  const activeTeams = activeTeamSlugs(inventory);
  for (const row of inventory.teamMembershipSources) {
    const subject = row.user_subject;
    const teamSlug = row.team_slug;
    if (!isValidOpenFgaId(subject) || !teamSlug || !activeTeams.has(teamSlug)) continue;
    if (row.relationship !== "member" && row.relationship !== "admin") continue;
    return { subject, teamSlugs: teamSlugsForUser(inventory, subject) };
  }
  return null;
}

async function resolveActors(
  options: RbacSelfCheckTestRunOptions,
  inventory: RbacSelfCheckTestInventory,
): Promise<ResolvedActors> {
  const membership = firstMembershipSubject(inventory);
  const callerTeamSlugs = options.callerSubject?.type === "user"
    ? teamSlugsForUser(inventory, options.callerSubject.id)
    : [];
  const orgAdmin = actorFromOverride("org_admin", "Org admin", "user", options.actors?.org_admin, callerTeamSlugs)
    ?? actorFromEnv("org_admin", "Org admin", "user", "RBAC_SELF_TEST_ORG_ADMIN_SUB", callerTeamSlugs)
    ?? (options.callerSubject?.type === "user"
      ? {
          key: "org_admin" as const,
          label: "Current admin",
          subject_type: "user" as const,
          subject_id: options.callerSubject.id,
          source: "session" as const,
          resolved: true,
          team_slugs: callerTeamSlugs,
        }
      : null)
    ?? unresolvedActor("org_admin", "Org admin", "user");

  const memberOverrideId = typeof options.actors?.member_user === "string"
    ? options.actors.member_user
    : options.actors?.member_user?.subject_id ?? options.actors?.member_user?.id;
  const memberTeamSlugs = memberOverrideId ? teamSlugsForUser(inventory, memberOverrideId) : membership?.teamSlugs ?? [];
  const memberUser = actorFromOverride("member_user", "Non-admin member", "user", options.actors?.member_user, memberTeamSlugs)
    ?? actorFromEnv("member_user", "Non-admin member", "user", "RBAC_SELF_TEST_MEMBER_USER_SUB", memberTeamSlugs)
    ?? (membership
      ? {
          key: "member_user" as const,
          label: "Non-admin member",
          subject_type: "user" as const,
          subject_id: membership.subject,
          source: "inventory" as const,
          resolved: true,
          team_slugs: membership.teamSlugs,
        }
      : null)
    ?? unresolvedActor("member_user", "Non-admin member", "user");

  const linkedServiceAccount = inventory.serviceAccounts.find((account) =>
    isValidOpenFgaId(account.sa_sub) && !account.is_platform_unlinked
  );
  const serviceAccount = actorFromOverride(
    "service_account",
    "Service account",
    "service_account",
    options.actors?.service_account,
  )
    ?? actorFromEnv("service_account", "Service account", "service_account", "RBAC_SELF_TEST_SERVICE_ACCOUNT_SUB")
    ?? (linkedServiceAccount?.sa_sub
      ? {
          key: "service_account" as const,
          label: linkedServiceAccount.name ?? "Service account",
          subject_type: "service_account" as const,
          subject_id: linkedServiceAccount.sa_sub,
          source: "inventory" as const,
          resolved: true,
          team_slugs: [],
        }
      : null)
    ?? unresolvedActor("service_account", "Service account", "service_account");

  const unlinkedOverride = actorFromOverride(
    "unlinked_service_account",
    "Unlinked service account",
    "service_account",
    options.actors?.unlinked_service_account,
  )
    ?? actorFromEnv(
      "unlinked_service_account",
      "Unlinked service account",
      "service_account",
      "RBAC_SELF_TEST_UNLINKED_SERVICE_ACCOUNT_SUB",
    );
  const inventoryUnlinked = inventory.serviceAccounts.find((account) =>
    isValidOpenFgaId(account.sa_sub) && account.is_platform_unlinked
  );
  const foundUnlinked = unlinkedOverride || inventoryUnlinked?.sa_sub
    ? null
    : await getUnlinkedServiceAccount().catch(() => null);
  const unlinkedServiceAccount = unlinkedOverride
    ?? (inventoryUnlinked?.sa_sub
      ? {
          key: "unlinked_service_account" as const,
          label: inventoryUnlinked.name ?? "Unlinked service account",
          subject_type: "service_account" as const,
          subject_id: inventoryUnlinked.sa_sub,
          source: "inventory" as const,
          resolved: true,
          team_slugs: [],
        }
      : null)
    ?? (foundUnlinked?.sa_sub
      ? {
          key: "unlinked_service_account" as const,
          label: foundUnlinked.name ?? "Unlinked service account",
          subject_type: "service_account" as const,
          subject_id: foundUnlinked.sa_sub,
          source: "unlinked-service-account" as const,
          resolved: true,
          team_slugs: [],
        }
      : null)
    ?? unresolvedActor("unlinked_service_account", "Unlinked service account", "service_account");

  return {
    org_admin: orgAdmin,
    member_user: memberUser,
    service_account: serviceAccount,
    unlinked_service_account: unlinkedServiceAccount,
  };
}

function normalizeAgentId(agent: DynamicAgentDoc): string {
  return String(agent._id ?? agent.id ?? "").trim();
}

function normalizeObjectId(doc: Document): string {
  return String(doc._id ?? doc.id ?? "").trim();
}

function normalizeLlmModelId(model: LlmModelDoc): string {
  return String(model.model_id ?? model._id ?? "").trim();
}

function normalizeSkillId(skill: SkillDoc): string {
  return String(skill.id ?? skill._id ?? "").trim();
}

function normalizeTaskId(task: TaskDoc): string {
  return String(task.id ?? task._id ?? "").trim();
}

function resource(
  type: UniversalRebacResourceType,
  id: string,
  label?: string,
  source?: string,
): RbacSelfCheckTestResource | null {
  if (!id.trim()) return null;
  return {
    type,
    id,
    ...(label ? { label } : {}),
    ...(source ? { source } : {}),
  };
}

function objectIdFromTuple(tupleObject: string, type: UniversalRebacResourceType): string | null {
  const prefix = `${type}:`;
  return tupleObject.startsWith(prefix) ? tupleObject.slice(prefix.length) : null;
}

function findTeamGrantedObject(
  inventory: RbacSelfCheckTestInventory,
  type: UniversalRebacResourceType,
  teamSlugs: string[],
  relations: string[],
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(teamSlugs);
  for (const tuple of inventory.policyTuples) {
    const match = /^team:([^#]+)#member$/.exec(tuple.user);
    if (!match || !teamSet.has(match[1])) continue;
    if (!relations.includes(tuple.relation)) continue;
    const id = objectIdFromTuple(tuple.object, type);
    if (id) return resource(type, id, undefined, "openfga");
  }
  return null;
}

function firstDataSourceForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const direct = findTeamGrantedObject(inventory, "data_source", member.team_slugs ?? [], ["reader", "user"]);
  if (direct) return direct;

  const kb = findTeamGrantedObject(inventory, "knowledge_base", member.team_slugs ?? [], ["reader"]);
  if (!kb) return null;
  const parentEdge = inventory.policyTuples.find((tuple) =>
    tuple.user === `knowledge_base:${kb.id}` &&
    tuple.relation === "parent_kb" &&
    tuple.object.startsWith("data_source:")
  );
  if (!parentEdge) return null;
  return resource("data_source", parentEdge.object.slice("data_source:".length), undefined, "openfga");
}

function firstAgentForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  for (const agent of inventory.dynamicAgents) {
    const agentId = normalizeAgentId(agent);
    if (!isValidOpenFgaId(agentId)) continue;
    if (agent.visibility === "global") return resource("agent", agentId, agent.name, "dynamic_agents.visibility");
    if (agent.owner_team_slug && teamSet.has(agent.owner_team_slug)) {
      return resource("agent", agentId, agent.name, "dynamic_agents.owner_team_slug");
    }
    if ((agent.shared_with_teams ?? []).some((teamSlug) => teamSet.has(teamSlug))) {
      return resource("agent", agentId, agent.name, "dynamic_agents.shared_with_teams");
    }
  }
  return null;
}

function firstAgentForServiceAccount(
  inventory: RbacSelfCheckTestInventory,
  actor: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  if (!actor.subject_id) return null;
  const account = inventory.serviceAccounts.find((candidate) => candidate.sa_sub === actor.subject_id);
  const scope = account?.scopes_snapshot?.find((candidate) => candidate.type === "agent" && isValidOpenFgaId(candidate.ref));
  if (!scope?.ref) return null;
  const agent = inventory.dynamicAgents.find((candidate) => normalizeAgentId(candidate) === scope.ref);
  return resource("agent", scope.ref, agent?.name, "service_accounts.scopes_snapshot");
}

function firstToolForServiceAccount(
  inventory: RbacSelfCheckTestInventory,
  actor: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  if (!actor.subject_id) return null;
  const account = inventory.serviceAccounts.find((candidate) => candidate.sa_sub === actor.subject_id);
  const scope = account?.scopes_snapshot?.find((candidate) => candidate.type === "tool" && typeof candidate.ref === "string");
  if (!scope?.ref) return null;
  return resource("tool", scope.ref, scope.ref, "service_accounts.scopes_snapshot");
}

function firstToolForDenyProbe(inventory: RbacSelfCheckTestInventory): RbacSelfCheckTestResource | null {
  const catalogTool = inventory.mcpToolCatalog.find((tool) =>
    isValidOpenFgaId(tool.server_id) && isValidOpenFgaId(tool.tool_id)
  );
  if (catalogTool) {
    return resource("tool", `${catalogTool.server_id}/${catalogTool.tool_id}`, catalogTool.tool_id, "mcp_tool_catalog");
  }

  const server = inventory.mcpServers
    .map((candidate) => normalizeObjectId(candidate))
    .find(isValidOpenFgaId);
  return server ? resource("tool", `${server}/*`, `${server}/*`, "mcp_servers") : null;
}

function firstPrivateCredentialForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): { target: RbacSelfCheckTestResource; expect: DecisionExpectation; detail: string } | null {
  if (!member.subject_id) return null;
  const teamSet = new Set(member.team_slugs ?? []);
  for (const secret of inventory.credentialSecretRefs) {
    if (!isValidOpenFgaId(secret.id)) continue;
    const sharedWithMemberTeam = (secret.sharedWithTeams ?? []).some((teamSlug) => teamSet.has(teamSlug));
    if (sharedWithMemberTeam) continue;
    if (secret.owner?.type === "user" && secret.owner.id === member.subject_id) {
      const target = resource("secret_ref", secret.id, secret.name, "credential_secret_refs.owner");
      return target ? { target, expect: "ALLOW", detail: "Member owns this private credential." } : null;
    }
    if (secret.owner?.type === "team" && secret.owner.id && teamSet.has(secret.owner.id)) {
      const target = resource("secret_ref", secret.id, secret.name, "credential_secret_refs.owner");
      return target ? { target, expect: "ALLOW", detail: "Member belongs to the credential owner team." } : null;
    }
    if (secret.owner?.id) {
      const target = resource("secret_ref", secret.id, secret.name, "credential_secret_refs.owner");
      return target ? { target, expect: "DENY", detail: "Credential is private to another owner/team." } : null;
    }
  }
  return null;
}

function firstSharedCredentialForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  for (const secret of inventory.credentialSecretRefs) {
    if (!isValidOpenFgaId(secret.id)) continue;
    if ((secret.sharedWithTeams ?? []).some((teamSlug) => teamSet.has(teamSlug))) {
      return resource("secret_ref", secret.id, secret.name, "credential_secret_refs.sharedWithTeams");
    }
  }
  return null;
}

function firstMcpForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  for (const server of inventory.mcpServers) {
    const serverId = normalizeObjectId(server);
    if (!isValidOpenFgaId(serverId)) continue;
    if (server.config_driven !== false || (server.owner_team_slug && teamSet.has(server.owner_team_slug))) {
      return resource("mcp_server", serverId, server.name, "mcp_servers");
    }
  }
  return null;
}

function firstConfiguredMcp(inventory: RbacSelfCheckTestInventory): RbacSelfCheckTestResource | null {
  const server = inventory.mcpServers.find((candidate) => isValidOpenFgaId(normalizeObjectId(candidate)));
  if (!server) return null;
  return resource("mcp_server", normalizeObjectId(server), server.name, "mcp_servers");
}

function firstLlmModelForMember(inventory: RbacSelfCheckTestInventory): RbacSelfCheckTestResource | null {
  const model = inventory.llmModels.find((candidate) => normalizeLlmModelId(candidate));
  if (!model) return null;
  return resource("llm_model", normalizeLlmModelId(model), model.name, "llm_models");
}

function firstAgentAllowedTool(inventory: RbacSelfCheckTestInventory): RbacSelfCheckTestResource | null {
  for (const agent of inventory.dynamicAgents) {
    for (const [serverId, tools] of Object.entries(agent.allowed_tools ?? {})) {
      if (!isValidOpenFgaId(serverId)) continue;
      const toolId = Array.isArray(tools) && tools.length > 0 && isValidOpenFgaId(tools[0])
        ? `${serverId}/${tools[0]}`
        : `${serverId}/*`;
      return resource("tool", toolId, toolId, "dynamic_agents.allowed_tools");
    }
  }
  return null;
}

function firstSkillForMember(inventory: RbacSelfCheckTestInventory, member: RbacSelfCheckTestActor): RbacSelfCheckTestResource | null {
  const teamGranted = findTeamGrantedObject(inventory, "skill", member.team_slugs ?? [], ["reader", "user"]);
  if (teamGranted) return teamGranted;
  const skill = inventory.skills.find((candidate) => isValidOpenFgaId(normalizeSkillId(candidate)));
  if (!skill) return null;
  return resource("skill", normalizeSkillId(skill), skill.name ?? skill.title, "agent_skills");
}

function firstTaskForMember(inventory: RbacSelfCheckTestInventory, member: RbacSelfCheckTestActor): RbacSelfCheckTestResource | null {
  const teamGranted = findTeamGrantedObject(inventory, "task", member.team_slugs ?? [], ["reader", "user"]);
  if (teamGranted) return teamGranted;
  const task = inventory.tasks.find((candidate) => isValidOpenFgaId(normalizeTaskId(candidate)));
  if (!task) return null;
  return resource("task", normalizeTaskId(task), task.name ?? task.title, "task_configs");
}

function firstSlackChannelForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  const mapping = inventory.slackChannelTeamMappings.find((candidate) =>
    Boolean(candidate.slack_channel_id && candidate.team_slug && teamSet.has(candidate.team_slug))
  );
  if (!mapping?.slack_channel_id) return null;
  const id = `${mapping.slack_workspace_id ?? "CAIPE"}--${mapping.slack_channel_id}`;
  return resource("slack_channel", id, id, "channel_team_mappings");
}

function firstWebexSpaceForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  const mapping = inventory.webexSpaceTeamMappings.find((candidate) =>
    Boolean(candidate.webex_space_id && candidate.team_slug && teamSet.has(candidate.team_slug))
  );
  if (!mapping?.webex_space_id) return null;
  const id = `${mapping.webex_workspace_id ?? "Cisco"}--${mapping.webex_space_id}`;
  return resource("webex_space", id, id, "webex_space_team_mappings");
}

function firstSreAgentForMember(
  inventory: RbacSelfCheckTestInventory,
  member: RbacSelfCheckTestActor,
): RbacSelfCheckTestResource | null {
  const teamSet = new Set(member.team_slugs ?? []);
  const agent = inventory.dynamicAgents.find((candidate) => {
    const text = `${candidate.name ?? ""} ${normalizeAgentId(candidate)}`.toLowerCase();
    if (!/(sre|outshift|debug)/.test(text)) return false;
    if (candidate.visibility === "global") return true;
    if (candidate.owner_team_slug && teamSet.has(candidate.owner_team_slug)) return true;
    return (candidate.shared_with_teams ?? []).some((teamSlug) => teamSet.has(teamSlug));
  });
  if (!agent) return null;
  return resource("agent", normalizeAgentId(agent), agent.name, "dynamic_agents");
}

function checkStatus(checks: RbacSelfCheckTestCheck[]): RbacSelfCheckTestCaseStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "blocked")) return "blocked";
  if (checks.length === 0 || checks.every((check) => check.status === "skip")) return "skip";
  return "pass";
}

function testCase(id: string, title: string, checks: RbacSelfCheckTestCheck[]): RbacSelfCheckTestCase {
  return {
    id,
    title,
    status: checkStatus(checks),
    checks,
  };
}

function suiteStatus(cases: RbacSelfCheckTestCase[]): RbacSelfCheckTestCaseStatus {
  if (cases.some((entry) => entry.status === "fail")) return "fail";
  if (cases.some((entry) => entry.status === "blocked")) return "blocked";
  if (cases.length === 0 || cases.every((entry) => entry.status === "skip")) return "skip";
  return "pass";
}

function suiteFromCases(
  definition: RbacSelfCheckTestSuiteDefinition,
  cases: RbacSelfCheckTestCase[],
): RbacSelfCheckTestSuite {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    status: suiteStatus(cases),
    cases,
  };
}

function skipCheck(id: string, title: string, detail: string): RbacSelfCheckTestCheck {
  return { id, title, detail, status: "skip" };
}

function blockedCheck(id: string, title: string, detail: string, fix?: string): RbacSelfCheckTestCheck {
  return { id, title, detail, status: "blocked", ...(fix ? { fix } : {}) };
}

function sourceHealthCase(
  suiteId: RbacSelfCheckTestSuiteId,
  selfCheckReport: RbacSelfCheckReport,
  selfCheckIds: RbacSelfCheckId[],
): RbacSelfCheckTestCase {
  const definitions = RBAC_SELF_CHECKS.filter((check) => selfCheckIds.includes(check.id));
  const sources = new Set(definitions.flatMap((definition) => definition.sources));
  const expected = Array.from(sources).reduce((sum, source) => sum + (selfCheckReport.expected_by_source[source] ?? 0), 0);
  const relatedFindings = selfCheckReport.findings.filter((finding) => sources.has(finding.source));
  const checks: RbacSelfCheckTestCheck[] = [];
  if (sources.size === 0) {
    checks.push(skipCheck(`${suiteId}:source-health`, "Source drift", "This suite has no source-of-truth audit slice yet."));
  } else if (expected === 0 && relatedFindings.length === 0) {
    checks.push(skipCheck(`${suiteId}:source-health`, "Source drift", "No current source records for this suite."));
  } else {
    const missing = relatedFindings.filter((finding) => finding.severity === "missing");
    const stale = relatedFindings.filter((finding) => finding.severity === "stale_reference");
    if (missing.length > 0) {
      checks.push({
        id: `${suiteId}:source-missing`,
        title: "Missing expected tuples",
        status: "fail",
        detail: `${missing.length} expected OpenFGA tuple${missing.length === 1 ? " is" : "s are"} missing for ${definitions.map((definition) => definition.label).join(", ")}.`,
        fix: "Run Repair Missing Tuples, then rerun the API matrix.",
      });
    }
    if (stale.length > 0) {
      checks.push({
        id: `${suiteId}:source-stale`,
        title: "Stale source references",
        status: "blocked",
        detail: `${stale.length} source reference${stale.length === 1 ? " points" : "s point"} at missing or deleted records.`,
        fix: "Fix the source record, restore the target resource, or remove the stale row before treating the suite as healthy.",
      });
    }
    if (checks.length === 0) {
      checks.push({
        id: `${suiteId}:source-health`,
        title: "Source drift",
        status: "pass",
        detail: `${expected} expected tuple${expected === 1 ? "" : "s"} matched live OpenFGA state.`,
      });
    }
  }
  return testCase(`${suiteId}:source-health`, "Source drift", checks);
}

async function decisionCheck(input: {
  id: string;
  title: string;
  actor: RbacSelfCheckTestActor;
  resource: RbacSelfCheckTestResource | null;
  action: string;
  expect: DecisionExpectation;
  skipDetail: string;
}): Promise<RbacSelfCheckTestCheck> {
  if (!input.actor.resolved) {
    return blockedCheck(
      input.id,
      input.title,
      `${input.actor.label} could not be resolved.`,
      `Pass actors.${input.actor.key} in the API request or set the matching RBAC_SELF_TEST_* environment variable.`,
    );
  }
  if (!input.resource) {
    return skipCheck(input.id, input.title, input.skipDetail);
  }
  if (!isResourceType(input.resource.type) || !isAction(input.action)) {
    return blockedCheck(
      input.id,
      input.title,
      `${input.resource.type}#${input.action} is not in the universal RBAC model.`,
    );
  }
  const subject = subjectFromActor(input.actor);
  if (!subject) {
    return blockedCheck(input.id, input.title, `${input.actor.label} has no subject id.`);
  }

  let result: AuthorizeResult;
  try {
    result = await authorize(
      {
        subject,
        resource: { type: input.resource.type as ResourceType, id: input.resource.id },
        action: input.action as Action,
      },
      { caller: subject },
    );
  } catch (error) {
    return {
      id: input.id,
      title: input.title,
      status: "fail",
      detail: `Authorization check threw: ${error instanceof Error ? error.message : String(error)}`,
      actor: input.actor,
      resource: input.resource,
      action: input.action,
      expected: input.expect,
      fix: "Fix the authorization service error, then rerun the API matrix.",
    };
  }

  const actual = result.decision;
  const status: RbacSelfCheckTestCaseStatus = actual === input.expect ? "pass" : "fail";
  return {
    id: input.id,
    title: input.title,
    status,
    detail: status === "pass"
      ? `${input.actor.label} ${actual === "ALLOW" ? "can" : "cannot"} ${input.action} ${input.resource.type}:${input.resource.id} as expected.`
      : `${input.actor.label} was ${actual.toLowerCase()} for ${input.resource.type}:${input.resource.id}, expected ${input.expect.toLowerCase()}. Reason: ${result.reason}.`,
    actor: input.actor,
    resource: input.resource,
    action: input.action,
    expected: input.expect,
    actual,
    ...(status === "fail" ? { fix: "Review the source record and OpenFGA tuples for this actor/resource/action path." } : {}),
  };
}

async function buildTeamSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["team_memberships"]),
    testCase("team_memberships:member-resolved", "Member actor", [
      actors.member_user.resolved && (actors.member_user.team_slugs ?? []).length > 0
        ? {
            id: "team_memberships:member-resolved",
            title: "Member actor has teams",
            status: "pass",
            detail: `${actors.member_user.label} belongs to ${(actors.member_user.team_slugs ?? []).join(", ")}.`,
            actor: actors.member_user,
          }
        : blockedCheck(
            "team_memberships:member-resolved",
            "Member actor has teams",
            "No active non-admin/member test user with team membership was found.",
            "Pass actors.member_user or create an active team_membership_sources row.",
          ),
    ]),
  ]);
}

async function buildCredentialsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const privateCredential = firstPrivateCredentialForMember(inventory, actors.member_user);
  const sharedCredential = firstSharedCredentialForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["credentials"]),
    testCase("credentials:private", "Private credential", [
      privateCredential
        ? await decisionCheck({
            id: "credentials:private:metadata",
            title: "Private credential metadata",
            actor: actors.member_user,
            resource: privateCredential.target,
            action: "read-metadata",
            expect: privateCredential.expect,
            skipDetail: "No private credential source record was found.",
          })
        : skipCheck("credentials:private:metadata", "Private credential metadata", "No private credential source record was found."),
      privateCredential
        ? {
            id: "credentials:private:classification",
            title: "Private credential expectation",
            status: "pass",
            detail: privateCredential.detail,
            resource: privateCredential.target,
          }
        : skipCheck("credentials:private:classification", "Private credential expectation", "No private credential source record was found."),
    ]),
    testCase("credentials:shared", "Shared credential", [
      await decisionCheck({
        id: "credentials:shared:metadata",
        title: "Shared credential metadata",
        actor: actors.member_user,
        resource: sharedCredential,
        action: "read-metadata",
        expect: "ALLOW",
        skipDetail: "No credential shared with the member actor's teams was found.",
      }),
      await decisionCheck({
        id: "credentials:shared:use",
        title: "Shared credential use",
        actor: actors.member_user,
        resource: sharedCredential,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No credential shared with the member actor's teams was found.",
      }),
    ]),
  ]);
}

async function buildMcpSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const memberMcp = firstMcpForMember(inventory, actors.member_user);
  const adminMcp = firstConfiguredMcp(inventory);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["mcp_servers"]),
    testCase("mcp_servers:member", "Member MCP access", [
      await decisionCheck({
        id: "mcp_servers:member:use",
        title: "Member can use MCP server",
        actor: actors.member_user,
        resource: memberMcp,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No config-driven or team-owned MCP server was found for the member actor.",
      }),
      await decisionCheck({
        id: "mcp_servers:member:invoke",
        title: "Member can invoke MCP server",
        actor: actors.member_user,
        resource: memberMcp,
        action: "invoke",
        expect: "ALLOW",
        skipDetail: "No config-driven or team-owned MCP server was found for the member actor.",
      }),
    ]),
    testCase("mcp_servers:admin", "Admin MCP management", [
      await decisionCheck({
        id: "mcp_servers:admin:manage",
        title: "Org admin can manage MCP server",
        actor: actors.org_admin,
        resource: adminMcp,
        action: "manage",
        expect: "ALLOW",
        skipDetail: "No MCP server was found.",
      }),
    ]),
  ]);
}

async function buildKnowledgeBaseSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const kb = findTeamGrantedObject(inventory, "knowledge_base", actors.member_user.team_slugs ?? [], ["reader"]);
  return suiteFromCases(definition, [
    testCase("knowledge_bases:member", "Member KB access", [
      await decisionCheck({
        id: "knowledge_bases:member:read",
        title: "Member can read shared KB",
        actor: actors.member_user,
        resource: kb,
        action: "read",
        expect: "ALLOW",
        skipDetail: "No knowledge_base reader tuple was found for the member actor's teams.",
      }),
    ]),
  ]);
}

async function buildDataSourceSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const dataSource = firstDataSourceForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    testCase("data_sources:member", "Member data-source access", [
      await decisionCheck({
        id: "data_sources:member:read",
        title: "Member can read shared data source",
        actor: actors.member_user,
        resource: dataSource,
        action: "read",
        expect: "ALLOW",
        skipDetail: "No data_source grant or KB parent edge was found for the member actor's teams.",
      }),
    ]),
  ]);
}

async function buildAgentsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const memberAgent = firstAgentForMember(inventory, actors.member_user);
  const serviceAccountAgent = firstAgentForServiceAccount(inventory, actors.service_account);
  const anyAgent = inventory.dynamicAgents
    .map((agent) => resource("agent", normalizeAgentId(agent), agent.name, "dynamic_agents"))
    .find((candidate): candidate is RbacSelfCheckTestResource => Boolean(candidate)) ?? null;
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["agent_access"]),
    testCase("agents:member", "Member agent access", [
      await decisionCheck({
        id: "agents:member:use",
        title: "Member can use shared/global agent",
        actor: actors.member_user,
        resource: memberAgent,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No agent was global or shared with the member actor's teams.",
      }),
    ]),
    testCase("agents:service-account", "Service-account agent scope", [
      await decisionCheck({
        id: "agents:service-account:use",
        title: "Service account can use scoped agent",
        actor: actors.service_account,
        resource: serviceAccountAgent,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No linked service account has an agent scope snapshot.",
      }),
      await decisionCheck({
        id: "agents:unlinked-service-account:use",
        title: "Unlinked service account cannot use arbitrary agent",
        actor: actors.unlinked_service_account,
        resource: anyAgent,
        action: "use",
        expect: "DENY",
        skipDetail: "No agent was found for unlinked service-account deny probe.",
      }),
    ]),
  ]);
}

async function buildAgentToolsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const serviceAccountTool = firstToolForServiceAccount(inventory, actors.service_account);
  const denyProbeTool = firstToolForDenyProbe(inventory);
  const agentTool = firstAgentAllowedTool(inventory);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["agent_tools"]),
    testCase("agent_tools:service-account", "Service-account tool scope", [
      await decisionCheck({
        id: "agent_tools:service-account:call",
        title: "Service account can call scoped tool",
        actor: actors.service_account,
        resource: serviceAccountTool,
        action: "call",
        expect: "ALLOW",
        skipDetail: "No linked service account has a tool scope snapshot.",
      }),
      await decisionCheck({
        id: "agent_tools:unlinked-service-account:call",
        title: "Unlinked service account cannot call arbitrary tool",
        actor: actors.unlinked_service_account,
        resource: denyProbeTool,
        action: "call",
        expect: "DENY",
        skipDetail: "No MCP tool or server wildcard was found for an unlinked service-account deny probe.",
      }),
      agentTool
        ? {
            id: "agent_tools:agent-configured-tool",
            title: "Agent configured tool",
            status: "pass",
            detail: `Found agent tool grant target ${agentTool.type}:${agentTool.id}. Agent-principal checks are validated by the OpenFGA tuple audit because CAS subjects are users/service accounts.`,
            resource: agentTool,
          }
        : skipCheck("agent_tools:agent-configured-tool", "Agent configured tool", "No dynamic agent has allowed_tools configured."),
    ]),
  ]);
}

async function buildSkillsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const skill = firstSkillForMember(inventory, actors.member_user);
  const teamGranted = skill?.source === "openfga";
  return suiteFromCases(definition, [
    testCase("skills:member", "Member skill access", [
      teamGranted
        ? await decisionCheck({
            id: "skills:member:use",
            title: "Member can use shared skill",
            actor: actors.member_user,
            resource: skill,
            action: "use",
            expect: "ALLOW",
            skipDetail: "No skill grant was found for the member actor's teams.",
          })
        : skipCheck("skills:member:use", "Member can use shared skill", "No skill OpenFGA grant was found for the member actor's teams."),
    ]),
  ]);
}

async function buildLlmSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const model = firstLlmModelForMember(inventory);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["llm_models"]),
    testCase("llm_models:member", "Member model access", [
      await decisionCheck({
        id: "llm_models:member:read",
        title: "Member can read model",
        actor: actors.member_user,
        resource: model,
        action: "read",
        expect: "ALLOW",
        skipDetail: "No LLM model was found.",
      }),
    ]),
    testCase("llm_models:admin", "Admin model management", [
      await decisionCheck({
        id: "llm_models:admin:manage",
        title: "Org admin can manage model",
        actor: actors.org_admin,
        resource: model,
        action: "manage",
        expect: "ALLOW",
        skipDetail: "No LLM model was found.",
      }),
    ]),
  ]);
}

async function buildServiceAccountsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const gateway = resource("mcp_gateway", "list", "MCP gateway list", "service_accounts.gateway_baseline");
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["service_accounts"]),
    testCase("service_accounts:gateway", "Gateway baseline", [
      await decisionCheck({
        id: "service_accounts:linked:gateway",
        title: "Linked service account can call gateway list",
        actor: actors.service_account,
        resource: gateway,
        action: "call",
        expect: "ALLOW",
        skipDetail: "No gateway resource was found.",
      }),
      await decisionCheck({
        id: "service_accounts:unlinked:gateway",
        title: "Unlinked service account has gateway baseline only",
        actor: actors.unlinked_service_account,
        resource: gateway,
        action: "call",
        expect: "ALLOW",
        skipDetail: "No gateway resource was found.",
      }),
    ]),
  ]);
}

async function buildSlackSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const channel = firstSlackChannelForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["slack"]),
    testCase("slack:member", "Member Slack channel access", [
      await decisionCheck({
        id: "slack:member:use",
        title: "Member can use mapped Slack channel",
        actor: actors.member_user,
        resource: channel,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No Slack channel mapping was found for the member actor's teams.",
      }),
    ]),
  ]);
}

async function buildWebexSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const space = firstWebexSpaceForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    sourceHealthCase(definition.id, report, ["webex"]),
    testCase("webex:member", "Member Webex space access", [
      await decisionCheck({
        id: "webex:member:use",
        title: "Member can use mapped Webex space",
        actor: actors.member_user,
        resource: space,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No Webex space mapping was found for the member actor's teams.",
      }),
    ]),
  ]);
}

async function buildWorkflowsSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const task = firstTaskForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    testCase("workflows:member", "Member workflow/task access", [
      task?.source === "openfga"
        ? await decisionCheck({
            id: "workflows:member:use",
            title: "Member can use shared task/workflow",
            actor: actors.member_user,
            resource: task,
            action: "use",
            expect: "ALLOW",
            skipDetail: "No task/workflow grant was found for the member actor's teams.",
          })
        : skipCheck("workflows:member:use", "Member can use shared task/workflow", "No task/workflow OpenFGA grant was found for the member actor's teams."),
    ]),
  ]);
}

async function buildChatSreSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  const agent = firstSreAgentForMember(inventory, actors.member_user);
  return suiteFromCases(definition, [
    testCase("chat_sre_agent:member", "Member SRE chat access", [
      await decisionCheck({
        id: "chat_sre_agent:member:use",
        title: "Member can chat with SRE agent",
        actor: actors.member_user,
        resource: agent,
        action: "use",
        expect: "ALLOW",
        skipDetail: "No SRE/Outshift debug agent shared with the member actor was found.",
      }),
    ]),
  ]);
}

async function buildCustomAssertionsSuite(
  assertions: RbacSelfCheckAssertionInput[] | undefined,
): Promise<RbacSelfCheckTestSuite | null> {
  if (!assertions || assertions.length === 0) return null;
  const definition: RbacSelfCheckTestSuiteDefinition = {
    id: "custom_assertions",
    label: "Custom assertions",
    description: "Caller-supplied allow/deny checks, useful for Playwright and CI lifecycle tests.",
    default_enabled: false,
  };
  const cases: RbacSelfCheckTestCase[] = [];
  for (let index = 0; index < assertions.length; index += 1) {
    const assertion = assertions[index];
    const actor: RbacSelfCheckTestActor = {
      key: assertion.actor.type === "service_account" ? "service_account" : "member_user",
      label: assertion.actor.label ?? assertion.actor.id,
      subject_type: assertion.actor.type,
      subject_id: assertion.actor.id,
      source: "request",
      resolved: true,
      team_slugs: [],
    };
    const target = isResourceType(assertion.resource.type)
      ? resource(assertion.resource.type, assertion.resource.id, assertion.resource.label, "request")
      : null;
    cases.push(testCase(assertion.id ?? `custom:${index}`, assertion.title ?? `${assertion.actor.id} ${assertion.action} ${assertion.resource.type}:${assertion.resource.id}`, [
      await decisionCheck({
        id: assertion.id ?? `custom:${index}:decision`,
        title: assertion.title ?? "Custom authorization assertion",
        actor,
        resource: target,
        action: assertion.action,
        expect: assertion.expect,
        skipDetail: "Custom assertion target was invalid.",
      }),
    ]));
  }
  return suiteFromCases(definition, cases);
}

async function buildSuite(
  definition: RbacSelfCheckTestSuiteDefinition,
  report: RbacSelfCheckReport,
  inventory: RbacSelfCheckTestInventory,
  actors: ResolvedActors,
): Promise<RbacSelfCheckTestSuite> {
  switch (definition.id) {
    case "team_memberships":
      return buildTeamSuite(definition, report, actors);
    case "credentials":
      return buildCredentialsSuite(definition, report, inventory, actors);
    case "mcp_servers":
      return buildMcpSuite(definition, report, inventory, actors);
    case "data_sources":
      return buildDataSourceSuite(definition, inventory, actors);
    case "knowledge_bases":
      return buildKnowledgeBaseSuite(definition, inventory, actors);
    case "agents":
      return buildAgentsSuite(definition, report, inventory, actors);
    case "agent_tools":
      return buildAgentToolsSuite(definition, report, inventory, actors);
    case "skills":
      return buildSkillsSuite(definition, inventory, actors);
    case "llm_models":
      return buildLlmSuite(definition, report, inventory, actors);
    case "service_accounts":
      return buildServiceAccountsSuite(definition, report, actors);
    case "slack":
      return buildSlackSuite(definition, report, inventory, actors);
    case "webex":
      return buildWebexSuite(definition, report, inventory, actors);
    case "workflows":
      return buildWorkflowsSuite(definition, inventory, actors);
    case "chat_sre_agent":
      return buildChatSreSuite(definition, inventory, actors);
    case "custom_assertions":
      return suiteFromCases(definition, []);
  }
}

function summarize(suites: RbacSelfCheckTestSuite[], durationMs: number) {
  const checks = suites.flatMap((suite) => suite.cases.flatMap((entry) => entry.checks));
  return {
    suites: suites.length,
    cases: suites.reduce((sum, suite) => sum + suite.cases.length, 0),
    checks: checks.length,
    passed: checks.filter((check) => check.status === "pass").length,
    failed: checks.filter((check) => check.status === "fail").length,
    blocked: checks.filter((check) => check.status === "blocked").length,
    skipped: checks.filter((check) => check.status === "skip").length,
    duration_ms: durationMs,
  };
}

function reportStatus(summary: ReturnType<typeof summarize>, selfCheckStatus: RbacSelfCheckReport["status"]): RbacSelfCheckReport["status"] {
  if (summary.failed > 0 || selfCheckStatus === "fail") return "fail";
  if (summary.blocked > 0 || selfCheckStatus === "warn") return "warn";
  return "pass";
}

function emptySelfCheckReport(): RbacSelfCheckReport {
  return {
    generated_at: new Date().toISOString(),
    status: "pass",
    inventory: {
      mongo: {},
      openfga_tuple_count: 0,
      openfga_tuples_by_object_type: {},
      organization_capability_tuples: [],
    },
    summary: {
      expected_tuples: 0,
      missing_tuples: 0,
      stale_references: 0,
      orphan_candidates: 0,
      repairable_findings: 0,
      total_findings: 0,
    },
    expected_by_source: {},
    missing_by_source: {},
    findings: [],
    repair_batches: [],
    notes: [],
  };
}

export async function runRbacSelfCheckTests(
  options: RbacSelfCheckTestRunOptions = {},
): Promise<RbacSelfCheckTestReport> {
  const startedAt = Date.now();
  const suiteDefinitions = suiteDefinitionsFor(options.suites).filter((suite) => suite.id !== "custom_assertions");
  const selfCheckIds = selfCheckIdsForSuites(suiteDefinitions);
  const shouldRunSourceAudit = suiteDefinitions.length > 0;
  const [inventory, selfCheckReport] = await Promise.all([
    loadInventory(),
    shouldRunSourceAudit
      ? runRbacSelfCheck({ checks: selfCheckIds.length > 0 ? selfCheckIds : undefined })
      : Promise.resolve(emptySelfCheckReport()),
  ]);
  const actors = await resolveActors(options, inventory);
  const suites = await Promise.all(
    suiteDefinitions.map((definition) => buildSuite(definition, selfCheckReport, inventory, actors)),
  );
  const customSuite = await buildCustomAssertionsSuite(options.assertions);
  if (customSuite) suites.push(customSuite);

  const summary = summarize(suites, Date.now() - startedAt);
  const status = reportStatus(summary, selfCheckReport.status);
  return {
    generated_at: new Date().toISOString(),
    status,
    summary,
    actors: [
      actors.org_admin,
      actors.member_user,
      actors.service_account,
      actors.unlinked_service_account,
    ],
    suites,
    self_check_status: selfCheckReport.status,
    notes: [
      "The API matrix is read-only; it never creates, repairs, or revokes tuples.",
      "Built-in suites skip checks when the current database has no representative resource.",
      "CI can post custom assertions after creating/sharing resources to prove exact allow/deny expectations.",
    ],
  };
}

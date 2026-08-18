import { NextRequest, NextResponse } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getConfig } from "@/lib/config";
import { getCollection } from "@/lib/mongodb";
import {
  batchCheckOpenFgaTuples,
  checkOpenFgaTuple,
  listOpenFgaObjects,
} from "@/lib/rbac/openfga";
import { organizationObjectId } from "@/lib/rbac/organization";
import { subjectFromSession } from "@/lib/rbac/resource-authz";
import {
  createJsonResponseCacheStore,
  envTtlMs,
  withJsonResponseCache,
} from "@/lib/server-response-cache";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Only the header's `?summary=true` hot path is cached. `withJsonResponseCache`
// keys on the URL plus a hash of the authorization/cookie headers, so entries
// are per-session. The list responses stay uncached on purpose: they back the
// Automation panel, whose `autonomous_enabled` changes on toggle, and a cached
// list would render stale state immediately after a write.
const summaryCache = createJsonResponseCacheStore();

export interface AutonomousAgentSummary {
  id: string;
  name: string;
  owner_team_slug: string | null;
}

export interface AutomatableAgent extends AutonomousAgentSummary {
  autonomous_enabled: boolean;
}

interface AgentDoc {
  _id: string;
  name?: string;
  owner_team_slug?: string;
}

/** Strip the OpenFGA `type:` prefix from a ListObjects result. */
function stripPrefix(objects: string[], prefix: string): string[] {
  return objects
    .filter((o) => o.startsWith(prefix))
    .map((o) => o.slice(prefix.length))
    .filter((id) => id.length > 0);
}

function toSummary(doc: AgentDoc): AutonomousAgentSummary {
  return {
    id: String(doc._id),
    name: typeof doc.name === "string" && doc.name ? doc.name : String(doc._id),
    owner_team_slug:
      typeof doc.owner_team_slug === "string" && doc.owner_team_slug ? doc.owner_team_slug : null,
  };
}

/**
 * Agent ids the caller may schedule autonomous tasks against.
 * `can_schedule` is `automator and can_use`, so this set is inherently small
 * even for platform admins -- no pagination needed.
 */
async function schedulableAgentIds(openFgaUser: string): Promise<string[]> {
  const result = await listOpenFgaObjects({
    user: openFgaUser,
    relation: "can_schedule",
    type: "agent",
  });
  return stripPrefix(result.objects, "agent:");
}

/**
 * Layer 1 eligibility: is the caller a member of ANY autonomous-eligible team
 * (or an org admin)? `organization#can_automate` is defined as
 * `automation_eligible or admin`, and `automation_eligible` is granted to
 * `team#member` / `team#admin`, so this single check answers it.
 *
 * This -- not `can_schedule` -- gates the Autonomous nav entry. A member of an
 * eligible team must be able to reach the page even before a team admin has
 * enabled any individual agent, so the page can tell them what to ask for.
 */
async function isAutonomousEligible(openFgaUser: string): Promise<boolean> {
  const decision = await checkOpenFgaTuple({
    user: openFgaUser,
    relation: "can_automate",
    object: organizationObjectId(),
  });
  return decision.allowed;
}

/** Team slugs the caller administers. Drives the Layer 2 enablement surface. */
async function adminTeamSlugs(openFgaUser: string): Promise<string[]> {
  const result = await listOpenFgaObjects({
    user: openFgaUser,
    relation: "admin",
    type: "team",
  });
  return stripPrefix(result.objects, "team:");
}

/**
 * Real `automator` state per agent -- a batched read of
 * `team:<owner>#member -> automator -> agent:<id>`. The Agents page used to
 * infer this from `can_schedule`, which conflates Layer 2 enablement with the
 * caller's own Layer 3 access.
 */
async function readAutonomousEnabled(agents: AutonomousAgentSummary[]): Promise<boolean[]> {
  const withTeam = agents.filter((a) => a.owner_team_slug);
  if (withTeam.length === 0) return agents.map(() => false);
  const results = await batchCheckOpenFgaTuples(
    withTeam.map((a) => ({
      user: `team:${a.owner_team_slug}#member`,
      relation: "automator",
      object: `agent:${a.id}`,
    })),
  );
  const byId = new Map(withTeam.map((a, i) => [a.id, Boolean(results[i])]));
  return agents.map((a) => byId.get(a.id) ?? false);
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  if (request.nextUrl.searchParams.get("summary") !== "true") {
    return resolveAgents(request);
  }
  return withJsonResponseCache(request, summaryCache, () => resolveAgents(request), {
    ttlMs: envTtlMs("AUTONOMOUS_CAPABILITY_CACHE_TTL_MS", 10_000),
    maxEntries: 512,
  });
});

async function resolveAgents(request: NextRequest): Promise<NextResponse> {
  if (!getConfig("autonomousAgentsEnabled")) {
    throw new ApiError("Autonomous agents are disabled", 404);
  }

  const { session } = await getAuthFromBearerOrSession(request);
  // Already namespaced -- "user:<sub>", or "service_account:<sub>" for
  // client-credentials callers. Do NOT re-prefix it: OpenFGA rejects
  // "user:user:<sub>" with a 400 malformed-user validation error, which would
  // silently fall into the fail-closed branch below and hide the whole feature.
  const openFgaUser = subjectFromSession(session);
  if (!openFgaUser) {
    // No resolvable Keycloak subject means no authorizable identity. Fail
    // closed rather than guessing from the email.
    return successResponse({
      schedulable: [],
      automatable: [],
      automatable_total: 0,
      eligible: false,
      can_manage_automation: false,
    });
  }

  const params = request.nextUrl.searchParams;
  const summaryOnly = params.get("summary") === "true";
  const search = (params.get("search") ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(
      1,
      Number.parseInt(params.get("page_size") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE,
    ),
  );

  // Fail closed on any authorization backend failure: an errored check must
  // never widen access, and must never render an empty page as "you have
  // nothing" when the truth is "we could not tell".
  const isPlatformAdmin = session.role === "admin";

  // The summary path only needs the two visibility booleans, so it skips the
  // schedulable-agent lookup entirely -- one org check plus one team lookup.
  let eligible = false;
  let teamSlugs: string[] = [];
  let scheduleIds: string[] = [];
  try {
    [eligible, teamSlugs, scheduleIds] = await Promise.all([
      isAutonomousEligible(openFgaUser),
      adminTeamSlugs(openFgaUser),
      summaryOnly ? Promise.resolve([] as string[]) : schedulableAgentIds(openFgaUser),
    ]);
  } catch (error) {
    console.warn("[autonomous/agents] authorization lookup failed:", error);
    return successResponse({
      schedulable: [],
      automatable: [],
      automatable_total: 0,
      eligible: false,
      can_manage_automation: false,
    });
  }

  // Layer 2 surface: anyone who administers a team (or the platform) may manage
  // per-agent enablement. Deliberately NOT gated on owning any agent yet -- a
  // team admin with no agents still gets the tab, showing its own empty state.
  const canManageAutomation = isPlatformAdmin || teamSlugs.length > 0;

  if (summaryOnly) {
    return successResponse({ eligible, can_manage_automation: canManageAutomation });
  }

  const agents = await getCollection<AgentDoc>("dynamic_agents");

  // Platform admins may enable autonomous on any agent that has an owner team;
  // everyone else is limited to agents owned by a team they administer.
  const automatableFilter = isPlatformAdmin
    ? { owner_team_slug: { $exists: true, $nin: [null, ""] } }
    : { owner_team_slug: { $in: teamSlugs } };
  const searchFilter = search
    ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
    : {};
  const automatableQuery = { ...automatableFilter, ...searchFilter };
  const hasAutomatableScope = canManageAutomation;

  const [scheduleDocs, automatableDocs, automatableTotal] = await Promise.all([
    scheduleIds.length > 0
      ? agents
          .find({ _id: { $in: scheduleIds } } as never)
          .project({ name: 1, owner_team_slug: 1 })
          .sort({ name: 1 })
          .toArray()
      : Promise.resolve([] as AgentDoc[]),
    hasAutomatableScope
      ? agents
          .find(automatableQuery as never)
          .project({ name: 1, owner_team_slug: 1 })
          .sort({ name: 1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .toArray()
      : Promise.resolve([] as AgentDoc[]),
    hasAutomatableScope ? agents.countDocuments(automatableQuery as never) : Promise.resolve(0),
  ]);

  const schedulable = (scheduleDocs as AgentDoc[]).map(toSummary);
  const automatableSummaries = (automatableDocs as AgentDoc[]).map(toSummary);
  const enabledFlags = await readAutonomousEnabled(automatableSummaries);
  const automatable: AutomatableAgent[] = automatableSummaries.map((a, i) => ({
    ...a,
    autonomous_enabled: enabledFlags[i],
  }));

  return successResponse({
    schedulable,
    automatable,
    automatable_total: automatableTotal,
    eligible,
    can_manage_automation: canManageAutomation,
  });
}

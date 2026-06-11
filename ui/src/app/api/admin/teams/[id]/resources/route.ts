/**
 * Spec 104 — Team-scoped RBAC: resource assignment endpoint.
 *
 * GET  /api/admin/teams/[id]/resources
 *   → returns the agents and tools currently assigned to the team plus the
 *     full picker catalog (`available.agents`, `available.tools`) so the UI
 *     can render checkboxes without a second round-trip.
 *
 * PUT  /api/admin/teams/[id]/resources
 *   body: { agents: string[]; tools: string[] }
 *   - Persists the selection on the team document (`team.resources`).
 *   - Reconciles OpenFGA relationship tuples for team → resource access.
 *
 * Keycloak is intentionally not updated for per-resource grants. Realm roles
 * such as `agent_user:<id>` and `tool_user:<prefix>` are legacy artifacts; the
 * OpenFGA tuple store is the resource PDP.
 */

import {
ApiError,
getAuthFromBearerOrSession,
requireRbacPermission,
successResponse,
withErrorHandler,
} from "@/lib/api-middleware";
import { getCollection,isMongoDBConfigured } from "@/lib/mongodb";
import {
findUserIdByEmail,
} from "@/lib/rbac/keycloak-admin";
import {
buildTeamResourceTupleDiff,
writeOpenFgaTupleDiff,
} from "@/lib/rbac/openfga";
import { requireTeamMembershipManagementPermission } from "@/lib/rbac/team-admin-guards";
import { loadActiveTeamMembers } from "@/lib/rbac/team-membership-store";
import type { Team } from "@/types/teams";
import { ObjectId } from "mongodb";
import { NextRequest,NextResponse } from "next/server";

interface DynamicAgentLite {
  _id: string;
  name?: string;
  description?: string;
  visibility?: string;
  enabled?: boolean;
}

interface MCPServerLite {
  _id: string;
  name?: string;
  description?: string;
  enabled?: boolean;
}

interface SkillLite {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  enabled?: boolean;
}

interface SkillHubLite {
  id?: string;
  enabled?: boolean;
}

interface HubSkillLite {
  hub_id?: string;
  skill_id?: string;
  name?: string;
  description?: string;
}

interface TaskLite {
  _id?: string;
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  enabled?: boolean;
}

function requireMongoDB() {
  if (!isMongoDBConfigured) {
    return NextResponse.json(
      {
        success: false,
        error: "MongoDB not configured - team resources require MongoDB",
        code: "MONGODB_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }
  return null;
}

function parseTeamId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) {
    throw new ApiError("Invalid team ID format", 400);
  }
  return new ObjectId(id);
}

function diff(prev: string[], next: string[]): { added: string[]; removed: string[] } {
  const prevSet = new Set(prev);
  const nextSet = new Set(next);
  return {
    added: next.filter((x) => !prevSet.has(x)),
    removed: prev.filter((x) => !nextSet.has(x)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — current selection + available picker catalog
// ─────────────────────────────────────────────────────────────────────────────

export const GET = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);
    await requireRbacPermission(session, "team", "view");

      const { id } = await context.params;
      const teamId = parseTeamId(id);

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      const agentsCol = await getCollection<DynamicAgentLite>("dynamic_agents");
      const mcpCol = await getCollection<MCPServerLite>("mcp_servers");
      const skillsCol = await getCollection<SkillLite>("skills");
      const skillHubsCol = await getCollection<SkillHubLite>("skill_hubs");
      const hubSkillsCol = await getCollection<HubSkillLite>("hub_skills");
      const tasksCol = await getCollection<TaskLite>("task_configs");
      const ownershipCol = await getCollection<{ kb_ids?: string[]; kb_permissions?: Record<string, string> }>(
        "team_kb_ownership"
      );

      const [allAgents, allServers, allSkills, enabledHubs, allHubSkills, allTasks, ownership] = await Promise.all([
        agentsCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1, visibility: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as DynamicAgentLite[]),
        mcpCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, name: 1, description: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as MCPServerLite[]),
        skillsCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, id: 1, name: 1, title: 1, description: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as SkillLite[]),
        skillHubsCol
          .find({ enabled: { $ne: false } } as never, { projection: { id: 1, enabled: 1 } })
          .sort({ id: 1 })
          .toArray()
          .catch(() => [] as SkillHubLite[]),
        hubSkillsCol
          .find({}, { projection: { hub_id: 1, skill_id: 1, name: 1, description: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as HubSkillLite[]),
        tasksCol
          .find({ enabled: { $ne: false } } as never, { projection: { _id: 1, id: 1, name: 1, title: 1, description: 1 } })
          .sort({ name: 1 })
          .toArray()
          .catch(() => [] as TaskLite[]),
        ownershipCol.find({}).sort({}).toArray().catch(() => []),
      ]);

      // We render tools by MCP server prefix (e.g. `jira_*`) and persist those
      // prefixes directly as OpenFGA tool objects.
      const toolPrefixes = allServers.map((s) => `${s._id}_*`);
      const kbIds = new Set<string>();
      for (const row of ownership) {
        for (const id of row.kb_ids ?? []) kbIds.add(id);
        for (const id of Object.keys(row.kb_permissions ?? {})) kbIds.add(id);
      }
      const enabledHubIds = new Set(
        enabledHubs.map((hub) => hub.id).filter((id): id is string => Boolean(id))
      );
      const hubSkillOptions = allHubSkills
        .filter((skill) => skill.hub_id && skill.skill_id && enabledHubIds.has(skill.hub_id))
        .map((skill) => ({
          id: `hub-${skill.hub_id}-${skill.skill_id}`,
          name: skill.name ?? skill.skill_id ?? "",
          description: skill.description ?? "",
        }));
      const configuredSkillOptions = allSkills.map((s) => {
        const id = String(s.id ?? s._id ?? s.name);
        return { id, name: s.name ?? s.title ?? id, description: s.description ?? "" };
      });
      const skillOptions = [...configuredSkillOptions, ...hubSkillOptions].sort((a, b) =>
        a.name.localeCompare(b.name)
      );

      const resources = team.resources ?? {};

      console.log(
        `[Admin TeamResources] GET team=${id} agents=${(resources.agents ?? []).length} agent_admins=${(resources.agent_admins ?? []).length} tools=${(resources.tools ?? []).length} wildcard=${resources.tool_wildcard ? "yes" : "no"} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        resources: {
          agents: resources.agents ?? [],
          agent_admins: resources.agent_admins ?? [],
          tools: resources.tools ?? [],
          knowledge_bases: resources.knowledge_bases ?? [],
          skills: resources.skills ?? [],
          tasks: resources.tasks ?? [],
          tool_wildcard: Boolean(resources.tool_wildcard),
        },
        available: {
          agents: allAgents.map((a) => ({ id: a._id, name: a.name ?? a._id, description: a.description ?? "" })),
          tools: toolPrefixes.map((id, i) => ({
            id,
            name: id,
            description: allServers[i].description ?? "",
          })),
          knowledge_bases: Array.from(kbIds).sort().map((id) => ({ id, name: id, description: "" })),
          skills: skillOptions,
          tasks: allTasks.map((t) => {
            const id = String(t.id ?? t._id ?? t.name);
            return { id, name: t.name ?? t.title ?? id, description: t.description ?? "" };
          }),
        },
      });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT — persist selection + reconcile OpenFGA tuples
// ─────────────────────────────────────────────────────────────────────────────

interface PutBody {
  agents?: unknown;
  agent_admins?: unknown;
  tools?: unknown;
  knowledge_bases?: unknown;
  skills?: unknown;
  tasks?: unknown;
  tool_wildcard?: unknown;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ApiError(`${field} must be an array of strings`, 400);
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ApiError(`${field} must be an array of non-empty strings`, 400);
    }
    out.push(item.trim());
  }
  // Dedup while preserving order — the UI sends checkbox state that is
  // already unique, but defence-in-depth keeps Mongo+KC clean.
  return Array.from(new Set(out));
}

export const PUT = withErrorHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const mongoCheck = requireMongoDB();
    if (mongoCheck) return mongoCheck;

    const { user, session } = await getAuthFromBearerOrSession(request);

      const { id } = await context.params;
      const teamId = parseTeamId(id);

      let body: PutBody;
      try {
        body = (await request.json()) as PutBody;
      } catch {
        throw new ApiError("Invalid JSON body", 400);
      }

      const nextAgents = parseStringArray(body.agents ?? [], "agents");
      const nextAgentAdmins = parseStringArray(body.agent_admins ?? [], "agent_admins");
      const nextTools = parseStringArray(body.tools ?? [], "tools");
      const nextToolWildcard = Boolean(body.tool_wildcard);

      const teamsCol = await getCollection<Team>("teams");
      const team = await teamsCol.findOne({ _id: teamId } as never);
      if (!team) throw new ApiError("Team not found", 404);

      // Issue #1509: scoped team admins can manage resources on their own
      // team without platform-wide `organization:<org>#admin`.
      await requireTeamMembershipManagementPermission(session, user.email, team);

      const prevAgents = team.resources?.agents ?? [];
      const prevAgentAdmins = team.resources?.agent_admins ?? [];
      const prevTools = team.resources?.tools ?? [];
      const prevKnowledgeBases = team.resources?.knowledge_bases ?? [];
      const prevSkills = team.resources?.skills ?? [];
      const prevTasks = team.resources?.tasks ?? [];
      const prevToolWildcard = Boolean(team.resources?.tool_wildcard);
      const nextKnowledgeBases =
        body.knowledge_bases === undefined
          ? prevKnowledgeBases
          : parseStringArray(body.knowledge_bases, "knowledge_bases");
      const nextSkills =
        body.skills === undefined ? prevSkills : parseStringArray(body.skills, "skills");
      const nextTasks = body.tasks === undefined ? prevTasks : parseStringArray(body.tasks, "tasks");

      const agentDiff = diff(prevAgents, nextAgents);
      const agentAdminDiff = diff(prevAgentAdmins, nextAgentAdmins);
      const toolDiff = diff(prevTools, nextTools);
      const knowledgeBaseDiff = diff(prevKnowledgeBases, nextKnowledgeBases);
      const skillDiff = diff(prevSkills, nextSkills);
      const taskDiff = diff(prevTasks, nextTasks);
      const wildcardAdded = !prevToolWildcard && nextToolWildcard;
      const wildcardRemoved = prevToolWildcard && !nextToolWildcard;

      // ── 1. Resolve current member subjects for OpenFGA team membership.
      //
      //    Member list comes from the canonical team_membership_sources
      //    store (post 2026-05-26 canonical-membership refactor); deduped
      //    by identity, status:"active" only. A team can have a member
      //    email that doesn't have a Keycloak account yet (e.g. invited
      //    but never logged in). We log + skip those rather than failing
      //    the whole PUT — the UI flags them in the response. Subject-
      //    only rows (no email) are also skipped because Keycloak lookup
      //    is by email.
      const canonicalMembers = await loadActiveTeamMembers(team.slug ?? "");
      const memberEmails: string[] = canonicalMembers
        .map((m) => m.user_email)
        .filter((email): email is string => typeof email === "string" && email.length > 0);
      const skippedMembers: string[] = [];
      const resolvedMembers: string[] = [];
      const resolvedMemberUserIds: string[] = [];

      for (const memberEmail of memberEmails) {
        const userId = await findUserIdByEmail(memberEmail);
        if (!userId) {
          skippedMembers.push(memberEmail);
          continue;
        }
        resolvedMemberUserIds.push(userId);
        resolvedMembers.push(memberEmail);
      }

      // ── 2. Reconcile OpenFGA ReBAC tuples before Mongo persistence.
      //
      //    OpenFGA owns relationship facts. Fail before Mongo if the remote
      //    PDP state cannot be reconciled.
      // assisted-by Codex Codex-sonnet-4-6
      // Treat Save as authoritative: selected resources are desired writes,
      // and the OpenFGA writer filters tuples that already exist.
      const tupleDiffInput = {
        teamSlug: team.slug || id,
        memberUserIds: resolvedMemberUserIds,
        agents: { added: nextAgents, removed: agentDiff.removed },
        agentAdmins: { added: nextAgentAdmins, removed: agentAdminDiff.removed },
        tools: { added: nextTools, removed: toolDiff.removed },
        toolWildcard: {
          added: nextToolWildcard,
          removed: wildcardRemoved,
        },
      };
      if (
        body.knowledge_bases !== undefined ||
        prevKnowledgeBases.length > 0 ||
        nextKnowledgeBases.length > 0
      ) {
        Object.assign(tupleDiffInput, {
          knowledgeBases: { added: nextKnowledgeBases, removed: knowledgeBaseDiff.removed },
        });
      }
      if (body.skills !== undefined || prevSkills.length > 0 || nextSkills.length > 0) {
        Object.assign(tupleDiffInput, {
          skills: { added: nextSkills, removed: skillDiff.removed },
        });
      }
      if (body.tasks !== undefined || prevTasks.length > 0 || nextTasks.length > 0) {
        Object.assign(tupleDiffInput, {
          tasks: { added: nextTasks, removed: taskDiff.removed },
        });
      }
      const openFgaTupleDiff = buildTeamResourceTupleDiff(tupleDiffInput);
      const openfga = await writeOpenFgaTupleDiff(openFgaTupleDiff);

      // ── 3. Persist selection on the team document.
      const now = new Date();
      const nextResources = {
        agents: nextAgents,
        agent_admins: nextAgentAdmins,
        tools: nextTools,
        ...(body.knowledge_bases !== undefined || prevKnowledgeBases.length > 0
          ? { knowledge_bases: nextKnowledgeBases }
          : {}),
        ...(body.skills !== undefined || prevSkills.length > 0 ? { skills: nextSkills } : {}),
        ...(body.tasks !== undefined || prevTasks.length > 0 ? { tasks: nextTasks } : {}),
        tool_wildcard: nextToolWildcard,
      };

      await teamsCol.updateOne(
        { _id: teamId } as never,
        {
          $set: {
            resources: nextResources,
            updated_at: now,
          },
        }
      );

      console.log(
        `[Admin TeamResources] PUT team=${id} agents+=${agentDiff.added.length}/-${agentDiff.removed.length} agent_admins+=${agentAdminDiff.added.length}/-${agentAdminDiff.removed.length} tools+=${toolDiff.added.length}/-${toolDiff.removed.length} wildcard=${nextToolWildcard ? "on" : "off"} members_resolved=${resolvedMembers.length} members_skipped=${skippedMembers.length} by=${user.email}`
      );

      return successResponse({
        team_id: id,
        resources: nextResources,
        diff: {
          agents_added: agentDiff.added,
          agents_removed: agentDiff.removed,
          agent_admins_added: agentAdminDiff.added,
          agent_admins_removed: agentAdminDiff.removed,
          tools_added: toolDiff.added,
          tools_removed: toolDiff.removed,
          tool_wildcard_added: wildcardAdded,
          tool_wildcard_removed: wildcardRemoved,
        },
        members_resolved: resolvedMembers,
        members_updated: resolvedMembers,
        members_skipped: skippedMembers,
        openfga,
      });
  }
);

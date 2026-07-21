import { getCollection } from '@/lib/mongodb';
import { checkOpenFgaTuple, listOpenFgaObjects } from '@/lib/rbac/openfga';
import { slackChannelSubjectId } from '@/lib/rbac/slack-channel-grant-store';

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  channel_name?: string;
  active?: boolean;
}

interface DynamicAgentDoc {
  _id?: string;
  name?: string;
}

/** An agent the caller owns, with both the id (Slack conv key) and display name (web message key). */
export interface OwnedAgent {
  id: string;
  name: string;
}

/**
 * Resolve display names for a set of agent ids best-effort from the
 * `dynamic_agents` collection (`_id` → `name`). Web message rows are keyed by
 * display name, so callers need the name to match them. Missing docs fall back
 * to id === name. Empty input returns []. Never throws.
 */
export async function getAgentsByIds(ids: string[]): Promise<OwnedAgent[]> {
  const cleanIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (cleanIds.length === 0) return [];
  const nameById = new Map<string, string>();
  try {
    const agents = await getCollection<DynamicAgentDoc>('dynamic_agents');
    const docs = await agents.find({ _id: { $in: cleanIds } } as never).toArray();
    for (const doc of docs) {
      if (doc._id) nameById.set(String(doc._id), doc.name ?? String(doc._id));
    }
  } catch {
    // names are decorative for scoping; id-only matching still works for Slack
  }
  return cleanIds.map((id) => ({ id, name: nameById.get(id) ?? id }));
}

/**
 * Returns the channel_names of every Slack channel the given OpenFGA user
 * can can_read. Used to scope Insights (Stats + Feedback) for non-admins.
 * Fail-closed: any error returns [].
 */
export async function getReadableSlackChannelNames(openfgaUser: string): Promise<string[]> {
  try {
    const mappings = await getCollection<ChannelTeamMappingDoc>('channel_team_mappings');
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .limit(500)
      .toArray();

    const names: string[] = [];
    for (const row of rows) {
      if (!row.slack_channel_id || !row.channel_name) continue;
      const object = `slack_channel:${slackChannelSubjectId(row.slack_workspace_id ?? '', row.slack_channel_id)}`;
      const result = await checkOpenFgaTuple({ user: openfgaUser, relation: 'can_read', object }).catch(() => ({ allowed: false }));
      if (result.allowed) names.push(row.channel_name);
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Returns the agents the given OpenFGA user OWNS — directly or via a team they
 * manage — using the `can_manage` computed relation. This is deliberately
 * narrower than `can_use`: global agents grant `can_use` to every org member,
 * which would over-scope Insights to platform-wide agent data. Ownership
 * (`can_manage` = owner + team `manager`) is the "resources they own" axis.
 *
 * Each returned agent carries both its `id` (matches conversations'
 * `metadata.thread_owner_agent_id`, e.g. "agent-hello-agent") and its display
 * `name` (matches web messages' `metadata.agent_name`, e.g. "Hello Agent"),
 * resolved best-effort from the `dynamic_agents` collection. Fail-closed: any
 * error returns [].
 */
export async function getOwnedAgents(openfgaUser: string): Promise<OwnedAgent[]> {
  try {
    const { objects } = await listOpenFgaObjects({
      user: openfgaUser,
      relation: 'can_manage',
      type: 'agent',
    });
    const ids = objects
      .map((o) => (o.startsWith('agent:') ? o.slice('agent:'.length) : o))
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];

    // Resolve display names best-effort so web message rows (keyed by name)
    // can be matched. Missing docs fall back to id === name.
    return getAgentsByIds(ids);
  } catch {
    return [];
  }
}

/**
 * Every dynamic agent as an {@link OwnedAgent} (id + display name). Used to
 * populate the admin Insights agent filter dropdown for FULL admins, who see
 * usage for all agents. Fail-closed: [].
 */
export async function getAllAgents(): Promise<OwnedAgent[]> {
  try {
    const agents = await getCollection<DynamicAgentDoc>('dynamic_agents');
    const docs = await agents.find({} as never).limit(1000).toArray();
    return docs
      .filter((d) => d._id)
      .map((d) => ({ id: String(d._id), name: d.name ?? String(d._id) }));
  } catch {
    return [];
  }
}

/** Hard cap on owned-agent conversation ids materialized for feedback scoping. */
const OWNED_AGENT_CONV_ID_CAP = 10_000;

/**
 * Resolve the conversation ids routed to the caller's owned agents, across BOTH
 * surfaces (Slack routes per-conversation; web routes per-message). Used to
 * scope the `feedback` collection, which stores no agent field — only
 * `conversation_id`. Capped at {@link OWNED_AGENT_CONV_ID_CAP}; returns
 * `{ ids, capped }` so callers can surface truncation. Fail-closed: [].
 */
export async function getOwnedAgentConversationIds(
  agents: OwnedAgent[],
): Promise<{ ids: string[]; capped: boolean }> {
  if (agents.length === 0) return { ids: [], capped: false };
  try {
    const ownedIds = agents.map((a) => a.id);
    const ownedNames = agents.map((a) => a.name);
    const conversations = await getCollection('conversations');
    const messages = await getCollection('messages');

    const [slackConvs, webConvIds] = await Promise.all([
      // Slack: agent lives on the conversation.
      conversations
        .find(
          { 'metadata.thread_owner_agent_id': { $in: ownedIds } } as never,
          { projection: { _id: 1 } },
        )
        .limit(OWNED_AGENT_CONV_ID_CAP + 1)
        .toArray(),
      // Web: agent lives on the assistant message; map back to its conversation.
      messages.distinct('conversation_id', {
        role: 'assistant',
        'metadata.agent_name': { $in: ownedNames },
      } as never),
    ]);

    const set = new Set<string>();
    for (const c of slackConvs) if (c._id) set.add(String(c._id));
    for (const id of webConvIds as unknown[]) if (id) set.add(String(id));

    const all = [...set];
    const capped = all.length > OWNED_AGENT_CONV_ID_CAP;
    return { ids: capped ? all.slice(0, OWNED_AGENT_CONV_ID_CAP) : all, capped };
  } catch {
    return { ids: [], capped: false };
  }
}

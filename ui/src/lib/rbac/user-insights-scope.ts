import { getCollection } from '@/lib/mongodb';
import { checkOpenFgaTuple, listOpenFgaObjects } from '@/lib/rbac/openfga';
import { slackChannelSubjectId } from '@/lib/rbac/slack-channel-grant-store';
import { webexSpaceSubjectId } from '@/lib/rbac/webex-space-grant-store';

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  channel_name?: string;
  active?: boolean;
}

interface WebexSpaceTeamMappingDoc {
  webex_workspace_id?: string;
  webex_space_id?: string;
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

export interface ReadableMessagingConversationScope {
  slackChannelIds: string[];
  webexSpaceIds: string[];
}

interface ReadableSlackChannel {
  id: string;
  name: string;
}

/**
 * Return the teams the Insights actor belongs to through OpenFGA's computed
 * `team#member` relation. Team admins are included because `member` inherits
 * `admin` in the authorization model. Used only to decide whether a scoped
 * Insights drawer may show a teammate's profile shell; activity inside the
 * drawer remains constrained to the actor's resource scope.
 *
 * Fail-closed: any PDP error returns [].
 */
export async function getInsightsActorTeamSlugs(openfgaUser: string): Promise<string[]> {
  if (!openfgaUser.trim()) return [];
  try {
    const { objects } = await listOpenFgaObjects({
      user: openfgaUser,
      relation: 'member',
      type: 'team',
    });
    return [...new Set(
      objects
        .map((object) => object.startsWith('team:') ? object.slice('team:'.length) : object)
        .map((slug) => slug.trim())
        .filter(Boolean),
    )];
  } catch {
    return [];
  }
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
 * Returns every mapped Slack channel the given OpenFGA user can read.
 * Direct-message channel ids are excluded even if a malformed mapping exists:
 * DMs are never team resources and must not become visible in Insights through
 * channel-scoped authorization.
 *
 * Fail-closed: any error returns [].
 */
async function getReadableSlackChannels(
  openfgaUser: string,
): Promise<ReadableSlackChannel[]> {
  if (!openfgaUser.trim()) return [];
  try {
    const mappings = await getCollection<ChannelTeamMappingDoc>('channel_team_mappings');
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .limit(500)
      .toArray();

    const channels: ReadableSlackChannel[] = [];
    for (const row of rows) {
      if (!row.slack_channel_id) continue;
      if (row.slack_channel_id.startsWith('D')) continue;
      const object = `slack_channel:${slackChannelSubjectId(row.slack_workspace_id ?? '', row.slack_channel_id)}`;
      const result = await checkOpenFgaTuple({ user: openfgaUser, relation: 'can_read', object }).catch(() => ({ allowed: false }));
      if (result.allowed) {
        channels.push({
          id: row.slack_channel_id,
          name: row.channel_name?.trim() ?? '',
        });
      }
    }
    return channels.filter(
      (channel, index) =>
        channels.findIndex((candidate) => candidate.id === channel.id) === index,
    );
  } catch {
    return [];
  }
}

/** Channel names are retained for analytics collections keyed by name. */
export async function getReadableSlackChannelNames(
  openfgaUser: string,
): Promise<string[]> {
  const channels = await getReadableSlackChannels(openfgaUser);
  return [...new Set(channels.map((channel) => channel.name).filter(Boolean))];
}

/**
 * Returns mapped Webex space ids the actor can read. Direct-message spaces do
 * not have `webex_space_team_mappings` rows, so using that mapping collection
 * as the candidate set excludes Webex DMs by construction.
 */
export async function getReadableWebexSpaceIds(openfgaUser: string): Promise<string[]> {
  if (!openfgaUser.trim()) return [];
  try {
    const mappings = await getCollection<WebexSpaceTeamMappingDoc>(
      'webex_space_team_mappings',
    );
    const rows = await mappings
      .find({ active: { $ne: false } } as never)
      .limit(500)
      .toArray();

    const spaceIds: string[] = [];
    for (const row of rows) {
      if (!row.webex_space_id) continue;
      const object =
        `webex_space:${webexSpaceSubjectId(row.webex_workspace_id ?? '', row.webex_space_id)}`;
      const result = await checkOpenFgaTuple({
        user: openfgaUser,
        relation: 'can_read',
        object,
      }).catch(() => ({ allowed: false }));
      if (result.allowed) spaceIds.push(row.webex_space_id);
    }
    return [...new Set(spaceIds)];
  } catch {
    return [];
  }
}

/**
 * All external messaging scopes that may expose conversation titles and deep
 * links in Insights. Keep source-specific mapping details behind this helper
 * so the drawer consumes one extensible authorization result.
 */
export async function getReadableMessagingConversationScope(
  openfgaUser: string,
): Promise<ReadableMessagingConversationScope> {
  const [slackChannels, webexSpaceIds] = await Promise.all([
    getReadableSlackChannels(openfgaUser),
    getReadableWebexSpaceIds(openfgaUser),
  ]);
  return {
    slackChannelIds: slackChannels.map((channel) => channel.id),
    webexSpaceIds,
  };
}

/**
 * Explicitly shared web conversations visible through OpenFGA. Conversation
 * ownership is also checked against Mongo fields by the drawer because older
 * owner-created chats do not necessarily have materialized owner tuples.
 */
export async function getReadableConversationIds(openfgaUser: string): Promise<string[]> {
  if (!openfgaUser.trim()) return [];
  try {
    const { objects } = await listOpenFgaObjects({
      user: openfgaUser,
      relation: 'can_read',
      type: 'conversation',
    });
    return [...new Set(
      objects
        .map((object) => (
          object.startsWith('conversation:')
            ? object.slice('conversation:'.length)
            : object
        ))
        .map((id) => id.trim())
        .filter(Boolean),
    )];
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

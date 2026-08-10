import { getCollection } from '@/lib/mongodb';
import { checkOpenFgaTuple } from '@/lib/rbac/openfga';
import { slackChannelSubjectId } from '@/lib/rbac/slack-channel-grant-store';

interface ChannelTeamMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  channel_name?: string;
  active?: boolean;
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

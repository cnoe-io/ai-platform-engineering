import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;
const apply = process.env.APPLY === "true";
const migrationSourceId = "backfill-universal-rebac";

if (!uri || !databaseName) {
  throw new Error("MONGODB_URI and MONGODB_DATABASE are required");
}

const mongoUri = uri;
const mongoDatabaseName = databaseName;

interface TeamDoc {
  _id: unknown;
  slug?: string;
  name?: string;
  members?: Array<{ user_id?: string; role?: string }>;
  resources?: {
    agents?: string[];
    agent_admins?: string[];
    tools?: string[];
    knowledge_bases?: string[];
    skills?: string[];
    tasks?: string[];
  };
}

interface ChannelAgentMappingDoc {
  slack_workspace_id?: string;
  slack_channel_id?: string;
  agent_id?: string;
  active?: boolean;
  created_by?: string;
}

function teamId(team: TeamDoc): string {
  return typeof team._id === "string" ? team._id : String(team._id);
}

function relationshipForRole(role: string | undefined): "member" | "admin" {
  return role === "admin" || role === "owner" ? "admin" : "member";
}

function slackChannelSubjectId(workspaceId: string, channelId: string): string {
  return `${workspaceId}--${channelId}`;
}

async function main(): Promise<void> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(mongoDatabaseName);
    const teams = await db.collection<TeamDoc>("teams").find({}).toArray();
    const channelMappings = await db
      .collection<ChannelAgentMappingDoc>("channel_agent_mappings")
      .find({ active: { $ne: false } })
      .toArray();
    const now = new Date().toISOString();
    const membershipSources = db.collection("team_membership_sources");
    const relationships = db.collection("rebac_relationships");
    const slackGrants = db.collection("slack_channel_grants");

    let membershipCount = 0;
    let relationshipCount = 0;
    let slackGrantCount = 0;
    let skippedSlackGrantCount = 0;
    for (const team of teams) {
      const slug = team.slug?.trim();
      if (!slug) continue;
      for (const member of team.members ?? []) {
        const email = member.user_id?.trim().toLowerCase();
        if (!email) continue;
        const relationship = relationshipForRole(member.role);
        membershipCount += 1;
        if (apply) {
          await membershipSources.updateOne(
            { team_slug: slug, user_email: email, relationship, source_type: "migration" },
            {
              $set: {
                team_id: teamId(team),
                team_slug: slug,
                user_email: email,
                relationship,
                source_type: "migration",
                source_id: migrationSourceId,
                managed: false,
                status: "active",
                last_seen_at: now,
                updated_at: now,
              },
              $setOnInsert: {
                first_seen_at: now,
                created_at: now,
                created_by: migrationSourceId,
              },
            },
            { upsert: true }
          );
        }
      }

      const resources = team.resources ?? {};
      const grants: Array<{ type: string; action: string; ids: string[] | undefined }> = [
        { type: "agent", action: "use", ids: resources.agents },
        { type: "agent", action: "manage", ids: resources.agent_admins },
        { type: "tool", action: "call", ids: resources.tools },
        { type: "knowledge_base", action: "read", ids: resources.knowledge_bases },
        { type: "skill", action: "use", ids: resources.skills },
        { type: "task", action: "use", ids: resources.tasks },
      ];
      for (const grant of grants) {
        for (const resourceId of grant.ids ?? []) {
          relationshipCount += 1;
          if (apply) {
            await relationships.updateOne(
              {
                "subject.type": "team",
                "subject.id": slug,
                "subject.relation": "member",
                action: grant.action,
                "resource.type": grant.type,
                "resource.id": resourceId,
              },
              {
                $set: {
                  subject: { type: "team", id: slug, relation: "member" },
                  action: grant.action,
                  resource: { type: grant.type, id: resourceId },
                  source_type: "migration",
                  source_id: migrationSourceId,
                  status: "active",
                  updated_at: now,
                },
                $setOnInsert: { created_at: now, created_by: migrationSourceId },
              },
              { upsert: true }
            );
          }
        }
      }
    }

    for (const mapping of channelMappings) {
      const workspaceId = mapping.slack_workspace_id?.trim();
      const channelId = mapping.slack_channel_id?.trim();
      const agentId = mapping.agent_id?.trim();
      if (!workspaceId || !channelId || !agentId) {
        skippedSlackGrantCount += 1;
        continue;
      }

      slackGrantCount += 1;
      relationshipCount += 1;
      if (apply) {
        await slackGrants.updateOne(
          {
            workspace_id: workspaceId,
            channel_id: channelId,
            "resource.type": "agent",
            "resource.id": agentId,
          },
          {
            $set: {
              workspace_id: workspaceId,
              channel_id: channelId,
              resource: { type: "agent", id: agentId },
              actions: ["use"],
              source_type: "migration",
              source_id: migrationSourceId,
              status: "active",
              updated_by: mapping.created_by ?? migrationSourceId,
              updated_at: now,
            },
            $setOnInsert: {
              created_by: mapping.created_by ?? migrationSourceId,
              created_at: now,
            },
          },
          { upsert: true }
        );

        await relationships.updateOne(
          {
            "subject.type": "slack_channel",
            "subject.id": slackChannelSubjectId(workspaceId, channelId),
            action: "use",
            "resource.type": "agent",
            "resource.id": agentId,
          },
          {
            $set: {
              subject: { type: "slack_channel", id: slackChannelSubjectId(workspaceId, channelId) },
              action: "use",
              resource: { type: "agent", id: agentId },
              source_type: "migration",
              source_id: migrationSourceId,
              status: "active",
              updated_at: now,
            },
            $setOnInsert: { created_at: now, created_by: migrationSourceId },
          },
          { upsert: true }
        );
      }
    }

    console.log(
      `${apply ? "applied" : "dry-run"} backfill: ` +
        `membership_sources=${membershipCount} relationships=${relationshipCount} ` +
        `slack_channel_grants=${slackGrantCount} skipped_slack_channel_grants=${skippedSlackGrantCount}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

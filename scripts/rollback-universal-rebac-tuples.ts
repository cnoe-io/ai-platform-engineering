import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;
const sourceId = process.env.SOURCE_ID;
const apply = process.env.APPLY === "true";

if (!uri || !databaseName || !sourceId) {
  throw new Error("MONGODB_URI, MONGODB_DATABASE, and SOURCE_ID are required");
}

const mongoUri = uri;
const mongoDatabaseName = databaseName;
const rollbackSourceId = sourceId;

async function main(): Promise<void> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(mongoDatabaseName);
    const relationships = db.collection("rebac_relationships");
    const membershipSources = db.collection("team_membership_sources");
    const slackGrants = db.collection("slack_channel_grants");
    const activeSourceFilter = { source_id: rollbackSourceId, status: "active" };
    const now = new Date().toISOString();
    const [relationshipCount, membershipSourceCount, slackGrantCount] = await Promise.all([
      relationships.countDocuments(activeSourceFilter),
      membershipSources.countDocuments(activeSourceFilter),
      slackGrants.countDocuments(activeSourceFilter),
    ]);
    if (apply) {
      await Promise.all([
        relationships.updateMany(activeSourceFilter, {
          $set: {
            status: "revoked",
            revoked_by: "rollback-universal-rebac-tuples",
            revoked_at: now,
          },
        }),
        membershipSources.updateMany(activeSourceFilter, {
          $set: {
            status: "removed",
            removed_by: "rollback-universal-rebac-tuples",
            removed_at: now,
          },
        }),
        slackGrants.updateMany(activeSourceFilter, {
          $set: {
            status: "revoked",
            revoked_by: "rollback-universal-rebac-tuples",
            revoked_at: now,
          },
        }),
      ]);
    }
    console.log(
      `${apply ? "revoked" : "dry-run"} source_id=${rollbackSourceId} ` +
        `relationships=${relationshipCount} membership_sources=${membershipSourceCount} ` +
        `slack_channel_grants=${slackGrantCount}`
    );
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

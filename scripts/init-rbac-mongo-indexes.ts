import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DATABASE;

if (!uri || !databaseName) {
  throw new Error("MONGODB_URI and MONGODB_DATABASE are required");
}

const mongoUri = uri;
const mongoDatabaseName = databaseName;

const indexSpecs: Record<
  string,
  Array<{ keys: Record<string, 1 | -1>; options?: { unique?: boolean; sparse?: boolean } }>
> = {
  identity_providers: [{ keys: { id: 1 }, options: { unique: true } }],
  identity_group_sync_rules: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { provider_id: 1, priority: 1 } },
    { keys: { enabled: 1, review_status: 1 } },
  ],
  identity_group_sync_runs: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { provider_id: 1, created_at: -1 } },
    { keys: { status: 1, created_at: -1 } },
  ],
  external_groups: [
    { keys: { provider_id: 1, external_group_id: 1 }, options: { unique: true } },
    { keys: { normalized_name: 1 } },
    { keys: { status: 1, last_seen_at: -1 } },
  ],
  external_group_team_links: [
    {
      keys: { provider_id: 1, external_group_id: 1, sync_rule_id: 1, relationship_role: 1 },
      options: { unique: true },
    },
    { keys: { team_id: 1, status: 1 } },
    { keys: { team_slug: 1, status: 1 } },
  ],
  team_membership_sources: [
    { keys: { team_id: 1, user_subject: 1, relationship: 1, source_type: 1 } },
    { keys: { team_slug: 1, status: 1 } },
    { keys: { provider_id: 1, external_group_id: 1, sync_rule_id: 1 } },
    { keys: { user_email: 1 }, options: { sparse: true } },
  ],
  rebac_resources: [
    { keys: { resource_type: 1, resource_id: 1 }, options: { unique: true } },
    { keys: { enforcement_status: 1 } },
  ],
  rebac_relationships: [
    { keys: { "subject.type": 1, "subject.id": 1 } },
    { keys: { "resource.type": 1, "resource.id": 1, action: 1, status: 1 } },
    { keys: { source_type: 1, source_id: 1 } },
  ],
  policy_rules: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { scope: 1, status: 1 } },
  ],
  policy_change_sets: [
    { keys: { id: 1 }, options: { unique: true } },
    { keys: { status: 1, created_at: -1 } },
  ],
  slack_channel_grants: [
    { keys: { workspace_id: 1, channel_id: 1, "resource.type": 1, "resource.id": 1 } },
    { keys: { status: 1, updated_at: -1 } },
  ],
  rebac_enforcement_status: [
    { keys: { resource_type: 1, resource_id: 1 }, options: { unique: true } },
    { keys: { status: 1 } },
  ],
  rebac_drift_findings: [
    { keys: { resource_type: 1, resource_id: 1, status: 1 } },
    { keys: { detected_at: -1 } },
  ],
};

async function main(): Promise<void> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  try {
    const db = client.db(mongoDatabaseName);
    for (const [collectionName, specs] of Object.entries(indexSpecs)) {
      for (const spec of specs) {
        await db.collection(collectionName).createIndex(spec.keys, spec.options);
      }
      console.log(`ensured ${specs.length} index(es) on ${collectionName}`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

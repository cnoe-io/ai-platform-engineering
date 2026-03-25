// MongoDB connection utility for Next.js API routes
// This creates a singleton connection that is reused across API requests
// Supports graceful degradation - if MongoDB is not configured, APIs will return appropriate errors

import { MongoClient, Db, Collection, Document } from 'mongodb';

// MongoDB is optional - check if it's configured
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE;

// Export flag to check if MongoDB is configured
export const isMongoDBConfigured = !!(uri && dbName);

if (!isMongoDBConfigured) {
  console.warn('⚠️  MongoDB not configured - running in localStorage-only mode');
  console.warn('   Set MONGODB_URI and MONGODB_DATABASE to enable persistent storage');
}

interface MongoDBConnection {
  client: MongoClient;
  db: Db;
}

let cachedConnection: MongoDBConnection | null = null;

/**
 * Connect to MongoDB and return db instance
 * Uses connection pooling and caching for optimal performance
 * Throws error if MongoDB is not configured
 */
export async function connectToDatabase(): Promise<MongoDBConnection> {
  // Check if MongoDB is configured
  if (!isMongoDBConfigured) {
    throw new Error('MongoDB is not configured. Set MONGODB_URI and MONGODB_DATABASE environment variables.');
  }

  // Return cached connection if available
  if (cachedConnection) {
    return cachedConnection;
  }

  // Create new connection
  const client = new MongoClient(uri!, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  await client.connect();

  const db = client.db(dbName);

  // Cache the connection
  cachedConnection = { client, db };

  // Create indexes on first connection
  await createIndexes(db);

  console.log(`✅ Connected to MongoDB database: ${dbName}`);

  return cachedConnection;
}

/**
 * Get a specific collection with proper typing
 */
export async function getCollection<T extends Document = Document>(collectionName: string): Promise<Collection<T>> {
  const { db } = await connectToDatabase();
  return db.collection<T>(collectionName);
}

/**
 * Safely create a single index, logging and continuing on failure.
 * Returns true if the index was created (or already existed), false on error.
 */
async function safeCreateIndex(
  db: Db,
  collectionName: string,
  keys: Record<string, 1 | -1>,
  options?: { unique?: boolean },
): Promise<boolean> {
  try {
    await db.collection(collectionName).createIndex(keys, options ?? {});
    return true;
  } catch (error: unknown) {
    const code = (error as { code?: number }).code;

    if (code === 11000 && options?.unique) {
      // Duplicate key — deduplicate then retry
      const keyFields = Object.keys(keys);
      console.warn(
        `⚠️  Duplicate values found in ${collectionName} for unique index ${JSON.stringify(keys)} — deduplicating...`,
      );
      await deduplicateCollection(db, collectionName, keyFields);
      try {
        await db.collection(collectionName).createIndex(keys, options);
        console.log(`  ✅ Index on ${collectionName} ${JSON.stringify(keys)} created after dedup`);
        return true;
      } catch (retryError) {
        console.error(
          `  ❌ Index on ${collectionName} ${JSON.stringify(keys)} still failed after dedup:`,
          retryError,
        );
        return false;
      }
    }

    // 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict — index already exists with different options
    if (code === 85 || code === 86) {
      console.warn(
        `⚠️  Index conflict on ${collectionName} ${JSON.stringify(keys)} (code ${code}) — skipping`,
      );
      return true; // Existing index is close enough
    }

    console.error(`❌ Failed to create index on ${collectionName} ${JSON.stringify(keys)}:`, error);
    return false;
  }
}

/**
 * Remove duplicate documents for the given key fields, keeping the newest
 * (by _id, which embeds a timestamp in MongoDB ObjectIds).
 */
async function deduplicateCollection(
  db: Db,
  collectionName: string,
  keyFields: string[],
): Promise<void> {
  const collection = db.collection(collectionName);

  // Build a $group stage that groups by the key fields
  const groupId: Record<string, string> = {};
  for (const field of keyFields) {
    groupId[field.replace(/\./g, '_')] = `$${field}`;
  }

  const pipeline = [
    { $sort: { _id: -1 as const } }, // newest first
    { $group: { _id: groupId, keepId: { $first: '$_id' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ];

  const duplicates = await collection.aggregate(pipeline).toArray();
  let totalRemoved = 0;

  for (const dup of duplicates) {
    // Build a filter that matches the duplicate key values
    const filter: Record<string, unknown> = {};
    for (const field of keyFields) {
      const safeKey = field.replace(/\./g, '_');
      filter[field] = dup._id[safeKey];
    }
    // Delete all except the one we're keeping
    filter._id = { $ne: dup.keepId };

    const result = await collection.deleteMany(filter);
    totalRemoved += result.deletedCount;
  }

  if (totalRemoved > 0) {
    console.log(`  🗑️  Removed ${totalRemoved} duplicate(s) from ${collectionName}`);
  }
}

/**
 * Create indexes for all collections.
 * This runs once on first connection.
 *
 * Each index is created independently so a single failure (e.g. duplicate
 * key conflict) doesn't prevent other indexes from being created.
 * Unique index conflicts trigger automatic deduplication and retry.
 */
async function createIndexes(db: Db) {
  // Each index is created independently via Promise.all so a single failure
  // doesn't prevent other indexes from being created.

  await Promise.all([
    // Users collection
    safeCreateIndex(db, 'users', { email: 1 }, { unique: true }),
    safeCreateIndex(db, 'users', { 'metadata.sso_id': 1 }),
    safeCreateIndex(db, 'users', { last_login: -1 }),

    // Conversations collection
    safeCreateIndex(db, 'conversations', { owner_id: 1 }),
    safeCreateIndex(db, 'conversations', { created_at: -1 }),
    safeCreateIndex(db, 'conversations', { updated_at: -1 }),
    safeCreateIndex(db, 'conversations', { 'sharing.shared_with': 1 }),
    safeCreateIndex(db, 'conversations', { tags: 1 }),
    safeCreateIndex(db, 'conversations', { is_archived: 1, owner_id: 1 }),
    safeCreateIndex(db, 'conversations', { deleted_at: 1, owner_id: 1 }),
    safeCreateIndex(db, 'conversations', { source: 1 }),

    // Messages collection
    safeCreateIndex(db, 'messages', { conversation_id: 1, created_at: 1 }),
    safeCreateIndex(db, 'messages', { 'metadata.turn_id': 1 }),
    safeCreateIndex(db, 'messages', { role: 1 }),

    // User settings collection
    safeCreateIndex(db, 'user_settings', { user_id: 1 }, { unique: true }),

    // Conversation bookmarks collection
    safeCreateIndex(db, 'conversation_bookmarks', { user_id: 1 }),
    safeCreateIndex(db, 'conversation_bookmarks', { conversation_id: 1 }),
    safeCreateIndex(db, 'conversation_bookmarks', { user_id: 1, conversation_id: 1 }),

    // Sharing access collection
    safeCreateIndex(db, 'sharing_access', { conversation_id: 1 }),
    safeCreateIndex(db, 'sharing_access', { granted_to: 1 }),
    safeCreateIndex(db, 'sharing_access', { conversation_id: 1, granted_to: 1 }),

    // Agent skills collection (catalog source agent_skills)
    safeCreateIndex(db, 'agent_skills', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'agent_skills', { owner_id: 1 }),
    safeCreateIndex(db, 'agent_skills', { category: 1 }),
    safeCreateIndex(db, 'agent_skills', { is_system: 1 }),
    safeCreateIndex(db, 'agent_skills', { name: 1 }),
    safeCreateIndex(db, 'agent_skills', { created_at: -1 }),
    safeCreateIndex(db, 'agent_skills', { 'metadata.tags': 1 }),

    // Skill hubs collection
    safeCreateIndex(db, 'skill_hubs', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'skill_hubs', { enabled: 1 }),
    safeCreateIndex(db, 'skill_hubs', { location: 1 }),

    // Workflow runs collection (skill / workflow run history)
    safeCreateIndex(db, 'workflow_runs', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'workflow_runs', { workflow_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { status: 1 }),
    safeCreateIndex(db, 'workflow_runs', { started_at: -1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1, workflow_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1, started_at: -1 }),

    // Task configs collection (Task Builder)
    safeCreateIndex(db, 'task_configs', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'task_configs', { name: 1 }, { unique: true }),
    safeCreateIndex(db, 'task_configs', { category: 1 }),
    safeCreateIndex(db, 'task_configs', { owner_id: 1 }),
    safeCreateIndex(db, 'task_configs', { is_system: 1 }),
    safeCreateIndex(db, 'task_configs', { created_at: -1 }),

    // Policies collection (global ASP policy for system workflows)
    safeCreateIndex(db, 'policies', { name: 1 }, { unique: true }),
    safeCreateIndex(db, 'policies', { is_system: 1 }),

    // Feedback collection (unified feedback from web + Slack)
    safeCreateIndex(db, 'feedback', { created_at: -1 }),
    safeCreateIndex(db, 'feedback', { source: 1, created_at: -1 }),
    safeCreateIndex(db, 'feedback', { rating: 1, created_at: -1 }),
    safeCreateIndex(db, 'feedback', { channel_name: 1, created_at: -1 }),
    safeCreateIndex(db, 'feedback', { trace_id: 1 }),

    // Slack metadata on conversations (for stats queries filtering by source)
    safeCreateIndex(db, 'conversations', { source: 1, created_at: -1 }),
    safeCreateIndex(db, 'conversations', { 'slack_meta.channel_name': 1, created_at: -1 }),
    safeCreateIndex(db, 'conversations', { 'slack_meta.escalated': 1, created_at: -1 }),

    // 098 RBAC: Team/KB ownership assignments
    safeCreateIndex(db, 'team_kb_ownership', { team_id: 1, tenant_id: 1 }, { unique: true }),
    safeCreateIndex(db, 'team_kb_ownership', { tenant_id: 1 }),
    safeCreateIndex(db, 'team_kb_ownership', { keycloak_role: 1 }),

    // 098 RBAC: Team-scoped RAG tool configurations
    safeCreateIndex(db, 'team_rag_tools', { tool_id: 1 }, { unique: true }),
    safeCreateIndex(db, 'team_rag_tools', { team_id: 1, tenant_id: 1 }),
    safeCreateIndex(db, 'team_rag_tools', { tenant_id: 1 }),
    safeCreateIndex(db, 'team_rag_tools', { created_by: 1 }),
    safeCreateIndex(db, 'team_rag_tools', { updated_at: -1 }),

    // 098 RBAC: Authorization decision audit records (FR-005, data-model.md)
    safeCreateIndex(db, 'authorization_decision_records', { tenant_id: 1, ts: -1 }),
    safeCreateIndex(db, 'authorization_decision_records', { subject_hash: 1, ts: -1 }),
    safeCreateIndex(db, 'authorization_decision_records', { capability: 1 }),
    safeCreateIndex(db, 'authorization_decision_records', { outcome: 1, ts: -1 }),
    safeCreateIndex(db, 'authorization_decision_records', { correlation_id: 1 }),

    // 098 US9: Slack channel ↔ team mappings + admin Slack dashboard
    safeCreateIndex(db, 'channel_team_mappings', { slack_channel_id: 1 }, { unique: true }),
    safeCreateIndex(db, 'slack_link_nonces', { nonce: 1 }, { unique: true }),
    safeCreateIndex(db, 'slack_link_nonces', { created_at: 1 }, { expireAfterSeconds: 600 }),
    safeCreateIndex(db, 'slack_user_metrics', { slack_user_id: 1 }, { unique: true }),
  ]);

  console.log('✅ MongoDB indexes ensured');

  await migrateWebFeedback(db);
  await migrateAgentConfigsToAgentSkills(db);
}

/**
 * One-time migration: move embedded messages.feedback into a standalone
 * feedback collection, then remove the embedded field.  Also tags
 * existing conversations and users with source:"web" where missing
 * (Slack entries are tagged separately by the Slack bot / backfill).
 *
 * No-op when no messages have an embedded feedback.rating field.
 */
async function migrateWebFeedback(db: Db): Promise<void> {
  const messages = db.collection('messages');
  const feedbackCount = await messages.countDocuments({ 'feedback.rating': { $exists: true } });
  if (feedbackCount === 0) {
    return; // nothing to migrate
  }

  console.log(`🔄 Migrating ${feedbackCount} embedded feedback docs → feedback collection...`);

  const feedback = db.collection('feedback');

  const cursor = messages.find({ 'feedback.rating': { $exists: true } });
  let migrated = 0;
  let skipped = 0;

  for await (const doc of cursor) {
    const fb = doc.feedback as Record<string, unknown> | undefined;
    if (!fb) {
      skipped++;
      continue;
    }

    const messageId = doc._id.toString();
    const exists = await feedback.findOne({ message_id: messageId, source: 'web' });
    if (exists) {
      skipped++;
      continue;
    }

    const rating = fb.rating as string;
    await feedback.insertOne({
      trace_id: null,
      source: 'web',
      rating,
      value: rating === 'positive' ? 'thumbs_up' : 'thumbs_down',
      comment: (fb.comment as string) ?? null,
      user_email: (fb.submitted_by as string) ?? doc.owner_id ?? null,
      user_id: null,
      message_id: messageId,
      conversation_id: doc.conversation_id ?? null,
      channel_id: null,
      channel_name: null,
      thread_ts: null,
      slack_permalink: null,
      created_at: (fb.submitted_at as Date) ?? doc.created_at ?? new Date(),
    });
    migrated++;
  }

  // Remove the embedded feedback field — feedback collection is now source of truth
  const unsetResult = await messages.updateMany(
    { 'feedback.rating': { $exists: true } },
    { $unset: { feedback: '' } },
  );

  // Tag conversations and users without source as "web"
  const convResult = await db.collection('conversations').updateMany(
    { source: { $exists: false } },
    { $set: { source: 'web' } },
  );
  const userResult = await db.collection('users').updateMany(
    { source: { $exists: false } },
    { $set: { source: 'web' } },
  );

  console.log(
    `✅ Web feedback migration: ${migrated} copied, ${skipped} skipped, ` +
    `${unsetResult.modifiedCount} messages cleaned, ` +
    `${convResult.modifiedCount} conversations tagged, ${userResult.modifiedCount} users tagged`,
  );
}

/**
 * One-time migration: copy documents from the legacy `agent_configs`
 * collection into `agent_skills`.  Skips documents whose `id` already
 * exists in `agent_skills` to avoid duplicates.  After a successful
 * migration the old collection is renamed to `agent_configs_migrated`
 * so this function becomes a no-op on subsequent startups.
 */
async function migrateAgentConfigsToAgentSkills(db: Db): Promise<void> {
  const collections = await db.listCollections({ name: 'agent_configs' }).toArray();
  if (collections.length === 0) {
    return; // nothing to migrate
  }

  const source = db.collection('agent_configs');
  const sourceCount = await source.countDocuments();
  if (sourceCount === 0) {
    // Empty collection — just drop it
    await source.drop().catch(() => {});
    console.log('🗑️  Dropped empty legacy agent_configs collection');
    return;
  }

  const target = db.collection('agent_skills');
  const docs = await source.find({}).toArray();

  let migrated = 0;
  let skipped = 0;

  for (const doc of docs) {
    const docId = doc.id ?? doc._id?.toString();
    if (!docId) {
      skipped++;
      continue;
    }

    const exists = await target.findOne({ id: docId });
    if (exists) {
      skipped++;
      continue;
    }

    const { _id, ...rest } = doc;
    await target.insertOne(rest);
    migrated++;
  }

  // Rename so migration never runs again
  try {
    await source.rename('agent_configs_migrated');
  } catch {
    // If rename fails (e.g. target exists), drop instead
    await source.drop().catch(() => {});
  }

  console.log(
    `✅ Migrated agent_configs → agent_skills: ${migrated} copied, ${skipped} skipped (already existed or invalid)`
  );
}

/**
 * Close MongoDB connection
 * Use this for graceful shutdown
 */
export async function closeConnection() {
  if (cachedConnection) {
    await cachedConnection.client.close();
    cachedConnection = null;
    console.log('MongoDB connection closed');
  }
}

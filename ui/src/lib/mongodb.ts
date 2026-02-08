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

    // Agent configs collection (Agentic Workflows)
    safeCreateIndex(db, 'agent_configs', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'agent_configs', { owner_id: 1 }),
    safeCreateIndex(db, 'agent_configs', { category: 1 }),
    safeCreateIndex(db, 'agent_configs', { is_system: 1 }),
    safeCreateIndex(db, 'agent_configs', { name: 1 }),
    safeCreateIndex(db, 'agent_configs', { created_at: -1 }),
    safeCreateIndex(db, 'agent_configs', { 'metadata.tags': 1 }),

    // Workflow runs collection (Agentic Workflows History)
    safeCreateIndex(db, 'workflow_runs', { id: 1 }, { unique: true }),
    safeCreateIndex(db, 'workflow_runs', { workflow_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { status: 1 }),
    safeCreateIndex(db, 'workflow_runs', { started_at: -1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1, workflow_id: 1 }),
    safeCreateIndex(db, 'workflow_runs', { owner_id: 1, started_at: -1 }),
  ]);

  console.log('✅ MongoDB indexes ensured');
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

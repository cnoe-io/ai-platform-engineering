// MongoDB connection utility for Next.js API routes
// This creates a singleton connection that is reused across API requests

import { MongoClient, Db, Collection, Document } from 'mongodb';

if (!process.env.MONGODB_URI) {
  throw new Error('Please add MONGODB_URI to your environment variables');
}

if (!process.env.MONGODB_DATABASE) {
  throw new Error('Please add MONGODB_DATABASE to your environment variables');
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DATABASE;

interface MongoDBConnection {
  client: MongoClient;
  db: Db;
}

let cachedConnection: MongoDBConnection | null = null;

/**
 * Connect to MongoDB and return db instance
 * Uses connection pooling and caching for optimal performance
 */
export async function connectToDatabase(): Promise<MongoDBConnection> {
  // Return cached connection if available
  if (cachedConnection) {
    return cachedConnection;
  }

  // Create new connection
  const client = new MongoClient(uri, {
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
 * Create indexes for all collections
 * This runs once on first connection
 */
async function createIndexes(db: Db) {
  try {
    // Users collection indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ 'metadata.sso_id': 1 });
    await db.collection('users').createIndex({ last_login: -1 });

    // Conversations collection indexes
    await db.collection('conversations').createIndex({ _id: 1 });
    await db.collection('conversations').createIndex({ owner_id: 1 });
    await db.collection('conversations').createIndex({ created_at: -1 });
    await db.collection('conversations').createIndex({ updated_at: -1 });
    await db.collection('conversations').createIndex({ 'sharing.shared_with': 1 });
    await db.collection('conversations').createIndex({ tags: 1 });
    await db.collection('conversations').createIndex({ is_archived: 1, owner_id: 1 });

    // Messages collection indexes
    await db.collection('messages').createIndex({ conversation_id: 1, created_at: 1 });
    await db.collection('messages').createIndex({ 'metadata.turn_id': 1 });
    await db.collection('messages').createIndex({ role: 1 });

    // User settings collection indexes
    await db.collection('user_settings').createIndex({ user_id: 1 }, { unique: true });

    // Conversation bookmarks collection indexes
    await db.collection('conversation_bookmarks').createIndex({ user_id: 1 });
    await db.collection('conversation_bookmarks').createIndex({ conversation_id: 1 });
    await db.collection('conversation_bookmarks').createIndex({ user_id: 1, conversation_id: 1 });

    // Sharing access collection indexes
    await db.collection('sharing_access').createIndex({ conversation_id: 1 });
    await db.collection('sharing_access').createIndex({ granted_to: 1 });
    await db.collection('sharing_access').createIndex({ conversation_id: 1, granted_to: 1 });

    console.log('✅ MongoDB indexes created successfully');
  } catch (error) {
    console.error('❌ Error creating MongoDB indexes:', error);
    // Don't throw - indexes might already exist
  }
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

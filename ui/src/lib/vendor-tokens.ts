/**
 * Per-user vendor OAuth connection store.
 *
 * Mirrors the backend's
 * ``ai_platform_engineering/dynamic_agents/src/dynamic_agents/services/vendor_tokens.py``
 * but lives in the Next.js gateway because that is where the OAuth
 * authorization code is received (it is never proxied to the backend).
 *
 * Both the gateway (this file) and the backend ``vendor_tokens.py`` write
 * to the same ``vendor_connections`` collection — last writer wins. The
 * UI handles the initial code exchange; either side may rotate the
 * refresh token via ``refreshWebexToken``.
 */

import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';

// Collection name must match dynamic_agents Settings.vendor_connections_collection.
const COLLECTION = 'vendor_connections';

export type VendorName = 'webex';

// Mongo schema (snake_case) — must stay in sync with the backend
// `dynamic_agents/services/vendor_tokens.py`. Both UI and backend write
// to this same collection, so the field names MUST match exactly.
interface VendorConnectionDoc {
  _id: string; // `${userEmail}::${vendor}`
  user_email: string;
  vendor: VendorName;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  scopes: string[];
  created_at: Date;
  updated_at: Date;
}

// camelCase view exposed to the rest of the UI codebase.
export interface VendorConnection {
  _id: string;
  userEmail: string;
  vendor: VendorName;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class VendorConnectionError extends Error {}

function connectionId(userEmail: string, vendor: VendorName): string {
  return `${userEmail.toLowerCase()}::${vendor}`;
}

function fromDoc(doc: VendorConnectionDoc): VendorConnection {
  return {
    _id: doc._id,
    userEmail: doc.user_email,
    vendor: doc.vendor,
    accessToken: doc.access_token,
    refreshToken: doc.refresh_token,
    expiresAt: doc.expires_at,
    scopes: doc.scopes ?? [],
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

export async function getVendorConnection(
  userEmail: string,
  vendor: VendorName,
): Promise<VendorConnection | null> {
  if (!isMongoDBConfigured) {
    throw new VendorConnectionError(
      'MongoDB is not configured; vendor OAuth connections require persistent storage.',
    );
  }
  const coll = await getCollection<VendorConnectionDoc>(COLLECTION);
  const doc = await coll.findOne({ _id: connectionId(userEmail, vendor) });
  return doc ? fromDoc(doc) : null;
}

export async function upsertVendorConnection(
  userEmail: string,
  vendor: VendorName,
  data: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scopes: string[];
  },
): Promise<void> {
  if (!isMongoDBConfigured) {
    throw new VendorConnectionError(
      'MongoDB is not configured; cannot persist vendor OAuth connection.',
    );
  }
  const coll = await getCollection<VendorConnectionDoc>(COLLECTION);
  const now = new Date();
  await coll.updateOne(
    { _id: connectionId(userEmail, vendor) },
    {
      $set: {
        user_email: userEmail.toLowerCase(),
        vendor,
        access_token: data.accessToken,
        refresh_token: data.refreshToken,
        expires_at: data.expiresAt,
        scopes: data.scopes,
        updated_at: now,
      },
      $setOnInsert: { created_at: now },
      // Strip any legacy camelCase fields written by older UI versions
      // so the document only has the snake_case schema the backend expects.
      $unset: {
        userEmail: '',
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
        createdAt: '',
        updatedAt: '',
      },
    },
    { upsert: true },
  );
}

export async function deleteVendorConnection(
  userEmail: string,
  vendor: VendorName,
): Promise<void> {
  if (!isMongoDBConfigured) return;
  const coll = await getCollection<VendorConnectionDoc>(COLLECTION);
  await coll.deleteOne({ _id: connectionId(userEmail, vendor) });
}

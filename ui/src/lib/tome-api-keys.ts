/**
 * MongoDB-backed API keys for the TOME MCP surface.
 *
 * These keys are intentionally separate from Skills API keys and NextAuth
 * session cookies. The raw key is returned only when it is created; MongoDB
 * stores a scrypt digest and the Keycloak subject that owns the key.
 */

import { randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import type { Collection, Document } from "mongodb";

import { getCollection, isMongoDBConfigured } from "@/lib/mongodb";

const COLLECTION = "tome_api_keys";
const KEY_ID_PREFIX = "tome_";
const KEY_ID_LENGTH = 16;
const SECRET_LENGTH = 32;
const HASH_PREFIX = "scrypt:v1";
const HASH_LENGTH = 32;
const MAX_EXPIRY_DAYS = 90;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

interface TomeApiKeyDocument extends Document {
  key_id: string;
  key_hash: string;
  owner_user_id: string;
  owner_email: string;
  owner_name: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  status: "active" | "revoked";
  last_used_at?: Date;
}
export interface TomeApiKeyIdentity {
  sub: string;
  email: string;
  name: string;
}

export interface TomeApiKeyMetadata {
  key_id: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  status: "active" | "revoked";
}

function collection(): Promise<Collection<TomeApiKeyDocument>> {
  return getCollection<TomeApiKeyDocument>(COLLECTION);
}

function randomId(length: number): string {
  let value = "";
  while (value.length < length) value += ALPHABET[randomInt(ALPHABET.length)];
  return value;
}

function pepper(): string {
  return process.env.TOME_API_KEY_PEPPER?.trim() || "";
}

async function digest(keyId: string, secret: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(`${pepper()}:${secret}`, keyId, HASH_LENGTH, SCRYPT_OPTIONS, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

async function hashSecret(keyId: string, secret: string): Promise<string> {
  return `${HASH_PREFIX}:${(await digest(keyId, secret)).toString("base64url")}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function parseKey(rawKey: string): { keyId: string; secret: string } | null {
  const value = rawKey.trim();
  const separator = value.indexOf(".");
  if (separator <= 0) return null;
  const keyId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!keyId.startsWith(KEY_ID_PREFIX) || !secret) return null;
  return { keyId, secret };
}

export function resolveTomeApiKeyOwner(session: { sub?: unknown }): string | null {
  return typeof session.sub === "string" && session.sub.trim() ? session.sub.trim() : null;
}

export async function createTomeApiKey(input: {
  ownerSub: string;
  ownerEmail: string;
  ownerName: string;
  expiresInDays?: number;
}): Promise<{ key: string; keyId: string; createdAt: Date; expiresAt: Date }> {
  if (!isMongoDBConfigured) throw new Error("MongoDB unavailable for Tome API keys");
  const days = input.expiresInDays ?? MAX_EXPIRY_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
    throw new Error(`expiresInDays must be an integer between 1 and ${MAX_EXPIRY_DAYS}`);
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + days * 86_400_000);
  const keyId = `${KEY_ID_PREFIX}${randomId(KEY_ID_LENGTH)}`;
  const secret = randomBytes(SECRET_LENGTH).toString("base64url");
  const keys = await collection();

  // One active connector token per user keeps the lifecycle understandable:
  // minting a replacement immediately invalidates the previous credential.
  await keys.updateMany(
    { owner_user_id: input.ownerSub, status: "active" },
    { $set: { status: "revoked", revoked_at: createdAt } },
  );
  await keys.insertOne({
    key_id: keyId,
    key_hash: await hashSecret(keyId, secret),
    owner_user_id: input.ownerSub,
    owner_email: input.ownerEmail,
    owner_name: input.ownerName,
    created_at: createdAt,
    expires_at: expiresAt,
    revoked_at: null,
    status: "active",
  });

  return { key: `${keyId}.${secret}`, keyId, createdAt, expiresAt };
}

export async function getActiveTomeApiKey(ownerSub: string): Promise<TomeApiKeyMetadata | null> {
  if (!isMongoDBConfigured) return null;
  const key = await (await collection()).findOne(
    { owner_user_id: ownerSub, status: "active" },
    { projection: { key_id: 1, created_at: 1, expires_at: 1, revoked_at: 1, status: 1 } },
  );
  if (!key || key.expires_at <= new Date()) return null;
  return {
    key_id: key.key_id,
    created_at: key.created_at,
    expires_at: key.expires_at,
    revoked_at: key.revoked_at,
    status: key.status,
  };
}

export async function revokeActiveTomeApiKeys(ownerSub: string): Promise<boolean> {
  if (!isMongoDBConfigured) return false;
  const result = await (await collection()).updateMany(
    { owner_user_id: ownerSub, status: "active" },
    { $set: { status: "revoked", revoked_at: new Date() } },
  );
  return result.modifiedCount > 0;
}

/** Resolve a connector token into its owning interactive Tome identity. */
export async function verifyTomeApiKey(rawKey: string): Promise<TomeApiKeyIdentity | null> {
  if (!isMongoDBConfigured) return null;
  const parsed = parseKey(rawKey);
  if (!parsed) return null;

  const keys = await collection();
  const key = await keys.findOne(
    { key_id: parsed.keyId, status: "active" },
    {
      projection: {
        key_id: 1,
        key_hash: 1,
        owner_user_id: 1,
        owner_email: 1,
        owner_name: 1,
        expires_at: 1,
      },
    },
  );
  if (!key || key.expires_at <= new Date()) return null;

  const expected = await hashSecret(parsed.keyId, parsed.secret);
  if (!safeEqual(key.key_hash, expected)) return null;

  try {
    await keys.updateOne({ key_id: parsed.keyId }, { $set: { last_used_at: new Date() } });
  } catch {
    // Usage tracking must never turn a valid request into a failure.
  }

  return {
    sub: key.owner_user_id,
    email: key.owner_email,
    name: key.owner_name,
  };
}

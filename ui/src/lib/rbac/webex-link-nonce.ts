import crypto from "crypto";

import { getCollection } from "@/lib/mongodb";

const NONCE_TTL_MS = 10 * 60 * 1000;

export type WebexLinkNonceDoc = {
  nonce: string;
  webex_user_id: string;
  consumed?: boolean;
  created_at?: Date;
  expires_at?: Date;
  hmac_ts?: string;
};

export function isWebexLinkNonceExpired(doc: WebexLinkNonceDoc): boolean {
  const now = Date.now();
  if (doc.expires_at != null) {
    return doc.expires_at.getTime() < now;
  }
  if (doc.created_at != null) {
    return doc.created_at.getTime() + NONCE_TTL_MS < now;
  }
  return true;
}

export async function createWebexLinkNonce(webexUserId: string): Promise<{
  nonce: string;
  expiresAt: Date;
}> {
  const nonce = crypto.randomBytes(32).toString("hex");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + NONCE_TTL_MS);
  const coll = await getCollection<WebexLinkNonceDoc>("webex_link_nonces");
  await coll.insertOne({
    nonce,
    webex_user_id: webexUserId,
    consumed: false,
    created_at: createdAt,
    expires_at: expiresAt,
  });
  return { nonce, expiresAt };
}

export async function mintWebexLinkNonceFromHmac(
  webexUserId: string,
  hmacTs: string
): Promise<{ nonce: string; expiresAt: Date }> {
  const coll = await getCollection<WebexLinkNonceDoc>("webex_link_nonces");
  const existing = await coll.findOne({ webex_user_id: webexUserId, hmac_ts: hmacTs });
  if (existing) {
    if (existing.consumed) {
      throw new Error("HMAC link already used");
    }
    if (!isWebexLinkNonceExpired(existing)) {
      return {
        nonce: existing.nonce,
        expiresAt: existing.expires_at ?? new Date(Date.now() + NONCE_TTL_MS),
      };
    }
  }
  const nonce = crypto.randomBytes(32).toString("hex");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + NONCE_TTL_MS);
  await coll.insertOne({
    nonce,
    webex_user_id: webexUserId,
    hmac_ts: hmacTs,
    consumed: false,
    created_at: createdAt,
    expires_at: expiresAt,
  });
  return { nonce, expiresAt };
}

export async function findValidWebexLinkNonce(
  nonce: string,
  webexUserId: string
): Promise<WebexLinkNonceDoc | null> {
  const coll = await getCollection<WebexLinkNonceDoc>("webex_link_nonces");
  const doc = await coll.findOne({ nonce });
  if (!doc || doc.consumed === true || isWebexLinkNonceExpired(doc)) {
    return null;
  }
  if (doc.webex_user_id !== webexUserId) {
    return null;
  }
  return doc;
}

export async function consumeWebexLinkNonce(nonce: string, webexUserId: string): Promise<boolean> {
  const coll = await getCollection<WebexLinkNonceDoc>("webex_link_nonces");
  const result = await coll.updateOne(
    { nonce, webex_user_id: webexUserId, consumed: { $ne: true } },
    { $set: { consumed: true, consumed_at: new Date() } }
  );
  return result.modifiedCount === 1;
}

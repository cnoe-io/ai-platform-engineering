// assisted-by Codex Codex-sonnet-4-6
import crypto from 'crypto';

import { getCollection, isMongoDBConfigured } from './mongodb';

export interface StoredTokens {
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
}

export interface StoredTokenState extends StoredTokens {
  version: number;
}

export interface GetStoredTokensOptions {
  bypassL1?: boolean;
  minimumVersion?: number;
}

interface L1Entry {
  state: StoredTokenState;
  expiresAt: number; // unix seconds
}

interface TokenStoreDoc {
  _id: string;
  enc: string; // base64(iv[12] || authTag[16] || ciphertext)
  version?: number;
  accessTokenExpiresAt?: number;
  updatedAt: Date;
}

const COLLECTION = 'auth_token_cache';
const L1_TTL_S = 60; // seconds — short enough for cross-pod consistency
const HKDF_INFO = 'caipe-auth-token-store-v1';

const _l1 = new Map<string, L1Entry>();

function _deriveKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not set');
  return Buffer.from(crypto.hkdfSync('sha256', secret, '', HKDF_INFO, 32));
}

function _encrypt(tokens: StoredTokens): string {
  const key = _deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(tokens))),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function _decrypt(enc: string): StoredTokens {
  const key = _deriveKey();
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(),
  ) as StoredTokens;
}

function _l1Get(sub: string, minimumVersion: number): StoredTokenState | undefined {
  const entry = _l1.get(sub);
  if (!entry) return undefined;
  if (Math.floor(Date.now() / 1000) >= entry.expiresAt) {
    _l1.delete(sub);
    return undefined;
  }
  if (entry.state.version < minimumVersion) return undefined;
  return entry.state;
}

function _l1Set(sub: string, state: StoredTokenState): void {
  _l1.set(sub, {
    state,
    expiresAt: Math.floor(Date.now() / 1000) + L1_TTL_S,
  });
}

function _stateFromDoc(doc: TokenStoreDoc): StoredTokenState {
  return {
    ..._decrypt(doc.enc),
    version: doc.version ?? 0,
  };
}

function _versionFilter(doc: TokenStoreDoc): Record<string, unknown> {
  return doc.version === undefined
    ? { version: { $exists: false } }
    : { version: doc.version };
}

/**
 * Read stored OAuth tokens for a user.
 * L1 (in-memory, 60s TTL) is checked first when it is at least as new as the
 * version carried by the session cookie. A newer cookie version forces an L2
 * read so another replica's refresh becomes visible immediately.
 */
export async function getStoredTokens(
  sub: string | undefined,
  options: GetStoredTokensOptions = {},
): Promise<StoredTokenState | undefined> {
  if (!sub) return undefined;

  const minimumVersion = options.minimumVersion ?? 0;
  if (!options.bypassL1) {
    const l1 = _l1Get(sub, minimumVersion);
    if (l1) return l1;
  }

  if (!isMongoDBConfigured) return undefined;

  try {
    const col = await getCollection<TokenStoreDoc>(COLLECTION);
    const doc = await col.findOne({ _id: sub } as Parameters<typeof col.findOne>[0]);
    if (!doc) return undefined;
    const state = _stateFromDoc(doc);
    if (state.version < minimumVersion) return undefined;
    _l1Set(sub, state);
    return state;
  } catch (err) {
    console.error('[auth-token-store] MongoDB read error:', err);
    return undefined;
  }
}

/**
 * Persist OAuth tokens for a user.
 * MongoDB is authoritative when configured. The caller supplies the version it
 * originally read; a compare-and-swap prevents a stale replica from replacing
 * a newer refresh. The authoritative state is returned to the caller.
 */
export async function storeTokens(
  sub: string | undefined,
  tokens: StoredTokens,
  expectedVersion?: number,
): Promise<StoredTokenState | undefined> {
  if (!sub) return undefined;

  if (!isMongoDBConfigured) {
    const current = _l1Get(sub, 0);
    const state = {
      ...tokens,
      version: Math.max(current?.version ?? 0, expectedVersion ?? 0) + 1,
    };
    _l1Set(sub, state);
    return state;
  }

  try {
    const enc = _encrypt(tokens);
    const col = await getCollection<TokenStoreDoc>(COLLECTION);
    const current = await col.findOne({ _id: sub } as Parameters<typeof col.findOne>[0]);

    if (!current) {
      const inserted = await col.updateOne(
        { _id: sub } as Parameters<typeof col.updateOne>[0],
        {
          $setOnInsert: {
            enc,
            version: 1,
            accessTokenExpiresAt: tokens.expiresAt,
            updatedAt: new Date(),
          },
        },
        { upsert: true },
      );
      if (inserted.upsertedCount === 1) {
        const state = { ...tokens, version: 1 };
        _l1Set(sub, state);
        return state;
      }
    } else {
      const currentState = _stateFromDoc(current);
      const currentExpiry = current.accessTokenExpiresAt ?? currentState.expiresAt ?? 0;
      const incomingExpiry = tokens.expiresAt ?? 0;
      const tokensUnchanged =
        currentState.accessToken === tokens.accessToken &&
        currentState.refreshToken === tokens.refreshToken &&
        currentState.idToken === tokens.idToken &&
        currentState.expiresAt === tokens.expiresAt;

      if (tokensUnchanged) {
        _l1Set(sub, currentState);
        return currentState;
      }

      if (
        (expectedVersion !== undefined && currentState.version !== expectedVersion) ||
        currentExpiry > incomingExpiry
      ) {
        _l1Set(sub, currentState);
        return currentState;
      }

      const nextVersion = currentState.version + 1;
      const updated = await col.updateOne(
        {
          _id: sub,
          ..._versionFilter(current),
        } as Parameters<typeof col.updateOne>[0],
        {
          $set: {
            enc,
            version: nextVersion,
            accessTokenExpiresAt: tokens.expiresAt,
            updatedAt: new Date(),
          },
        },
      );
      if (updated.modifiedCount === 1) {
        const state = { ...tokens, version: nextVersion };
        _l1Set(sub, state);
        return state;
      }
    }

    // A peer won the insert/update race. Return its state instead of allowing
    // this replica's stale tokens to escape into the session.
    const authoritative = await col.findOne({ _id: sub } as Parameters<typeof col.findOne>[0]);
    if (authoritative) {
      const state = _stateFromDoc(authoritative);
      _l1Set(sub, state);
      return state;
    }
    return undefined;
  } catch (err) {
    console.error('[auth-token-store] MongoDB write error:', err);
    const state = { ...tokens, version: (expectedVersion ?? 0) + 1 };
    _l1Set(sub, state);
    return state;
  }
}

/** Clear the L1 cache. For testing only. */
export function resetTokenStore(): void {
  _l1.clear();
}

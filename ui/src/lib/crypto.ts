/**
 * Envelope Encryption
 *
 * Implements NIS2 Art.21(h) / OWASP ASVS V6.4 compliant secret storage.
 *
 * Pattern:
 *   NEXTAUTH_SECRET
 *     └─ HKDF-SHA256 → KEK (Key Encryption Key, never stored)
 *           └─ Per secret: random DEK (Data Encryption Key)
 *                 ├─ AES-256-GCM encrypt(plaintext, DEK)  → stored ciphertext
 *                 └─ AES-256-GCM encrypt(DEK, KEK)        → stored wrapped_dek
 *
 * Benefits:
 *   - Key rotation: re-wrap DEKs with new KEK; data untouched
 *   - Isolation: each secret has its own random DEK
 *   - Tamper detection: GCM authentication tags on both layers
 */

import crypto from 'crypto';
import { getSecret } from '@/lib/secret-manager';

/** Current key version — increment when rotating KEK derivation parameters */
const CURRENT_KEY_VERSION = 'v1';

export interface EnvelopeEncrypted {
  /** AES-256-GCM wrapped DEK (base64) */
  wrapped_dek: string;
  /** IV used to wrap the DEK (12 bytes, base64) */
  dek_iv: string;
  /** GCM auth tag for the wrapped DEK (16 bytes, base64) */
  dek_tag: string;
  /** AES-256-GCM encrypted plaintext (base64) */
  ciphertext: string;
  /** IV used to encrypt the plaintext (12 bytes, base64) */
  data_iv: string;
  /** GCM auth tag for the ciphertext (16 bytes, base64) */
  data_tag: string;
  /** KEK version identifier — used during key rotation */
  key_version: string;
}

/**
 * Derive the Key Encryption Key (KEK) from the master secret using HKDF-SHA256.
 * The KEK is derived deterministically but is never stored.
 */
function deriveKEK(masterSecret: string, keyVersion: string = CURRENT_KEY_VERSION): Buffer {
  const salt = Buffer.from(`caipe-kek-${keyVersion}`, 'utf8');
  const info = Buffer.from('key-encryption', 'utf8');
  const masterKey = Buffer.from(masterSecret, 'utf8');

  return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, info, 32));
}

/**
 * Encrypt a plaintext string using envelope encryption.
 * Returns a structured object safe to store in MongoDB.
 */
export function encryptSecret(plaintext: string): EnvelopeEncrypted {
  const masterSecret = getSecret();
  const kek = deriveKEK(masterSecret);

  // Generate a random Data Encryption Key
  const dek = crypto.randomBytes(32);

  // Encrypt the plaintext with the DEK (AES-256-GCM)
  const dataIv = crypto.randomBytes(12);
  const dataCipher = crypto.createCipheriv('aes-256-gcm', dek, dataIv);
  const ciphertext = Buffer.concat([
    dataCipher.update(plaintext, 'utf8'),
    dataCipher.final(),
  ]);
  const dataTag = dataCipher.getAuthTag();

  // Wrap the DEK with the KEK (AES-256-GCM)
  const dekIv = crypto.randomBytes(12);
  const dekCipher = crypto.createCipheriv('aes-256-gcm', kek, dekIv);
  const wrappedDek = Buffer.concat([
    dekCipher.update(dek),
    dekCipher.final(),
  ]);
  const dekTag = dekCipher.getAuthTag();

  return {
    wrapped_dek: wrappedDek.toString('base64'),
    dek_iv: dekIv.toString('base64'),
    dek_tag: dekTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    data_iv: dataIv.toString('base64'),
    data_tag: dataTag.toString('base64'),
    key_version: CURRENT_KEY_VERSION,
  };
}

/**
 * Decrypt an envelope-encrypted value.
 * Throws if the ciphertext or DEK authentication tags do not match (tamper detection).
 */
export function decryptSecret(encrypted: EnvelopeEncrypted): string {
  const masterSecret = getSecret();
  const kek = deriveKEK(masterSecret, encrypted.key_version);

  // Unwrap the DEK
  const dekDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    kek,
    Buffer.from(encrypted.dek_iv, 'base64'),
  );
  dekDecipher.setAuthTag(Buffer.from(encrypted.dek_tag, 'base64'));
  const dek = Buffer.concat([
    dekDecipher.update(Buffer.from(encrypted.wrapped_dek, 'base64')),
    dekDecipher.final(),
  ]);

  // Decrypt the plaintext with the DEK
  const dataDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    dek,
    Buffer.from(encrypted.data_iv, 'base64'),
  );
  dataDecipher.setAuthTag(Buffer.from(encrypted.data_tag, 'base64'));
  const plaintext = Buffer.concat([
    dataDecipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    dataDecipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/**
 * Re-wrap a DEK using a new master secret / key version.
 * Used during key rotation: decrypts the DEK with the old KEK, re-encrypts with the new KEK.
 * The data ciphertext is not touched.
 *
 * Two-phase rotation workflow:
 *   1. Admin calls this BEFORE updating NEXTAUTH_SECRET in the environment.
 *      Omit oldMasterSecret — it defaults to getSecret() which is still the old value.
 *   2. OR: Admin has already updated NEXTAUTH_SECRET and must pass the OLD secret
 *      explicitly via the API body so the DEK can still be unwrapped.
 *
 * @param oldMasterSecret - If provided, use this to unwrap the DEK (explicit old secret).
 *                          If omitted, uses the current NEXTAUTH_SECRET from the environment.
 */
export function rotateEnvelopeKey(
  encrypted: EnvelopeEncrypted,
  newMasterSecret: string,
  newKeyVersion: string = CURRENT_KEY_VERSION,
  oldMasterSecret?: string,
): EnvelopeEncrypted {
  // Unwrap DEK with old KEK — use explicit old secret if provided, otherwise current env
  const oldKek = deriveKEK(oldMasterSecret ?? getSecret(), encrypted.key_version);
  const dekDecipher = crypto.createDecipheriv(
    'aes-256-gcm',
    oldKek,
    Buffer.from(encrypted.dek_iv, 'base64'),
  );
  dekDecipher.setAuthTag(Buffer.from(encrypted.dek_tag, 'base64'));
  const dek = Buffer.concat([
    dekDecipher.update(Buffer.from(encrypted.wrapped_dek, 'base64')),
    dekDecipher.final(),
  ]);

  // Re-wrap DEK with new KEK
  const newKek = deriveKEK(newMasterSecret, newKeyVersion);
  const newDekIv = crypto.randomBytes(12);
  const newDekCipher = crypto.createCipheriv('aes-256-gcm', newKek, newDekIv);
  const newWrappedDek = Buffer.concat([
    newDekCipher.update(dek),
    newDekCipher.final(),
  ]);
  const newDekTag = newDekCipher.getAuthTag();

  return {
    ...encrypted,
    wrapped_dek: newWrappedDek.toString('base64'),
    dek_iv: newDekIv.toString('base64'),
    dek_tag: newDekTag.toString('base64'),
    key_version: newKeyVersion,
  };
}

/** Mask a secret value for safe display in API responses */
export const MASKED_SECRET = '••••••••';

/** Returns true if a value is an EnvelopeEncrypted object */
export function isEnvelopeEncrypted(value: unknown): value is EnvelopeEncrypted {
  return (
    typeof value === 'object' &&
    value !== null &&
    'wrapped_dek' in value &&
    'ciphertext' in value &&
    'key_version' in value
  );
}

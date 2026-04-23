/**
 * Local Authentication Library
 *
 * Handles the bootstrap admin account that exists before OIDC is configured.
 *
 * Security standards met:
 * - OWASP ASVS V2.4.4: Argon2id with m≥19MiB, t≥2, p≥1
 * - OWASP ASVS V2.8: TOTP (RFC 6238) with backup codes
 * - OWASP ASVS V2.1: Password policy (min 12 chars, breach list check)
 * - NIS2 Art.21(j): MFA enforced for the local admin account
 */

import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import crypto from 'crypto';
import { getCollection } from '@/lib/mongodb';
import { encryptSecret, decryptSecret, type EnvelopeEncrypted } from '@/lib/crypto';
import type { LocalUser } from '@/types/mongodb';

// ---------------------------------------------------------------------------
// Argon2id parameters (OWASP ASVS V2.4.4 compliant, with margin)
// ---------------------------------------------------------------------------
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

// Top-500 most common passwords (abbreviated — bundled to avoid external API)
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  '1234567890', 'qwerty', 'abc123', 'letmein', 'monkey', 'dragon', 'master',
  'sunshine', 'princess', 'welcome', 'shadow', 'superman', 'michael', 'football',
  'iloveyou', 'trustno1', 'batman', 'passw0rd', 'starwars', 'hello', 'charlie',
  'donald', 'password2', 'qwerty123', 'admin', 'login', 'test', 'user', 'root',
  'toor', 'changeme', 'secret', 'letmein1', '111111', '000000', 'aaaaaa',
]);

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePassword(password: string, email?: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must not exceed ${MAX_PASSWORD_LENGTH} characters.`);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('This password is too common. Please choose a more unique password.');
  }
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) {
    errors.push('Password must not contain your username or email address.');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// TOTP
// ---------------------------------------------------------------------------

export interface TOTPSetup {
  /** Encrypted TOTP secret for MongoDB storage */
  encryptedSecret: EnvelopeEncrypted;
  /** URI for QR code generation (otpauth://...) */
  otpauthUri: string;
  /** Base32 secret for manual entry */
  base32Secret: string;
}

export function generateTOTPSecret(email: string, issuer = 'CAIPE'): TOTPSetup {
  const totp = new OTPAuth.TOTP({
    issuer,
    label: email,
    algorithm: 'SHA1' as any,
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret({ size: 20 }),
  });

  const base32Secret = totp.secret.base32;
  const otpauthUri = totp.toString();
  const encryptedSecret = encryptSecret(base32Secret);

  return { encryptedSecret, otpauthUri, base32Secret };
}

export function verifyTOTP(encryptedSecret: EnvelopeEncrypted, token: string): boolean {
  try {
    const base32Secret = decryptSecret(encryptedSecret);
    const totp = new OTPAuth.TOTP({
      algorithm: 'SHA1' as any,
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
    // Allow ±1 window (30s drift tolerance)
    const delta = totp.validate({ token, window: 1 });
    return delta !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Backup codes (OWASP ASVS V2.8.4: single-use recovery codes)
// ---------------------------------------------------------------------------

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_LENGTH = 10; // 10 alphanumeric chars

export interface BackupCodesResult {
  /** Plaintext codes to show the user once */
  plainCodes: string[];
  /** Argon2id hashes to store in MongoDB */
  hashedCodes: string[];
}

export async function generateBackupCodes(): Promise<BackupCodesResult> {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = crypto
      .randomBytes(Math.ceil(BACKUP_CODE_LENGTH * 0.75))
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, BACKUP_CODE_LENGTH)
      .toUpperCase();

    plainCodes.push(code);
    hashedCodes.push(await argon2.hash(code, ARGON2_OPTIONS));
  }

  return { plainCodes, hashedCodes };
}

/**
 * Verify a backup code and mark it as used (single-use).
 * Returns true and updates the DB record if a match is found.
 */
export async function verifyAndConsumeBackupCode(
  email: string,
  code: string,
): Promise<boolean> {
  const collection = await getCollection<LocalUser>('local_users');
  const user = await collection.findOne({ email });
  if (!user || !user.backup_codes?.length) return false;

  for (let i = 0; i < user.backup_codes.length; i++) {
    const match = await argon2.verify(user.backup_codes[i], code.toUpperCase());
    if (match) {
      // Remove the used code
      const updatedCodes = [...user.backup_codes];
      updatedCodes.splice(i, 1);
      await collection.updateOne(
        { email },
        {
          $set: {
            backup_codes: updatedCodes,
            backup_codes_remaining: updatedCodes.length,
            updated_at: new Date(),
          },
        },
      );
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Setup token validation
// ---------------------------------------------------------------------------

/**
 * Validate a one-time setup token issued by POST /api/setup.
 * Returns true if the token is valid and not expired.
 * Uses a constant-time comparison to prevent timing attacks.
 */
export async function validateSetupToken(email: string, token: string): Promise<boolean> {
  const user = await getLocalUser(email);
  if (!user?.setup_token_hash || !user.setup_token_expires) return false;
  if (new Date() > user.setup_token_expires) return false;

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  // Constant-time comparison
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(user.setup_token_hash, 'hex'),
  );
}

/** Clear the setup token after successful TOTP activation. */
export async function clearSetupToken(email: string): Promise<void> {
  const collection = await getCollection<LocalUser>('local_users');
  await collection.updateOne(
    { email },
    { $set: { setup_token_hash: null, setup_token_expires: null, updated_at: new Date() } },
  );
}

// ---------------------------------------------------------------------------
// User CRUD
// ---------------------------------------------------------------------------

export async function getLocalUser(email: string): Promise<LocalUser | null> {
  const collection = await getCollection<LocalUser>('local_users');
  return collection.findOne({ email });
}

export async function createLocalUser(params: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<LocalUser> {
  const collection = await getCollection<LocalUser>('local_users');
  const now = new Date();
  const doc: Omit<LocalUser, '_id'> = {
    email: params.email,
    name: params.name,
    password_hash: params.passwordHash,
    totp_secret: null,
    totp_enabled: false,
    backup_codes: [],
    backup_codes_remaining: 0,
    role: 'admin',
    locked: false,
    locked_until: null,
    failed_attempts: 0,
    created_at: now,
    updated_at: now,
    last_login: null,
  };
  const result = await collection.insertOne(doc as any);
  return { _id: result.insertedId, ...doc } as LocalUser;
}

export async function recordFailedLogin(email: string): Promise<void> {
  const collection = await getCollection<LocalUser>('local_users');
  const user = await collection.findOne({ email });
  if (!user) return;

  const newAttempts = (user.failed_attempts ?? 0) + 1;
  const lockout = newAttempts >= 10;

  await collection.updateOne(
    { email },
    {
      $set: {
        failed_attempts: newAttempts,
        locked: lockout,
        locked_until: lockout ? new Date(Date.now() + 15 * 60 * 1000) : null,
        updated_at: new Date(),
      },
    },
  );
}

export async function recordSuccessfulLogin(email: string): Promise<void> {
  const collection = await getCollection<LocalUser>('local_users');
  await collection.updateOne(
    { email },
    {
      $set: {
        failed_attempts: 0,
        locked: false,
        locked_until: null,
        last_login: new Date(),
        updated_at: new Date(),
      },
    },
  );
}

export async function isAccountLocked(email: string): Promise<boolean> {
  const collection = await getCollection<LocalUser>('local_users');
  const user = await collection.findOne({ email });
  if (!user?.locked) return false;
  if (user.locked_until && user.locked_until < new Date()) {
    // Auto-unlock after timeout
    await collection.updateOne(
      { email },
      { $set: { locked: false, locked_until: null, failed_attempts: 0 } },
    );
    return false;
  }
  return true;
}

/** Returns true if at least one local admin account exists */
export async function localAdminExists(): Promise<boolean> {
  try {
    const collection = await getCollection<LocalUser>('local_users');
    const count = await collection.countDocuments({ role: 'admin' });
    return count > 0;
  } catch {
    return false;
  }
}

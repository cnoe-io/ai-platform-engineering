/**
 * POST /api/setup
 *
 * Creates the first admin user. Protected by:
 * - Atomic "no admin exists" guard (returns 403 if admin already exists)
 * - Rate limiting (5 requests per IP per hour)
 * - Password policy enforcement (min 12 chars, common password check)
 * - Argon2id password hashing (OWASP ASVS V2.4.4)
 *
 * This is the only unauthenticated write endpoint in the application.
 */

import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createLocalUser, hashPassword, validatePassword } from '@/lib/local-auth';
import { writeAuditLog, getClientIp } from '@/lib/audit-log';
import { RateLimits } from '@/lib/rate-limit';
import { isMongoDBConfigured, getCollection } from '@/lib/mongodb';
import type { LocalUser } from '@/types/mongodb';

const SETUP_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Generate a cryptographically random setup token and store its SHA-256 hash. */
async function issueSetupToken(email: string): Promise<string> {
  const plaintext = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex');
  const expires = new Date(Date.now() + SETUP_TOKEN_TTL_MS);
  const col = await getCollection<LocalUser>('local_users');
  await col.updateOne(
    { email },
    { $set: { setup_token_hash: hash, setup_token_expires: expires, updated_at: new Date() } },
  );
  return plaintext;
}

export async function POST(request: NextRequest) {
  // Rate limiting
  const ip = getClientIp(request);
  const rateLimit = RateLimits.setup(ip);
  if (!rateLimit.allowed) {
    await writeAuditLog({
      actor_email: 'anonymous',
      actor_ip: ip,
      action: 'admin.setup_completed',
      resource_type: 'local_auth',
      resource_id: 'setup',
      outcome: 'failure',
      metadata: { reason: 'rate_limited' },
    });
    return NextResponse.json(
      { error: 'Too many setup attempts. Please try again later.' },
      { status: 429 },
    );
  }

  if (!isMongoDBConfigured) {
    return NextResponse.json(
      { error: 'MongoDB is not configured. Set MONGODB_URI and MONGODB_DATABASE.' },
      { status: 503 },
    );
  }

  // Atomic guard: claim the setup lock before doing any work.
  //
  // Strategy: read first, then attempt conditional insert/update.
  // - If lock doc exists with status 'completed' → reject 403 immediately.
  // - If lock doc exists with status 'in_progress' → likely a crash; allow retry
  //   only if the user does not already exist (the caller can restart setup).
  // - If no lock doc → insert with $setOnInsert to ensure only one concurrent
  //   request "wins" the race (duplicate-key on second concurrent insert).
  const platformConfig = await getCollection<{ _id: string; status: string; started_at?: Date }>('platform_config');

  // First, read current lock state (avoids upsert duplicate-key on completed lock)
  const existingLock = await platformConfig.findOne({ _id: 'setup_lock' as any });
  if (existingLock?.status === 'completed') {
    return NextResponse.json(
      { error: 'Setup has already been completed.' },
      { status: 403 },
    );
  }

  // Attempt to claim the lock atomically (handles concurrent requests)
  try {
    await platformConfig.insertOne({
      _id: 'setup_lock' as any,
      status: 'in_progress',
      started_at: new Date(),
    });
  } catch (err: any) {
    // Duplicate key: another concurrent request already claimed the lock.
    // This can also mean a previous attempt crashed mid-setup.
    // Only allow proceeding if NO local user was actually created yet.
    if (err?.code !== 11000) throw err;
    const localUsers = await getCollection<LocalUser>('local_users');
    const anyUser = await localUsers.findOne({});
    if (anyUser) {
      // A user was created in a previous attempt — mark lock completed and reject
      await platformConfig.updateOne(
        { _id: 'setup_lock' as any },
        { $set: { status: 'completed', completed_at: new Date() } },
      );
      return NextResponse.json(
        { error: 'Setup has already been completed.' },
        { status: 403 },
      );
    }
    // No user exists yet — previous attempt crashed before creating user, allow retry
  }

  let body: { name?: string; email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { name, email, password } = body;

  if (!name?.trim() || !email?.trim() || !password) {
    return NextResponse.json(
      { error: 'Name, email, and password are required.' },
      { status: 400 },
    );
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }

  // Enforce password policy
  const passwordCheck = validatePassword(password, email.trim());
  if (!passwordCheck.valid) {
    return NextResponse.json(
      { error: passwordCheck.errors.join(' ') },
      { status: 400 },
    );
  }

  try {
    const passwordHash = await hashPassword(password);
    await createLocalUser({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      passwordHash,
    });

    // Issue the setup token FIRST — before marking setup complete.
    // If this fails, the lock stays in_progress and the operator can retry.
    // Marking 'completed' before the token is issued would leave an admin account
    // with no way to finish TOTP enrollment.
    const setupToken = await issueSetupToken(email.trim().toLowerCase());

    // Now mark the lock as completed — prevents any further setup attempts
    await platformConfig.updateOne(
      { _id: 'setup_lock' as any },
      { $set: { status: 'completed', completed_at: new Date() } },
    );

    await writeAuditLog({
      actor_email: email.trim().toLowerCase(),
      actor_ip: ip,
      action: 'admin.setup_completed',
      resource_type: 'local_auth',
      resource_id: email.trim().toLowerCase(),
      outcome: 'success',
      metadata: { name: name.trim() },
    });

    return NextResponse.json({ success: true, setup_token: setupToken });
  } catch (error) {
    console.error('[Setup] Error creating admin user:', error);
    await writeAuditLog({
      actor_email: email.trim().toLowerCase(),
      actor_ip: ip,
      action: 'admin.setup_completed',
      resource_type: 'local_auth',
      resource_id: email.trim().toLowerCase(),
      outcome: 'failure',
      metadata: { error: 'internal_error' },
    });
    return NextResponse.json({ error: 'Failed to create admin account.' }, { status: 500 });
  }
}

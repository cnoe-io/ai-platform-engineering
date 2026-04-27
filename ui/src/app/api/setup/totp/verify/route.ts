/**
 * POST /api/setup/totp/verify
 *
 * Verifies the first TOTP code from the admin's authenticator app and activates TOTP.
 * Must be called after POST /api/setup/totp to confirm the admin has successfully
 * enrolled their authenticator app.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getLocalUser, verifyTOTP, validateSetupToken } from '@/lib/local-auth';
import { writeAuditLog, getClientIp } from '@/lib/audit-log';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import type { LocalUser } from '@/types/mongodb';

export async function POST(request: NextRequest) {
  if (!isMongoDBConfigured) {
    return NextResponse.json({ error: 'MongoDB is not configured.' }, { status: 503 });
  }

  let body: { email?: string; token?: string; setup_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { email, token, setup_token } = body;
  if (!email || !token) {
    return NextResponse.json({ error: 'Email and TOTP token are required.' }, { status: 400 });
  }
  if (!setup_token) {
    return NextResponse.json({ error: 'setup_token is required.' }, { status: 400 });
  }

  // Validate the one-time setup token before activating TOTP
  const tokenValid = await validateSetupToken(email.toLowerCase(), setup_token);
  if (!tokenValid) {
    return NextResponse.json(
      { error: 'Invalid or expired setup token. Please restart the setup wizard.' },
      { status: 401 },
    );
  }

  const ip = getClientIp(request);
  const user = await getLocalUser(email.toLowerCase());

  if (!user || !user.totp_secret) {
    return NextResponse.json(
      { error: 'TOTP setup not initiated. Call POST /api/setup/totp first.' },
      { status: 400 },
    );
  }

  const valid = verifyTOTP(user.totp_secret, token);

  if (!valid) {
    await writeAuditLog({
      actor_email: email.toLowerCase(),
      actor_ip: ip,
      action: 'admin.totp_failed',
      resource_type: 'local_auth',
      resource_id: email.toLowerCase(),
      outcome: 'failure',
      metadata: { step: 'totp_activation_verify' },
    });
    return NextResponse.json({ error: 'Invalid TOTP code. Please try again.' }, { status: 400 });
  }

  // Activate TOTP and consume (clear) the one-time setup token
  const collection = await getCollection<LocalUser>('local_users');
  await collection.updateOne(
    { email: email.toLowerCase() },
    { $set: { totp_enabled: true, setup_token_hash: null, setup_token_expires: null, updated_at: new Date() } },
  );

  await writeAuditLog({
    actor_email: email.toLowerCase(),
    actor_ip: ip,
    action: 'admin.totp_activated',
    resource_type: 'local_auth',
    resource_id: email.toLowerCase(),
    outcome: 'success',
    metadata: { step: 'totp_activated' },
  });

  return NextResponse.json({ success: true });
}

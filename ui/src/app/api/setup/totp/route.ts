/**
 * POST /api/setup/totp
 *
 * Generates a TOTP secret for the newly created admin user.
 * Returns:
 *   - otpauthUri: the otpauth:// URI for QR code rendering
 *   - backupCodes: 10 plaintext single-use backup codes (shown once only)
 *
 * The TOTP secret is encrypted with envelope encryption before storage.
 * Backup codes are hashed with Argon2id before storage.
 *
 * A second call to POST /api/setup/totp/verify is required to activate TOTP
 * (admin must enter a valid code from their authenticator app to confirm setup).
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { generateTOTPSecret, generateBackupCodes, getLocalUser, validateSetupToken } from '@/lib/local-auth';
import { writeAuditLog, getClientIp } from '@/lib/audit-log';
import { getCollection, isMongoDBConfigured } from '@/lib/mongodb';
import type { LocalUser } from '@/types/mongodb';

/**
 * Build the TOTP issuer name and icon URL from the incoming request.
 * Issuer: "CAIPE (hostname)"  e.g. "CAIPE (localhost:3000)"
 * Image:  absolute URL to the CAIPE logo (used by apps that support the
 *         non-standard `image` otpauth parameter, e.g. FreeOTP, Aegis).
 */
function buildTotpMeta(request: NextRequest): { issuer: string; imageUrl: string } {
  const host = request.headers.get('host') || 'localhost';
  // Strip port — colons in the issuer break the otpauth label parser in most
  // authenticator apps (the label format is "issuer:account", so an extra
  // colon causes truncated / mis-parsed display names).
  const hostname = host.split(':')[0];
  const proto = hostname === 'localhost' || hostname.startsWith('127.') ? 'http' : 'https';
  const origin = `${proto}://${host}`;
  const issuer = `CAIPE (${hostname})`;
  // Use the app's favicon/logo as the authenticator icon
  const imageUrl = `${origin}/logo.svg`;
  return { issuer, imageUrl };
}

export async function POST(request: NextRequest) {
  if (!isMongoDBConfigured) {
    return NextResponse.json({ error: 'MongoDB is not configured.' }, { status: 503 });
  }

  let body: { email?: string; setup_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const { email, setup_token } = body;
  if (!email) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }
  if (!setup_token) {
    return NextResponse.json({ error: 'setup_token is required.' }, { status: 400 });
  }

  // Validate the one-time setup token issued by POST /api/setup
  const tokenValid = await validateSetupToken(email.toLowerCase(), setup_token);
  if (!tokenValid) {
    return NextResponse.json(
      { error: 'Invalid or expired setup token. Please restart the setup wizard.' },
      { status: 401 },
    );
  }

  const user = await getLocalUser(email.toLowerCase());
  if (!user) {
    return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  }

  if (user.totp_enabled) {
    return NextResponse.json({ error: 'TOTP is already enabled for this account.' }, { status: 409 });
  }

  try {
    const { issuer, imageUrl } = buildTotpMeta(request);
    const { encryptedSecret, otpauthUri: baseUri } = generateTOTPSecret(email, issuer);
    const { plainCodes, hashedCodes } = await generateBackupCodes();

    // Append the non-standard `image` parameter so authenticator apps that
    // support it (FreeOTP, Aegis, etc.) can display the CAIPE logo.
    const otpauthUri = `${baseUri}&image=${encodeURIComponent(imageUrl)}`;

    // Store encrypted secret and hashed backup codes (TOTP not yet enabled — requires verify step)
    const collection = await getCollection<LocalUser>('local_users');
    await collection.updateOne(
      { email: email.toLowerCase() },
      {
        $set: {
          totp_secret: encryptedSecret,
          backup_codes: hashedCodes,
          backup_codes_remaining: hashedCodes.length,
          updated_at: new Date(),
        },
      },
    );

    // Generate QR code as data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, {
      width: 256,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });

    const ip = getClientIp(request);
    await writeAuditLog({
      actor_email: email.toLowerCase(),
      actor_ip: ip,
      action: 'admin.totp_activated',
      resource_type: 'local_auth',
      resource_id: email.toLowerCase(),
      outcome: 'success',
      metadata: { step: 'totp_secret_generated' },
    });

    return NextResponse.json({
      success: true,
      qrCode: qrCodeDataUrl,
      backupCodes: plainCodes,
    });
  } catch (error) {
    console.error('[Setup TOTP] Error:', error);
    return NextResponse.json({ error: 'Failed to generate TOTP secret.' }, { status: 500 });
  }
}

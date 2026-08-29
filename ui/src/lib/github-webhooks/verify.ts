/** Constant-time GitHub webhook HMAC SHA-256 verification. */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookVerifyResult {
  valid: boolean;
  reason?:
    | "missing_signature"
    | "missing_delivery_id"
    | "malformed_signature"
    | "digest_mismatch"
    | "missing_secret";
}

const SIGNATURE_PREFIX = "sha256=";

export function verifyGitHubWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  deliveryHeader: string | null | undefined,
  secret: string | null | undefined,
): WebhookVerifyResult {
  if (!secret) return { valid: false, reason: "missing_secret" };
  if (!deliveryHeader) return { valid: false, reason: "missing_delivery_id" };
  if (!signatureHeader) return { valid: false, reason: "missing_signature" };
  if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return { valid: false, reason: "malformed_signature" };
  }

  const expectedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) {
    return { valid: false, reason: "malformed_signature" };
  }

  const computed = createHmac("sha256", secret).update(rawBody).digest();
  const expected = Buffer.from(expectedHex, "hex");
  if (computed.length !== expected.length) {
    return { valid: false, reason: "digest_mismatch" };
  }
  return timingSafeEqual(computed, expected)
    ? { valid: true }
    : { valid: false, reason: "digest_mismatch" };
}

/** Stable secret fingerprint for rotation checks; never use as a signature. */
export function hashWebhookSecret(secret: string): string {
  // Preserve the original fingerprint key so repositories onboarded through
  // the former Agentic SDLC route remain compatible after the shared-module
  // extraction.
  return createHmac("sha256", "ship-loop-secret-fingerprint")
    .update(secret)
    .digest("hex");
}

/**
 * GitHub webhook HMAC SHA-256 verification.
 *
 * Per FR-025: deliveries are accepted only when X-Hub-Signature-256
 * matches HMAC-SHA256(secret, raw_body).
 *
 * Implementation uses Node's `crypto` directly rather than
 * `@octokit/webhooks` Verifier so we can:
 *   1. Choose the secret per-repo (Octokit's verifier wants a single
 *      static secret),
 *   2. Run in jsdom-less unit tests without polyfilling Web Fetch
 *      globals.
 *
 * The function is constant-time over the digest comparison and
 * never throws for callable input — bad input returns
 * `{ valid: false, reason: "..." }`.
 */

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

/**
 * Verify a GitHub webhook delivery against a per-repo secret.
 *
 * @param rawBody  The raw request body (string or Buffer). Must be the
 *                 exact bytes GitHub signed; do NOT use a re-stringified
 *                 JSON object.
 * @param signatureHeader  Value of the X-Hub-Signature-256 header.
 * @param deliveryHeader  Value of the X-GitHub-Delivery header.
 * @param secret  Per-repo HMAC secret.
 */
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

  const computed = createHmac("sha256", secret)
    .update(rawBody)
    .digest();
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHex, "hex");
  } catch {
    return { valid: false, reason: "malformed_signature" };
  }

  if (computed.length !== expected.length) {
    // Different lengths can't be timingSafeEqual'd; this is not the
    // hot path so we log nothing and return mismatch.
    return { valid: false, reason: "digest_mismatch" };
  }

  const equal = timingSafeEqual(computed, expected);
  return equal ? { valid: true } : { valid: false, reason: "digest_mismatch" };
}

/**
 * Convenience: stable hash of the secret for storage/logging without
 * exposing the secret itself. We store this on `OnboardedRepo` so we
 * can detect when a secret rotation actually changed the value.
 *
 * Note: this is NOT for verifying signatures; use `verifyGitHubWebhook`
 * for that.
 */
export function hashWebhookSecret(secret: string): string {
  return createHmac("sha256", "ship-loop-secret-fingerprint")
    .update(secret)
    .digest("hex");
}

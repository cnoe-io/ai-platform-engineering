/**
 * @jest-environment node
 *
 * HMAC verification tests. Every code path in `verifyGitHubWebhook` is
 * exercised; these run under `node` because they use the native
 * `crypto` module and don't need jsdom.
 */
import { createHmac } from "node:crypto";
import {
  hashWebhookSecret,
  verifyGitHubWebhook,
} from "@/lib/agentic-sdlc/webhook-verify";

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

const BODY = JSON.stringify({ action: "opened", repository: { id: 1 } });
const SECRET = "s3cr3t-pilot";
const DELIVERY = "abc-123";

describe("verifyGitHubWebhook", () => {
  it("accepts a correctly signed delivery", () => {
    const sig = sign(SECRET, BODY);
    expect(
      verifyGitHubWebhook(BODY, sig, DELIVERY, SECRET),
    ).toEqual({ valid: true });
  });

  it("rejects on missing secret", () => {
    expect(
      verifyGitHubWebhook(BODY, sign(SECRET, BODY), DELIVERY, ""),
    ).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects on missing delivery id", () => {
    expect(
      verifyGitHubWebhook(BODY, sign(SECRET, BODY), null, SECRET),
    ).toEqual({ valid: false, reason: "missing_delivery_id" });
  });

  it("rejects on missing signature", () => {
    expect(verifyGitHubWebhook(BODY, null, DELIVERY, SECRET)).toEqual({
      valid: false,
      reason: "missing_signature",
    });
  });

  it("rejects on malformed signature prefix", () => {
    expect(
      verifyGitHubWebhook(BODY, "sha1=abc", DELIVERY, SECRET),
    ).toEqual({ valid: false, reason: "malformed_signature" });
  });

  it("rejects on non-hex signature", () => {
    expect(
      verifyGitHubWebhook(
        BODY,
        "sha256=" + "z".repeat(64),
        DELIVERY,
        SECRET,
      ),
    ).toEqual({ valid: false, reason: "malformed_signature" });
  });

  it("rejects on digest mismatch from a different secret", () => {
    expect(
      verifyGitHubWebhook(
        BODY,
        sign("wrong-secret", BODY),
        DELIVERY,
        SECRET,
      ),
    ).toEqual({ valid: false, reason: "digest_mismatch" });
  });

  it("rejects on body tampering", () => {
    const sig = sign(SECRET, BODY);
    expect(
      verifyGitHubWebhook(
        BODY + " ",
        sig,
        DELIVERY,
        SECRET,
      ),
    ).toEqual({ valid: false, reason: "digest_mismatch" });
  });

  it("treats a Buffer body the same as a string body", () => {
    const sig = sign(SECRET, BODY);
    expect(
      verifyGitHubWebhook(Buffer.from(BODY), sig, DELIVERY, SECRET),
    ).toEqual({ valid: true });
  });
});

describe("hashWebhookSecret", () => {
  it("returns a stable 64-char hex hash", () => {
    const a = hashWebhookSecret("hello");
    const b = hashWebhookSecret("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across secrets", () => {
    expect(hashWebhookSecret("a")).not.toBe(hashWebhookSecret("b"));
  });
});

import { interruptedAuthReason,interruptedTurnFallbackText } from "@/lib/chat-interrupt";
import { StreamError } from "@/lib/streaming";

describe("interruptedTurnFallbackText", () => {
  it.each(["not_signed_in", "session_expired", "bearer_invalid"])(
    "shows the sign-in hint for %s auth interruptions",
    (reason) => {
      expect(interruptedTurnFallbackText(reason)).toBe(
        "Session expired - signing you in again...",
      );
    },
  );

  it.each([undefined, "pdp_denied", "missing_role", "network_error"])(
    "keeps the generic interrupted copy for %s",
    (reason) => {
      expect(interruptedTurnFallbackText(reason)).toBe(
        "This response failed to complete. No content was generated.",
      );
    },
  );
});

describe("interruptedAuthReason", () => {
  it.each(["not_signed_in", "session_expired", "bearer_invalid"] as const)(
    "persists structured sign-in auth reason %s",
    (reason) => {
      expect(
        interruptedAuthReason(new StreamError("auth failed", 401, undefined, reason, "sign_in")),
      ).toBe(reason);
    },
  );

  it("falls back to session_expired when older auth errors only carry sign_in action", () => {
    expect(
      interruptedAuthReason(new StreamError("auth failed", 401, undefined, undefined, "sign_in")),
    ).toBe("session_expired");
  });

  it("does not persist non sign-in authz reasons", () => {
    expect(
      interruptedAuthReason(new StreamError("denied", 403, undefined, "missing_role", "contact_admin")),
    ).toBeUndefined();
  });
});

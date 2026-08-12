/**
 * @jest-environment node
 */

import { requireInteractiveTomePrincipal } from "@/lib/tome/principal";

describe("Tome principal boundary", () => {
  it.each(["catalog_api_key", "skills_api_key"])(
    "rejects %s principals",
    (principalType) => {
      try {
        requireInteractiveTomePrincipal({ principalType });
        throw new Error("expected scoped principal rejection");
      } catch (error) {
        expect(error).toMatchObject({
          statusCode: 403,
          code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED",
        });
      }
    },
  );

  it("rejects legacy catalog-key sessions", () => {
    try {
      requireInteractiveTomePrincipal({ catalogKey: "redacted" });
      throw new Error("expected catalog-key rejection");
    } catch (error) {
      expect(error).toMatchObject({ code: "TOME_INTERACTIVE_PRINCIPAL_REQUIRED" });
    }
  });

  it("allows interactive OIDC users", () => {
    expect(() =>
      requireInteractiveTomePrincipal({ principalType: "oidc_user" }),
    ).not.toThrow();
  });
});

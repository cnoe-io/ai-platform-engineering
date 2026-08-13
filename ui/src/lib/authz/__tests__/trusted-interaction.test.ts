import { createHmac } from "crypto";
import { trustedInteractionFromRequest } from "../trusted-interaction";

describe("trustedInteractionFromRequest", () => {
  beforeEach(() => {
    process.env.SLACK_LINK_HMAC_SECRET = "test-signing-secret";
    jest.spyOn(Date, "now").mockReturnValue(1_750_000_000_000);
  });

  afterEach(() => {
    delete process.env.SLACK_LINK_HMAC_SECRET;
    jest.restoreAllMocks();
  });

  function request(overrides: Record<string, string> = {}) {
    const timestamp = "1750000000";
    const payload = ["slack", "direct", timestamp, "POST", "/api/v1/chat/invoke"].join("\n");
    const signature = createHmac("sha256", "test-signing-secret").update(payload).digest("hex");
    const headers = new Headers({
        "x-caipe-interaction-source": "slack",
        "x-caipe-interaction-kind": "direct",
        "x-caipe-interaction-timestamp": timestamp,
        "x-caipe-interaction-signature": signature,
      ...overrides,
    });
    return { method: "POST", nextUrl: { pathname: "/api/v1/chat/invoke" }, headers };
  }

  it("accepts a current valid bot signature", () => {
    expect(trustedInteractionFromRequest(request())).toEqual({
      source: "slack",
      conversationKind: "direct",
      verified: true,
    });
  });

  it("fails closed for a forged signature", () => {
    expect(trustedInteractionFromRequest(request({
      "x-caipe-interaction-signature": "0".repeat(64),
    }))).toEqual({ source: "web", conversationKind: "personal", verified: false });
  });

  it("fails closed for a stale timestamp", () => {
    expect(trustedInteractionFromRequest(request({
      "x-caipe-interaction-timestamp": "1749999000",
    })).verified).toBe(false);
  });
});

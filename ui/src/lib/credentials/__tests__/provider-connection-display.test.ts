import { describe, expect, it } from "@jest/globals";

import {
  describeProviderConnectionHealth,
  formatProviderConnectionOptionLabel,
  formatRelativeRefreshLabel,
} from "../provider-connection-display";

describe("provider-connection-display", () => {
  it("describes healthy and expiring connections", () => {
    expect(describeProviderConnectionHealth({ status: "connected" })).toBe("healthy");
    expect(
      describeProviderConnectionHealth({
        status: "connected",
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }),
    ).toBe("expiring soon");
  });

  it("formats relative refresh labels", () => {
    const now = Date.parse("2026-06-22T12:00:00.000Z");
    expect(formatRelativeRefreshLabel("2026-06-22T11:30:00.000Z", now)).toBe("refreshed 30m ago");
  });

  it("builds readable provider connection option labels", () => {
    const label = formatProviderConnectionOptionLabel("Atlassian Cloud", {
      status: "connected",
      updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      profileSummary: "cisco-eti",
    });
    expect(label).toContain("Atlassian Cloud");
    expect(label).toContain("healthy");
    expect(label).toContain("refreshed 30m ago");
    expect(label).toContain("cisco-eti");
  });
});

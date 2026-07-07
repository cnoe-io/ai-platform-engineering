import { describe, expect, it } from "@jest/globals";

import {
  describeProviderConnectionHealth,
  formatExpiresInLabel,
  formatProviderConnectionOptionLabel,
  formatRelativeRefreshLabel,
  supportsProfileCheck,
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

  it("flags connected-but-non-renewable connections distinctly", () => {
    // A refresh-less connection (PKCE public client, pasted PAT) with a future
    // expiry is usable now but cannot auto-renew.
    expect(
      describeProviderConnectionHealth({
        status: "connected",
        renewable: false,
        expiresAt: new Date(Date.now() + 11 * 60 * 60_000),
      }),
    ).toBe("no auto-renew");
    // Within the expiring-soon window, the lapse warning takes precedence.
    expect(
      describeProviderConnectionHealth({
        status: "connected",
        renewable: false,
        expiresAt: new Date(Date.now() + 5 * 60_000),
      }),
    ).toBe("expiring soon");
    // No expiry at all ⇒ healthy regardless of renewable.
    expect(
      describeProviderConnectionHealth({ status: "connected", renewable: false }),
    ).toBe("healthy");
  });

  it("only reports profile-check support for providers with a profile endpoint", () => {
    for (const provider of ["github", "atlassian", "webex", "pagerduty", "gitlab"]) {
      expect(supportsProfileCheck(provider)).toBe(true);
    }
    // Custom MCP OAuth providers have no profile endpoint.
    expect(supportsProfileCheck("co2-dev")).toBe(false);
    expect(supportsProfileCheck(undefined)).toBe(false);
    expect(supportsProfileCheck("")).toBe(false);
  });

  it("formats expiry countdown labels", () => {
    const now = Date.parse("2026-06-22T12:00:00.000Z");
    expect(formatExpiresInLabel("2026-06-22T23:00:00.000Z", now)).toBe("expires in 11h");
    expect(formatExpiresInLabel("2026-06-25T12:00:00.000Z", now)).toBe("expires in 3d");
    expect(formatExpiresInLabel("2026-06-22T12:30:00.000Z", now)).toBe("expires in 30m");
    expect(formatExpiresInLabel("2026-06-22T11:00:00.000Z", now)).toBeUndefined();
    expect(formatExpiresInLabel(undefined, now)).toBeUndefined();
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

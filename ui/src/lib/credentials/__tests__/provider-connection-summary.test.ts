import { describe, expect, it } from "@jest/globals";

import { buildProviderProfileSummary } from "../provider-connection-summary";

describe("provider-connection-summary", () => {
  it("summarizes github and atlassian profiles", () => {
    expect(buildProviderProfileSummary("github", { login: "octocat" })).toBe("@octocat");
    expect(
      buildProviderProfileSummary("atlassian", undefined, [{ name: "cisco-eti" }]),
    ).toBe("cisco-eti");
  });
});

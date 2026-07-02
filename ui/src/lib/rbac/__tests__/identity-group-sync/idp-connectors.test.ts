import {
  fetchExternalGroupsForProvider,
  checkConnectorHealthForProvider,
} from "../../idp-connectors";

// The registry dispatches to the Okta connector; stub its module so these
// tests exercise registry dispatch without real Okta config.
jest.mock("../../okta-directory-connector", () => ({
  fetchOktaExternalGroups: jest.fn(async () => [{ external_group_id: "g1" }]),
  checkOktaConnectorHealth: jest.fn(async () => ({ ok: true, mode: "token" })),
  isOktaConnectorConfigured: jest.fn(() => true),
}));

describe("idp connector registry", () => {
  it("dispatches fetch + health to the registered connector", async () => {
    await expect(fetchExternalGroupsForProvider("okta")).resolves.toEqual([
      { external_group_id: "g1" },
    ]);
    await expect(checkConnectorHealthForProvider("okta")).resolves.toEqual({
      ok: true,
      mode: "token",
    });
  });

  it("throws for an unregistered provider instead of silently no-op", async () => {
    await expect(fetchExternalGroupsForProvider("duo")).rejects.toThrow(/no directory connector/i);
  });
});

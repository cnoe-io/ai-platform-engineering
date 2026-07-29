import { BUILT_IN_OAUTH_CONNECTORS } from "../built-in-oauth-connectors";

describe("built-in OAuth connectors for remote MCP providers", () => {
  it("defines Airtable as a public PKCE client with the official MCP scopes", () => {
    expect(
      BUILT_IN_OAUTH_CONNECTORS.find((connector) => connector.provider === "airtable"),
    ).toEqual({
      provider: "airtable",
      name: "Airtable",
      authorizationUrl: "https://airtable.com/oauth2/v1/authorize",
      tokenUrl: "https://airtable.com/oauth2/v1/token",
      scopes: [
        "data.records:read",
        "data.records:write",
        "schema.bases:read",
        "schema.bases:write",
        "data.recordComments:read",
        "data.recordComments:write",
        "workspacesAndBases:read",
      ],
      pkce: true,
    });
  });

  it("defines Box using its confidential-client OAuth endpoints", () => {
    expect(
      BUILT_IN_OAUTH_CONNECTORS.find((connector) => connector.provider === "box"),
    ).toEqual({
      provider: "box",
      name: "Box",
      authorizationUrl: "https://account.box.com/api/oauth2/authorize",
      tokenUrl: "https://api.box.com/oauth2/token",
      scopes: [],
    });
  });

  it("does not offer a Figma OAuth connector", () => {
    expect(
      BUILT_IN_OAUTH_CONNECTORS.some((connector) => connector.provider === "figma"),
    ).toBe(false);
  });
});

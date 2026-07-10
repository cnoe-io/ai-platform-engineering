import {
  configuredWebexBots,
  listWebexBotOptions,
  resolveWebexBotToken,
} from "../webex-bot-catalog";

const configured = JSON.stringify([
  { id: "primary", name: "Primary bot", tokenEnv: "PRIMARY_BOT_TOKEN" },
  { id: "secondary", name: "Secondary bot", tokenEnv: "SECONDARY_BOT_TOKEN" },
]);

describe("Webex bot catalog", () => {
  it("lists safe availability metadata without exposing token values or env names", () => {
    const options = listWebexBotOptions({
      WEBEX_INTEGRATION_BOTS_JSON: configured,
      PRIMARY_BOT_TOKEN: "primary-secret",
    });

    expect(options).toEqual([
      { id: "primary", name: "Primary bot", available: true },
      { id: "secondary", name: "Secondary bot", available: false },
    ]);
    expect(JSON.stringify(options)).not.toContain("primary-secret");
    expect(JSON.stringify(options)).not.toContain("PRIMARY_BOT_TOKEN");
  });

  it("resolves only configured bot IDs to their server-side token", () => {
    expect(resolveWebexBotToken("secondary", {
      WEBEX_INTEGRATION_BOTS_JSON: configured,
      SECONDARY_BOT_TOKEN: "secondary-secret",
    })).toEqual({ id: "secondary", name: "Secondary bot", token: "secondary-secret" });

    expect(() => resolveWebexBotToken("unknown", {
      WEBEX_INTEGRATION_BOTS_JSON: configured,
    })).toThrow("Unknown Webex bot");
  });

  it("rejects inline tokens and duplicate IDs", () => {
    expect(() => configuredWebexBots({
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "Primary bot", tokenEnv: "PRIMARY_BOT_TOKEN", token: "nope" },
      ]),
    })).toThrow("cannot contain an inline token");

    expect(() => configuredWebexBots({
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "One", tokenEnv: "ONE_TOKEN" },
        { id: "primary", name: "Two", tokenEnv: "TWO_TOKEN" },
      ]),
    })).toThrow("duplicate bot id primary");
  });
});

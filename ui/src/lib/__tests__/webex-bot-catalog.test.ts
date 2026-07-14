import {
  configuredWebexBots,
  defaultWebexBotId,
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

  it("uses an explicit default without depending on list order", () => {
    const explicit = {
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN" },
        { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN", default: true },
      ]),
      SECONDARY_TOKEN: "secondary-secret",
    };
    expect(defaultWebexBotId(explicit)).toBe("secondary");
    expect(resolveWebexBotToken(undefined, explicit).id).toBe("secondary");
  });

  it("recognizes the legacy token entry and a sole configured bot", () => {
    const legacy = {
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN" },
        {
          id: "primary",
          name: "Primary",
          tokenEnv: "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN",
        },
      ]),
    };
    expect(defaultWebexBotId(legacy)).toBe("primary");
    expect(defaultWebexBotId({
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "only", name: "Only", tokenEnv: "ONLY_TOKEN" },
      ]),
    })).toBe("only");
  });

  it("does not guess a default from an ambiguous multi-bot list", () => {
    const ambiguous = { WEBEX_INTEGRATION_BOTS_JSON: configured };
    expect(defaultWebexBotId(ambiguous)).toBeUndefined();
    expect(() => resolveWebexBotToken(undefined, ambiguous)).toThrow(
      "No default Webex bot is configured",
    );
  });

  it("rejects invalid or multiple default declarations", () => {
    expect(() => configuredWebexBots({
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN", default: "yes" },
      ]),
    })).toThrow("default must be a boolean");
    expect(() => configuredWebexBots({
      WEBEX_INTEGRATION_BOTS_JSON: JSON.stringify([
        { id: "primary", name: "Primary", tokenEnv: "PRIMARY_TOKEN", default: true },
        { id: "secondary", name: "Secondary", tokenEnv: "SECONDARY_TOKEN", default: true },
      ]),
    })).toThrow("only one default bot");
  });
});

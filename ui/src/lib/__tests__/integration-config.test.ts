/**
 * @jest-environment node
 */

import {
  getIntegrationAvailability,
  getSlackIntegrationToken,
  getWebexIntegrationToken,
  isSlackIntegrationEnabled,
  isWebexIntegrationEnabled,
} from "../integration-config";

const ENV_KEYS = [
  "COMPOSE_PROFILES",
  "SLACK_BOT_TOKEN",
  "SLACK_INTEGRATION_BOT_TOKEN",
  "SLACK_INTEGRATION_ENABLED",
  "SLACK_ADMIN_API_ENABLED",
  "SLACK_BOT_ADMIN_DEV_AUTH_ENABLED",
  "WEBEX_INTEGRATION_ENABLED",
  "WEBEX_INTEGRATION_BOT_ACCESS_TOKEN",
  "WEBEX_ACCESS_TOKEN",
  "WEBEX_TOKEN",
  "WEBEX_BOT_ADMIN_CLIENT_SECRET",
  "KEYCLOAK_WEBEX_BOT_ADMIN_CLIENT_SECRET",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

it("detects Slack from explicit flags or Compose profiles", () => {
  expect(isSlackIntegrationEnabled()).toBe(false);

  process.env.SLACK_INTEGRATION_ENABLED = "yes";
  expect(isSlackIntegrationEnabled()).toBe(true);

  delete process.env.SLACK_INTEGRATION_ENABLED;
  process.env.COMPOSE_PROFILES = "rbac, slack-bot";
  expect(isSlackIntegrationEnabled()).toBe(true);
});

it("detects Webex from a token, admin secret, or Compose profile", () => {
  expect(isWebexIntegrationEnabled()).toBe(false);

  process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "webex-token";
  expect(isWebexIntegrationEnabled()).toBe(true);

  delete process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN;
  process.env.WEBEX_BOT_ADMIN_CLIENT_SECRET = "admin-secret";
  expect(isWebexIntegrationEnabled()).toBe(true);

  delete process.env.WEBEX_BOT_ADMIN_CLIENT_SECRET;
  process.env.COMPOSE_PROFILES = "webex-bot";
  expect(isWebexIntegrationEnabled()).toBe(true);
});

it("ignores placeholder tokens and returns the configured token aliases", () => {
  process.env.SLACK_BOT_TOKEN = "<your-token>";
  process.env.SLACK_INTEGRATION_BOT_TOKEN = "slack-token";
  process.env.WEBEX_INTEGRATION_BOT_ACCESS_TOKEN = "# WEBEX_TOKEN";
  process.env.WEBEX_ACCESS_TOKEN = "webex-token";

  expect(getSlackIntegrationToken()).toBe("slack-token");
  expect(getWebexIntegrationToken()).toBe("webex-token");
});

it("returns both surface flags from the shared availability helper", () => {
  process.env.SLACK_ADMIN_API_ENABLED = "true";
  process.env.WEBEX_INTEGRATION_ENABLED = "on";

  expect(getIntegrationAvailability()).toEqual({ slack: true, webex: true });
});

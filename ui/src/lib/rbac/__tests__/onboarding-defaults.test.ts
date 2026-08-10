// assisted-by Cursor Claude:claude-opus-4-7
//
// Unit tests for `lib/rbac/onboarding-defaults`. The helper is the
// single source of truth for reading and writing the saved onboarding
// picks (team + agent + create_routes) for both the Slack and Webex
// admin panels. We pin three things:
//
//   1. DB-first read order (saved value wins over env).
//   2. Env-fallback when nothing has been written yet.
//   3. PUT persists the canonical shape and round-trips through GET.

/**
 * @jest-environment node
 */

const findOne = jest.fn();
const updateOne = jest.fn();
const getCollection = jest.fn(async () => ({ findOne, updateOne }));

jest.mock("@/lib/mongodb", () => ({
  getCollection: (...args: unknown[]) => getCollection(...args),
}));

import {
  OnboardingDefaultsValidationError,
  readOnboardingDefaults,
  writeOnboardingDefaults,
} from "@/lib/rbac/onboarding-defaults";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SLACK_DEFAULT_TEAM_SLUG;
  delete process.env.SLACK_DEFAULT_AGENT_ID;
  delete process.env.WEBEX_DEFAULT_TEAM_SLUG;
  delete process.env.WEBEX_DEFAULT_AGENT_ID;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("readOnboardingDefaults", () => {
  it("returns the DB value when one is saved (slack)", async () => {
    findOne.mockResolvedValue({
      _id: "platform_settings",
      onboarding_defaults: {
        slack: {
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: false,
          updated_at: new Date("2026-05-27T08:00:00.000Z"),
          updated_by: "admin@example.com",
        },
      },
    });

    const result = await readOnboardingDefaults("slack");

    expect(result).toEqual({
      team_slug: "platform-engineering",
      agent_id: "incident-agent",
      create_routes: false,
      updated_at: "2026-05-27T08:00:00.000Z",
      updated_by: "admin@example.com",
      source: "db",
    });
    expect(getCollection).toHaveBeenCalledWith("platform_config");
  });

  it("falls back to env vars when nothing is saved (webex)", async () => {
    findOne.mockResolvedValue(null);
    process.env.WEBEX_DEFAULT_TEAM_SLUG = "ops";
    process.env.WEBEX_DEFAULT_AGENT_ID = "ops-agent";

    const result = await readOnboardingDefaults("webex");

    expect(result).toEqual({
      team_slug: "ops",
      agent_id: "ops-agent",
      create_routes: true,
      updated_at: "",
      updated_by: "",
      source: "env",
    });
  });

  it("returns an unset placeholder when neither DB nor env have a value", async () => {
    findOne.mockResolvedValue({ _id: "platform_settings" });

    const result = await readOnboardingDefaults("slack");

    expect(result).toEqual({
      team_slug: "",
      agent_id: "",
      create_routes: true,
      updated_at: "",
      updated_by: "",
      source: "unset",
    });
  });

  it("treats a DB row carrying only updated_at as 'saved-but-cleared'", async () => {
    // Important: once the admin explicitly saves with empty values,
    // we must NOT silently fall through to env vars or they'd see the
    // stale env value reappear after they intentionally cleared the
    // pick. The presence of `updated_at` is the signal.
    findOne.mockResolvedValue({
      _id: "platform_settings",
      onboarding_defaults: {
        slack: {
          team_slug: "",
          agent_id: "",
          updated_at: new Date("2026-05-27T08:00:00.000Z"),
          updated_by: "admin@example.com",
        },
      },
    });
    process.env.SLACK_DEFAULT_TEAM_SLUG = "stale";

    const result = await readOnboardingDefaults("slack");

    expect(result.team_slug).toBe("");
    expect(result.source).toBe("db");
  });

  it("isolates slack and webex namespaces", async () => {
    findOne.mockResolvedValue({
      _id: "platform_settings",
      onboarding_defaults: {
        slack: { team_slug: "slack-team", agent_id: "slack-agent" },
      },
    });

    const slack = await readOnboardingDefaults("slack");
    const webex = await readOnboardingDefaults("webex");

    expect(slack.team_slug).toBe("slack-team");
    expect(webex.team_slug).toBe("");
    expect(webex.source).toBe("unset");
  });
});

describe("writeOnboardingDefaults", () => {
  it("upserts the persisted shape under the correct sub-key", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });

    const result = await writeOnboardingDefaults("webex", {
      team_slug: "platform-engineering",
      agent_id: "incident-agent",
      create_routes: false,
      actor: "admin@example.com",
    });

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = updateOne.mock.calls[0];
    expect(filter).toEqual({ _id: "platform_settings" });
    expect(options).toEqual({ upsert: true });
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set["onboarding_defaults.webex"]).toMatchObject({
      team_slug: "platform-engineering",
      agent_id: "incident-agent",
      create_routes: false,
      updated_by: "admin@example.com",
    });
    expect(set.updated_by).toBe("admin@example.com");
    expect(result.source).toBe("db");
    expect(result.team_slug).toBe("platform-engineering");
  });

  it("allows clearing the pick by passing empty strings", async () => {
    updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });

    const result = await writeOnboardingDefaults("slack", {
      team_slug: "",
      agent_id: "",
      create_routes: true,
      actor: "",
    });

    const [, update] = updateOne.mock.calls[0];
    const set = (update as { $set: Record<string, unknown> }).$set;
    expect(set["onboarding_defaults.slack"]).toMatchObject({
      team_slug: "",
      agent_id: "",
      // Empty actor falls back to "api" so audit logs always have a
      // non-blank attribution string.
      updated_by: "api",
    });
    expect(result.team_slug).toBe("");
    expect(result.updated_by).toBe("api");
  });

  it("rejects absurdly long values to protect the shared platform_config doc", async () => {
    await expect(
      writeOnboardingDefaults("slack", {
        team_slug: "x".repeat(257),
        agent_id: "ok",
        create_routes: true,
        actor: "admin@example.com",
      }),
    ).rejects.toBeInstanceOf(OnboardingDefaultsValidationError);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

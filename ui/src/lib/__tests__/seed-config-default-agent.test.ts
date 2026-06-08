/**
 * @jest-environment node
 *
 * Unit tests for the "Hello World" default-agent bootstrap in
 * `seed-config.ts`. The bootstrap is a first-run safety net that
 * provisions a minimal usable agent when the `dynamic_agents` collection
 * is empty after the YAML seed runs (or if the YAML seed was skipped).
 *
 * Behaviors under test:
 * 1. Inserts the Hello World agent when collection is empty.
 * 2. No-op when any agent already exists (YAML seed already populated).
 * 3. Returns false when MongoDB is not configured.
 * 4. Treats duplicate-key races as benign (returns false, no throw).
 *
 * assisted-by Cursor claude-opus-4-7
 */

const mockCollection = {
  countDocuments: jest.fn(),
  insertOne: jest.fn(),
};

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));

import {
  bootstrapDefaultDynamicAgentIfEmpty,
  bootstrapDefaultIdentityGroupSyncRuleIfEmpty,
  buildAutoCreateTeamsBootstrapRule,
  AUTO_CREATE_TEAMS_BOOTSTRAP_RULE_ID,
  HELLO_WORLD_AGENT_ID,
} from "../seed-config";

describe("bootstrapDefaultDynamicAgentIfEmpty", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("provisions the Hello World agent when dynamic_agents is empty", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    mockCollection.insertOne.mockResolvedValue({ insertedId: HELLO_WORLD_AGENT_ID });

    const created = await bootstrapDefaultDynamicAgentIfEmpty();

    expect(created).toBe(true);
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);

    const inserted = mockCollection.insertOne.mock.calls[0][0];
    expect(inserted._id).toBe(HELLO_WORLD_AGENT_ID);
    expect(inserted.name).toBe("Hello World");
    expect(inserted.enabled).toBe(true);
    expect(inserted.visibility).toBe("global");
    expect(inserted.owner_id).toBe("system");
    // Bootstrap-provisioned, not config-driven — admins must be able to
    // edit/delete it through the UI.
    expect(inserted.config_driven).toBe(false);
    // All four built-in tools enabled.
    expect(inserted.builtin_tools.fetch_url).toEqual({
      enabled: true,
      allowed_domains: "*",
    });
    expect(inserted.builtin_tools.current_datetime).toEqual({ enabled: true });
    expect(inserted.builtin_tools.user_info).toEqual({ enabled: true });
    expect(inserted.builtin_tools.sleep).toEqual({
      enabled: true,
      max_seconds: 60,
    });
    // Empty model is intentional — backend default is used.
    expect(inserted.model).toEqual({ id: "", provider: "" });
    expect(inserted.subagents).toEqual([]);
    expect(inserted.skills).toEqual([]);
  });

  it("is a no-op when any dynamic agent already exists", async () => {
    mockCollection.countDocuments.mockResolvedValue(1);

    const created = await bootstrapDefaultDynamicAgentIfEmpty();

    expect(created).toBe(false);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });

  it("treats a duplicate-key race as benign and returns false", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    const dupErr = Object.assign(new Error("E11000 duplicate key"), {
      code: 11000,
    });
    mockCollection.insertOne.mockRejectedValue(dupErr);

    await expect(bootstrapDefaultDynamicAgentIfEmpty()).resolves.toBe(false);
  });

  it("re-throws non-duplicate-key insert failures", async () => {
    mockCollection.countDocuments.mockResolvedValue(0);
    mockCollection.insertOne.mockRejectedValue(new Error("connection lost"));

    await expect(bootstrapDefaultDynamicAgentIfEmpty()).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("buildAutoCreateTeamsBootstrapRule", () => {
  it("returns a permissive default rule that matches every group claim", () => {
    const rule = buildAutoCreateTeamsBootstrapRule("2026-01-01T00:00:00Z");

    expect(rule.id).toBe(AUTO_CREATE_TEAMS_BOOTSTRAP_RULE_ID);
    // Wildcard so the catch-all applies to every IdP (login claims + Okta sync).
    expect(rule.provider_id).toBe("*");
    // Catch-all regex with a `team` named capture; matcher uses RegExp().
    expect(rule.include_patterns).toEqual(["^(?<team>.+)$"]);
    // Templates use Handlebars-style refs that the renderer substitutes
    // from the named capture.
    expect(rule.team_name_template).toBe("{{team}}");
    expect(rule.team_slug_template).toBe("{{team}}");
    // High numeric priority = lowest precedence per matcher's ascending
    // sort, so admin-authored rules always win.
    expect(rule.priority).toBe(1000);
    expect(rule.enabled).toBe(true);
    expect(rule.review_status).toBe("enabled");
    expect(rule.auto_create_team).toBe(true);
    // Empty role_map: the matcher's roleFromCapture defaults unmapped
    // roles to "member" — admins still come from BOOTSTRAP_ADMIN_EMAILS.
    expect(rule.role_map).toEqual({});
    expect(rule.created_by).toBe("system:auto-create-teams-bootstrap");
  });
});

describe("bootstrapDefaultIdentityGroupSyncRuleIfEmpty", () => {
  const ORIGINAL_ENV = process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS;
    } else {
      process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = ORIGINAL_ENV;
    }
  });

  it("provisions the bootstrap rule when env var is true and rules collection is empty", async () => {
    process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = "true";
    mockCollection.countDocuments.mockResolvedValue(0);
    mockCollection.insertOne.mockResolvedValue({
      insertedId: AUTO_CREATE_TEAMS_BOOTSTRAP_RULE_ID,
    });

    const created = await bootstrapDefaultIdentityGroupSyncRuleIfEmpty();

    expect(created).toBe(true);
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    const inserted = mockCollection.insertOne.mock.calls[0][0];
    expect(inserted.id).toBe(AUTO_CREATE_TEAMS_BOOTSTRAP_RULE_ID);
    expect(inserted.auto_create_team).toBe(true);
    expect(inserted.enabled).toBe(true);
  });

  it("is a no-op when the env var is unset", async () => {
    delete process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS;
    mockCollection.countDocuments.mockResolvedValue(0);

    const created = await bootstrapDefaultIdentityGroupSyncRuleIfEmpty();

    expect(created).toBe(false);
    expect(mockCollection.countDocuments).not.toHaveBeenCalled();
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });

  it("is a no-op when the env var is any non-true value", async () => {
    process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = "1";
    mockCollection.countDocuments.mockResolvedValue(0);

    const created = await bootstrapDefaultIdentityGroupSyncRuleIfEmpty();

    expect(created).toBe(false);
    expect(mockCollection.countDocuments).not.toHaveBeenCalled();
  });

  it("is a no-op when any rule already exists (admin-managed policy wins)", async () => {
    process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = "true";
    mockCollection.countDocuments.mockResolvedValue(3);

    const created = await bootstrapDefaultIdentityGroupSyncRuleIfEmpty();

    expect(created).toBe(false);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });

  it("treats a duplicate-key race as benign", async () => {
    process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = "true";
    mockCollection.countDocuments.mockResolvedValue(0);
    const dupErr = Object.assign(new Error("E11000"), { code: 11000 });
    mockCollection.insertOne.mockRejectedValue(dupErr);

    await expect(bootstrapDefaultIdentityGroupSyncRuleIfEmpty()).resolves.toBe(
      false,
    );
  });

  it("re-throws non-duplicate-key errors", async () => {
    process.env.IDENTITY_SYNC_LOGIN_AUTO_CREATE_TEAMS = "true";
    mockCollection.countDocuments.mockResolvedValue(0);
    mockCollection.insertOne.mockRejectedValue(new Error("connection lost"));

    await expect(bootstrapDefaultIdentityGroupSyncRuleIfEmpty()).rejects.toThrow(
      "connection lost",
    );
  });
});

describe("bootstrapDefaultDynamicAgentIfEmpty when MongoDB is unconfigured", () => {
  it("returns false without touching the collection", async () => {
    jest.resetModules();
    jest.doMock("@/lib/mongodb", () => ({
      isMongoDBConfigured: false,
      getCollection: jest.fn(),
    }));
    const { bootstrapDefaultDynamicAgentIfEmpty: bootstrapNoMongo } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("../seed-config");
    const { getCollection } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require("@/lib/mongodb");

    await expect(bootstrapNoMongo()).resolves.toBe(false);
    expect(getCollection).not.toHaveBeenCalled();
  });
});

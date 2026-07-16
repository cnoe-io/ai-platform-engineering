/**
 * @jest-environment node
 */

const mockCollection = {
  findOne: jest.fn(),
  updateOne: jest.fn(),
  createIndex: jest.fn(),
};

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => mockCollection),
}));

import {
  getUserPreference,
  setUserPreference,
  clearUserPreference,
  type UserPreferenceDocument,
} from "../user-preferences-store";

describe("user-preferences-store", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  });

  describe("getUserPreference", () => {
    it("returns null when no document exists for the user", async () => {
      mockCollection.findOne.mockResolvedValue(null);

      const result = await getUserPreference({ tenantId: "default", userId: "alice-sub" });

      expect(result).toEqual({ dm_default_agent_id: null, web_default_agent_id: null });
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        tenant_id: "default",
        user_id: "alice-sub",
      });
    });

    it("returns the saved agent id when one is present", async () => {
      mockCollection.findOne.mockResolvedValue({
        tenant_id: "default",
        user_id: "alice-sub",
        dm_default_agent_id: "agent-x",
      } satisfies Partial<UserPreferenceDocument>);

      const result = await getUserPreference({ tenantId: "default", userId: "alice-sub" });

      expect(result).toEqual({ dm_default_agent_id: "agent-x", web_default_agent_id: null });
    });

    it("returns the saved web default agent id independently of the DM default", async () => {
      mockCollection.findOne.mockResolvedValue({
        tenant_id: "default",
        user_id: "alice-sub",
        dm_default_agent_id: "agent-x",
        web_default_agent_id: "agent-web",
      } satisfies Partial<UserPreferenceDocument>);

      const result = await getUserPreference({ tenantId: "default", userId: "alice-sub" });

      expect(result).toEqual({
        dm_default_agent_id: "agent-x",
        web_default_agent_id: "agent-web",
      });
    });

    it("treats a stored null/undefined dm_default_agent_id as cleared", async () => {
      mockCollection.findOne.mockResolvedValue({
        tenant_id: "default",
        user_id: "alice-sub",
        dm_default_agent_id: null,
      });

      const result = await getUserPreference({ tenantId: "default", userId: "alice-sub" });

      expect(result).toEqual({ dm_default_agent_id: null, web_default_agent_id: null });
    });

    it("scopes reads by tenant", async () => {
      mockCollection.findOne.mockResolvedValue(null);
      await getUserPreference({ tenantId: "acme", userId: "alice-sub" });
      expect(mockCollection.findOne).toHaveBeenCalledWith({
        tenant_id: "acme",
        user_id: "alice-sub",
      });
    });
  });

  describe("setUserPreference", () => {
    it("upserts the saved agent id and refreshes updated_at", async () => {
      const before = Date.now();

      await setUserPreference({
        tenantId: "default",
        userId: "alice-sub",
        agentId: "agent-x",
      });

      const after = Date.now();
      expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockCollection.updateOne.mock.calls[0];
      expect(filter).toEqual({ tenant_id: "default", user_id: "alice-sub" });
      expect(options).toEqual({ upsert: true });
      expect(update.$set.dm_default_agent_id).toBe("agent-x");
      expect(update.$set.tenant_id).toBe("default");
      expect(update.$set.user_id).toBe("alice-sub");
      const updatedAt = new Date(update.$set.updated_at).getTime();
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
    });

    it("writes the web default field when field is web_default_agent_id", async () => {
      await setUserPreference({
        tenantId: "default",
        userId: "alice-sub",
        agentId: "agent-web",
        field: "web_default_agent_id",
      });

      const [, update] = mockCollection.updateOne.mock.calls[0];
      expect(update.$set.web_default_agent_id).toBe("agent-web");
      expect(update.$set.dm_default_agent_id).toBeUndefined();
    });

    it("rejects empty or malformed agent ids before touching Mongo", async () => {
      await expect(
        setUserPreference({ tenantId: "default", userId: "alice-sub", agentId: "" }),
      ).rejects.toThrow(/agent/i);
      await expect(
        setUserPreference({ tenantId: "default", userId: "alice-sub", agentId: "../bad" }),
      ).rejects.toThrow(/agent/i);
      expect(mockCollection.updateOne).not.toHaveBeenCalled();
    });

    it("rejects empty or malformed user ids before touching Mongo", async () => {
      await expect(
        setUserPreference({ tenantId: "default", userId: "", agentId: "agent-x" }),
      ).rejects.toThrow(/user/i);
      expect(mockCollection.updateOne).not.toHaveBeenCalled();
    });
  });

  describe("clearUserPreference", () => {
    it("upserts a row with dm_default_agent_id=null and refreshes updated_at", async () => {
      await clearUserPreference({ tenantId: "default", userId: "alice-sub" });

      expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update, options] = mockCollection.updateOne.mock.calls[0];
      expect(filter).toEqual({ tenant_id: "default", user_id: "alice-sub" });
      expect(options).toEqual({ upsert: true });
      expect(update.$set.dm_default_agent_id).toBeNull();
      expect(update.$set.tenant_id).toBe("default");
      expect(update.$set.user_id).toBe("alice-sub");
      expect(typeof update.$set.updated_at).toBe("string");
    });

    it("clears only the web default field when that field is requested", async () => {
      await clearUserPreference(
        { tenantId: "default", userId: "alice-sub" },
        "web_default_agent_id",
      );

      const [, update] = mockCollection.updateOne.mock.calls[0];
      expect(update.$set.web_default_agent_id).toBeNull();
      expect(update.$set.dm_default_agent_id).toBeUndefined();
    });
  });
});

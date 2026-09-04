/**
 * @jest-environment node
 */

jest.mock("@/lib/mongodb", () => {
  const collection = {
    updateMany: jest.fn(),
    insertOne: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  };
  return {
    getCollection: jest.fn().mockResolvedValue(collection),
    isMongoDBConfigured: true,
    __mockCollection: collection,
  };
});

const { __mockCollection: mockCollection } = jest.requireMock("@/lib/mongodb") as {
  __mockCollection: {
    updateMany: jest.Mock;
    insertOne: jest.Mock;
    findOne: jest.Mock;
    updateOne: jest.Mock;
  };
};

import {
  createTomeApiKey,
  getActiveTomeApiKey,
  revokeActiveTomeApiKeys,
  verifyTomeApiKey,
} from "@/lib/tome-api-keys";

describe("TOME API keys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.updateMany.mockResolvedValue({ modifiedCount: 1 });
    mockCollection.insertOne.mockResolvedValue({ acknowledged: true });
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("creates a user-owned, expiring key and revokes the previous active key", async () => {
    const created = await createTomeApiKey({
      ownerSub: "user-subject",
      ownerEmail: "user@example.test",
      ownerName: "Test User",
      expiresInDays: 30,
    });

    expect(created.key).toMatch(/^tome_[A-Za-z0-9]{16}\.[A-Za-z0-9_-]+$/);
    expect(mockCollection.updateMany).toHaveBeenCalledWith(
      { owner_user_id: "user-subject", status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "revoked" }) }),
    );
    expect(mockCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        key_id: created.keyId,
        owner_user_id: "user-subject",
        status: "active",
        key_hash: expect.stringMatching(/^scrypt:v1:/),
      }),
    );
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBe(
      30 * 86_400_000,
    );
  });

  it("resolves a valid key to the owning identity", async () => {
    const created = await createTomeApiKey({
      ownerSub: "owner-subject",
      ownerEmail: "owner@example.test",
      ownerName: "Owner",
    });
    const stored = mockCollection.insertOne.mock.calls[0][0];
    mockCollection.findOne.mockResolvedValue({
      ...stored,
      expires_at: created.expiresAt,
    });

    await expect(verifyTomeApiKey(created.key)).resolves.toEqual({
      sub: "owner-subject",
      email: "owner@example.test",
      name: "Owner",
    });
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { key_id: created.keyId },
      { $set: { last_used_at: expect.any(Date) } },
    );
  });

  it("rejects malformed, expired, and incorrectly signed keys", async () => {
    await expect(verifyTomeApiKey("not-a-tome-token")).resolves.toBeNull();

    mockCollection.findOne.mockResolvedValue({
      key_id: "tome_expired",
      key_hash: "scrypt:v1:invalid",
      owner_user_id: "owner-subject",
      owner_email: "owner@example.test",
      owner_name: "Owner",
      expires_at: new Date(Date.now() - 1),
    });
    await expect(verifyTomeApiKey("tome_expired.secret")).resolves.toBeNull();
  });

  it("returns metadata and revokes the current user's active key", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    mockCollection.findOne.mockResolvedValue({
      key_id: "tome_active",
      created_at: new Date(),
      expires_at: expiresAt,
      revoked_at: null,
      status: "active",
    });

    await expect(getActiveTomeApiKey("owner-subject")).resolves.toEqual(
      expect.objectContaining({ key_id: "tome_active", expires_at: expiresAt }),
    );
    await expect(revokeActiveTomeApiKeys("owner-subject")).resolves.toBe(true);
  });
});

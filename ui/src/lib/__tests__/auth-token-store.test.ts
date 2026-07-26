// assisted-by Codex Codex-sonnet-4-6
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock("../mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => ({
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  })),
}));

import { getStoredTokens, resetTokenStore, storeTokens } from "../auth-token-store";

describe("auth-token-store", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-auth-token-store";
    resetTokenStore();
    mockFindOne.mockReset();
    mockUpdateOne.mockReset();
  });

  afterEach(() => {
    delete process.env.NEXTAUTH_SECRET;
  });

  it("stores tokens in L1 and writes encrypted data to MongoDB", async () => {
    const tokens = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      expiresAt: 2_000_000_000,
    };
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 });

    await expect(storeTokens("user-1", tokens)).resolves.toEqual({
      ...tokens,
      version: 1,
    });

    expect(await getStoredTokens("user-1")).toEqual({ ...tokens, version: 1 });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { _id: "user-1" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          enc: expect.any(String),
          version: 1,
          accessTokenExpiresAt: tokens.expiresAt,
          updatedAt: expect.any(Date),
        }),
      }),
      { upsert: true },
    );

    const enc = mockUpdateOne.mock.calls[0][1].$setOnInsert.enc as string;
    expect(enc).not.toContain("access-token");
    expect(enc).not.toContain("refresh-token");
  });

  it("hydrates L1 from MongoDB on cache miss", async () => {
    const tokens = {
      accessToken: "l2-access",
      refreshToken: "l2-refresh",
      expiresAt: 2_000_000_000,
    };
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 });

    await storeTokens("user-2", tokens);
    const enc = mockUpdateOne.mock.calls[0][1].$setOnInsert.enc as string;
    resetTokenStore();
    mockFindOne.mockResolvedValue({
      _id: "user-2",
      enc,
      version: 1,
      accessTokenExpiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    });

    await expect(getStoredTokens("user-2")).resolves.toEqual({ ...tokens, version: 1 });
    mockFindOne.mockClear();
    await expect(getStoredTokens("user-2")).resolves.toEqual({ ...tokens, version: 1 });
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("bypasses a stale L1 entry when the session carries a newer version", async () => {
    const oldTokens = {
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: 2_000_000_000,
    };
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    await storeTokens("user-3", oldTokens);
    const oldEnc = mockUpdateOne.mock.calls[0][1].$setOnInsert.enc as string;

    mockFindOne.mockResolvedValue({
      _id: "user-3",
      enc: oldEnc,
      version: 1,
      accessTokenExpiresAt: oldTokens.expiresAt,
      updatedAt: new Date(),
    });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const newTokens = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 2_000_003_600,
    };
    await storeTokens("user-3", newTokens, 1);
    const newEnc = mockUpdateOne.mock.calls[1][1].$set.enc as string;

    resetTokenStore();
    mockFindOne.mockResolvedValueOnce({
      _id: "user-3",
      enc: oldEnc,
      version: 1,
      accessTokenExpiresAt: oldTokens.expiresAt,
      updatedAt: new Date(),
    });
    await expect(getStoredTokens("user-3")).resolves.toEqual({
      ...oldTokens,
      version: 1,
    });

    mockFindOne.mockResolvedValueOnce({
      _id: "user-3",
      enc: newEnc,
      version: 2,
      accessTokenExpiresAt: newTokens.expiresAt,
      updatedAt: new Date(),
    });
    await expect(getStoredTokens("user-3", { minimumVersion: 2 })).resolves.toEqual({
      ...newTokens,
      version: 2,
    });
  });

  it("does not let a stale replica overwrite a newer token record", async () => {
    const newTokens = {
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 2_000_003_600,
    };
    mockFindOne.mockResolvedValue(null);
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    await storeTokens("user-4", newTokens);
    const newEnc = mockUpdateOne.mock.calls[0][1].$setOnInsert.enc as string;

    resetTokenStore();
    mockFindOne.mockResolvedValue({
      _id: "user-4",
      enc: newEnc,
      version: 2,
      accessTokenExpiresAt: newTokens.expiresAt,
      updatedAt: new Date(),
    });
    mockUpdateOne.mockClear();

    await expect(storeTokens("user-4", {
      accessToken: "stale-access",
      refreshToken: "stale-refresh",
      expiresAt: 2_000_000_000,
    }, 1)).resolves.toEqual({
      ...newTokens,
      version: 2,
    });
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });
});

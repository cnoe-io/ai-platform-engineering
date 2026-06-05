/**
 * @jest-environment node
 */

import { createHmac } from "crypto";

const mockInsertOne = jest.fn();
const mockFind = jest.fn();
const mockFindOne = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: jest.fn(async () => ({
    insertOne: mockInsertOne,
    find: mockFind,
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  })),
}));

describe("catalog-api-keys", () => {
  beforeEach(() => {
    jest.resetModules();
    mockInsertOne.mockReset();
    mockFind.mockReset();
    mockFindOne.mockReset();
    mockUpdateOne.mockReset();
    process.env.CAIPE_CATALOG_API_KEY_PEPPER = "test-pepper";
  });

  it("createCatalogApiKey stores hashed secret and returns full key once", async () => {
    mockInsertOne.mockResolvedValue({ insertedId: "x" });
    const { createCatalogApiKey } = await import("@/lib/catalog-api-keys");
    const { key, key_id } = await createCatalogApiKey("user-sub-1");

    expect(key_id).toMatch(/^sk_[A-Za-z0-9]{12}$/);
    expect(key.startsWith(`${key_id}.`)).toBe(true);
    expect(mockInsertOne).toHaveBeenCalledTimes(1);
    const doc = mockInsertOne.mock.calls[0]![0] as {
      key_hash: string;
      owner_user_id: string;
      scopes: string[];
    };
    expect(doc.owner_user_id).toBe("user-sub-1");
    expect(doc.scopes).toEqual(["catalog:read"]);
    const secret = key.slice(key_id.length + 1);
    const expectedHash = createHmac("sha256", "test-pepper")
      .update(secret, "utf8")
      .digest("hex");
    expect(doc.key_hash).toBe(expectedHash);
  });

  it("verifyCatalogApiKey returns owner when hash matches", async () => {
    const secret = "abc123SECRET"; // gitleaks:allow
    const keyId = "sk_testkey1234";
    const keyHash = createHmac("sha256", "test-pepper")
      .update(secret, "utf8")
      .digest("hex");
    mockFindOne.mockResolvedValue({
      key_id: keyId,
      key_hash: keyHash,
      owner_user_id: "owner-a",
      revoked_at: null,
    });
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });

    const { verifyCatalogApiKey } = await import("@/lib/catalog-api-keys");
    const owner = await verifyCatalogApiKey(`${keyId}.${secret}`);
    expect(owner).toBe("owner-a");
  });

  it("revokeCatalogApiKey sets revoked_at", async () => {
    mockUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    const { revokeCatalogApiKey } = await import("@/lib/catalog-api-keys");
    const ok = await revokeCatalogApiKey("sk_deadbeef12");
    expect(ok).toBe(true);
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { key_id: "sk_deadbeef12" },
      expect.objectContaining({ $set: expect.objectContaining({ revoked_at: expect.any(Number) }) }),
    );
  });
});

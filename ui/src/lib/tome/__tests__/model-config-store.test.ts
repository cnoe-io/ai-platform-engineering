/** @jest-environment node */

const mockGetCollection = jest.fn();

jest.mock("@/lib/mongodb", () => ({
  isMongoDBConfigured: true,
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

import {
  deleteModelConfig,
  modelConfigId,
  parseModelScope,
  resolveModelConfig,
  updateModelConfig,
} from "../model-config-store";

const doc = (id: string, model: string, version = 1) => ({
  _id: id,
  scope_kind: id.split(":")[0],
  scope_id: id.split(":")[1] === "*" ? null : id.split(":")[1],
  role: "chat",
  model,
  version,
  tested_at: "2026-08-13T10:00:00.000Z",
  updated_at: "2026-08-13T10:00:00.000Z",
  updated_by: "admin@example.test",
});

describe("scoped model config store", () => {
  beforeEach(() => jest.clearAllMocks());

  it("builds stable exact/type/global document ids", () => {
    expect(modelConfigId({ kind: "global" }, "ingest")).toBe("global:*:ingest");
    expect(modelConfigId({ kind: "type", id: "area" }, "chat")).toBe("type:area:chat");
    expect(modelConfigId({ kind: "exact", id: "entity-1" }, "compact")).toBe(
      "exact:entity-1:compact",
    );
    expect(modelConfigId({ kind: "global" }, "presentation")).toBe(
      "global:*:presentation",
    );
  });

  it("rejects an unknown scope instead of silently treating it as global", () => {
    expect(() => parseModelScope("team", "primary")).toThrow("Model config validation failed");
  });

  it("resolves exact before type and global", async () => {
    const findOne = jest.fn(async ({ _id }: { _id: string }) => {
      const values: Record<string, ReturnType<typeof doc>> = {
        "exact:entity-1:chat": doc("exact:entity-1:chat", "model-exact", 3),
        "type:project:chat": doc("type:project:chat", "model-type", 2),
        "global:*:chat": doc("global:*:chat", "model-global"),
      };
      return values[_id] ?? null;
    });
    mockGetCollection.mockResolvedValue({ findOne });

    await expect(
      resolveModelConfig("chat", { entityId: "entity-1", entityType: "project" }),
    ).resolves.toMatchObject({ model: "model-exact", source: "exact", config_version: 3 });
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("falls through exact to type, then returns null when nothing is configured", async () => {
    const findOne = jest.fn(async ({ _id }: { _id: string }) =>
      _id === "type:area:chat" ? doc("type:area:chat", "model-type", 4) : null,
    );
    mockGetCollection.mockResolvedValue({ findOne });
    await expect(
      resolveModelConfig("chat", { entityId: "entity-2", entityType: "area" }),
    ).resolves.toMatchObject({ model: "model-type", source: "type", config_version: 4 });

    findOne.mockResolvedValue(null);
    await expect(
      resolveModelConfig("ingest", { entityId: "entity-2", entityType: "area" }),
    ).resolves.toBeNull();
  });

  it("versions tested writes and clears only the selected scope", async () => {
    const findOne = jest.fn().mockResolvedValue(doc("type:bhag:chat", "model-old", 7));
    const replaceOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const deleteOne = jest.fn().mockResolvedValue({ acknowledged: true });
    mockGetCollection.mockResolvedValue({ findOne, replaceOne, deleteOne });

    const updated = await updateModelConfig(
      { kind: "type", id: "bhag" },
      "chat",
      " model-new ",
      "admin@example.test",
      "2026-08-13T11:00:00.000Z",
    );
    expect(updated).toMatchObject({ _id: "type:bhag:chat", model: "model-new", version: 8 });
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "type:bhag:chat" },
      expect.objectContaining({ tested_at: "2026-08-13T11:00:00.000Z" }),
      { upsert: true },
    );

    await deleteModelConfig({ kind: "type", id: "bhag" }, "chat");
    expect(deleteOne).toHaveBeenCalledWith({ _id: "type:bhag:chat" });
  });
});

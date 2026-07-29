/**
 * @jest-environment node
 */

import {
  getDocumentParentModelStatus,
  repairDocumentParentModel,
} from "../openfga";

const ORIGINAL_FETCH = global.fetch;

function staleModel() {
  return {
    id: "model-stale",
    schema_version: "1.1",
    type_definitions: [
      { type: "user", relations: {} },
      {
        type: "document",
        relations: {
          reader: { this: {} },
          can_read: {
            union: {
              child: [{ computedUserset: { relation: "reader" } }],
            },
          },
          custom_relation: { this: {} },
        },
        metadata: {
          relations: {
            reader: {
              directly_related_user_types: [{ type: "user" }],
            },
          },
          custom_metadata: "preserve-me",
        },
      },
    ],
    conditions: {
      example_condition: {
        name: "example_condition",
        expression: "true",
        parameters: {},
      },
    },
  };
}

function healthyModel() {
  const model = staleModel();
  const document = model.type_definitions[1];
  document.relations.parent = { this: {} };
  document.relations.can_read.union.child.push({
    tupleToUserset: {
      tupleset: { relation: "parent" },
      computedUserset: { relation: "can_read" },
    },
  });
  document.metadata.relations.parent = {
    directly_related_user_types: [{ type: "document" }],
  };
  model.id = "model-current";
  return model;
}

describe("OpenFGA document parent model repair", () => {
  beforeEach(() => {
    process.env.OPENFGA_HTTP = "http://openfga.example.test";
    process.env.OPENFGA_STORE_ID = "store-example";
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.OPENFGA_HTTP;
    delete process.env.OPENFGA_STORE_ID;
  });

  it("detects a model that is missing Tome parent inheritance", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorization_models: [staleModel()] }),
    }) as unknown as typeof fetch;

    await expect(getDocumentParentModelStatus()).resolves.toEqual({
      healthy: false,
      activeModelId: "model-stale",
    });
  });

  it("adds only the missing parent relation, traversal, and metadata", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorization_models: [staleModel()] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ authorization_model_id: "model-repaired" }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(repairDocumentParentModel()).resolves.toEqual({
      healthy: true,
      activeModelId: "model-repaired",
      changed: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://openfga.example.test/stores/store-example/authorization-models?page_size=1",
    );
    const post = fetchMock.mock.calls[1];
    expect(post[0]).toBe(
      "http://openfga.example.test/stores/store-example/authorization-models",
    );
    expect(post[1]).toMatchObject({ method: "POST" });
    const body = JSON.parse(String(post[1]?.body)) as {
      type_definitions: Array<{
        type: string;
        relations: Record<string, unknown>;
        metadata: {
          relations: Record<string, unknown>;
          custom_metadata?: string;
        };
      }>;
      conditions?: Record<string, unknown>;
    };
    const document = body.type_definitions.find((definition) => definition.type === "document");
    expect(document?.relations.parent).toEqual({ this: {} });
    expect(document?.relations.custom_relation).toEqual({ this: {} });
    expect(document?.relations.can_read).toEqual({
      union: {
        child: [
          { computedUserset: { relation: "reader" } },
          {
            tupleToUserset: {
              tupleset: { relation: "parent" },
              computedUserset: { relation: "can_read" },
            },
          },
        ],
      },
    });
    expect(document?.metadata.relations.parent).toEqual({
      directly_related_user_types: [{ type: "document" }],
    });
    expect(document?.metadata.custom_metadata).toBe("preserve-me");
    expect(body.conditions).toHaveProperty("example_condition");
  });

  it("is idempotent when the active model is already healthy", async () => {
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorization_models: [healthyModel()] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(repairDocumentParentModel()).resolves.toEqual({
      healthy: true,
      activeModelId: "model-current",
      changed: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to rewrite an unfamiliar document can_read shape", async () => {
    const model = staleModel();
    model.type_definitions[1].relations.can_read = {
      computedUserset: { relation: "reader" },
    };
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorization_models: [model] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(repairDocumentParentModel()).rejects.toThrow(
      "cannot be repaired safely",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to overwrite an unfamiliar existing parent relation", async () => {
    const model = staleModel();
    model.type_definitions[1].relations.parent = {
      computedUserset: { relation: "reader" },
    };
    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ authorization_models: [model] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(repairDocumentParentModel()).rejects.toThrow(
      "document#parent relation has an unfamiliar shape",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

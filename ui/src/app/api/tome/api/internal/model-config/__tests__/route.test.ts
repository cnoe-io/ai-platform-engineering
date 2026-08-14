/** @jest-environment node */

const mockRequireAgentToken = jest.fn();
const mockResolveAllModelConfigs = jest.fn();

jest.mock("@/lib/tome/internal-api", () => ({
  requireAgentToken: (...args: unknown[]) => mockRequireAgentToken(...args),
}));
jest.mock("@/lib/tome/guard", () => ({ isTomeServerEnabled: () => true }));
jest.mock("@/lib/tome/model-config-store", () => ({
  resolveAllModelConfigs: (...args: unknown[]) => mockResolveAllModelConfigs(...args),
}));

import { GET } from "../route";
import { NextRequest } from "next/server";

describe("internal model resolver API", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires entity identity and type for scoped resolution", async () => {
    const response = await GET(
      new NextRequest("http://example.test/api/tome/api/internal/model-config"),
      {} as never,
    );
    expect(response.status).toBe(400);
    expect(mockResolveAllModelConfigs).not.toHaveBeenCalled();
  });

  it("returns resolved config with provenance", async () => {
    mockResolveAllModelConfigs.mockResolvedValue([
      { role: "ingest", model: "model-exact", source: "exact", config_version: 3 },
    ]);
    const response = await GET(
      new NextRequest(
        "http://example.test/api/tome/api/internal/model-config?entity_id=entity-1&entity_type=project",
      ),
      {} as never,
    );
    expect(response.status).toBe(200);
    expect(mockResolveAllModelConfigs).toHaveBeenCalledWith({
      entityId: "entity-1",
      entityType: "project",
    });
    await expect(response.json()).resolves.toEqual({
      models: [{ role: "ingest", model: "model-exact", source: "exact", config_version: 3 }],
    });
  });
});

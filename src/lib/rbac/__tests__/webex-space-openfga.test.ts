const mockReadOpenFgaTuples = jest.fn();

jest.mock("@/lib/rbac/openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

jest.mock("@/lib/api-middleware", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { listOpenFgaWebexSpaceAgentIds } from "../webex-space-openfga";

describe("listOpenFgaWebexSpaceAgentIds", () => {
  beforeEach(() => {
    mockReadOpenFgaTuples.mockReset();
  });

  it("includes the agent object type when reading Webex space tuples", async () => {
    mockReadOpenFgaTuples.mockResolvedValue({
      tuples: [
        { key: { user: "webex_space:CAIPE--space-1", relation: "user", object: "agent:agent-2" } },
        { key: { user: "webex_space:CAIPE--space-1", relation: "user", object: "agent:agent-1" } },
      ],
    });

    await expect(listOpenFgaWebexSpaceAgentIds("CAIPE", "space-1")).resolves.toEqual([
      "agent-1",
      "agent-2",
    ]);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith({
      tuple: {
        user: "webex_space:CAIPE--space-1",
        relation: "user",
        object: "agent:",
      },
      pageSize: 100,
    });
  });
});

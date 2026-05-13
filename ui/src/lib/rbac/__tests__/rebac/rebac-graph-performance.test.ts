const mockReadOpenFgaTuples = jest.fn();
const mockToArray = jest.fn();

jest.mock("../../openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
}));

jest.mock("../../mongo-collections", () => ({
  getRbacCollection: jest.fn(async () => ({
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ toArray: mockToArray }),
    }),
  })),
}));

describe("ReBAC graph performance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToArray.mockResolvedValue([]);
    mockReadOpenFgaTuples.mockResolvedValue({
      continuationToken: undefined,
      tuples: Array.from({ length: 500 }, (_, index) => ({
        key: {
          user: `team:team-${index % 20}#member`,
          relation: "can_use",
          object: `agent:agent-${index}`,
        },
      })),
    });
  });

  it("loads a filtered graph page without scanning beyond the requested page", async () => {
    const { queryRebacGraph } = await import("../../rebac-graph");
    const started = performance.now();
    const result = await queryRebacGraph({ resourceType: "agent", resourceId: "agent-42", limit: 100 });
    const elapsedMs = performance.now() - started;

    expect(result.edges).toHaveLength(1);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("loads a selected user's neighborhood with tuple-key reads instead of scanning all users", async () => {
    mockReadOpenFgaTuples.mockImplementation(async (options?: { tuple?: { user?: string } }) => {
      if (options?.tuple?.user === "user:alice-sub") {
        return {
          continuationToken: undefined,
          tuples: [
            {
              key: {
                user: "user:alice-sub",
                relation: "member",
                object: "team:platform",
              },
            },
          ],
        };
      }
      if (options?.tuple?.user === "team:platform#member") {
        return {
          continuationToken: undefined,
          tuples: [
            {
              key: {
                user: "team:platform#member",
                relation: "can_use",
                object: "agent:incident-agent",
              },
            },
          ],
        };
      }
      return { continuationToken: undefined, tuples: [] };
    });

    const { queryRebacGraph } = await import("../../rebac-graph");
    const result = await queryRebacGraph({ subject: "user:alice-sub", limit: 100 });

    expect(result.edges.map((edge) => [edge.from, edge.relation, edge.to])).toEqual([
      ["user:alice-sub", "member", "team:platform"],
      ["team:platform#member", "can_use", "agent:incident-agent"],
    ]);
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({ tuple: { user: "user:alice-sub" } })
    );
    expect(mockReadOpenFgaTuples).toHaveBeenCalledWith(
      expect.objectContaining({ tuple: { user: "team:platform#member" } })
    );
  });
});

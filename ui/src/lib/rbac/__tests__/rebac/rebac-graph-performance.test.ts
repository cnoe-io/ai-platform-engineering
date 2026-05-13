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
});

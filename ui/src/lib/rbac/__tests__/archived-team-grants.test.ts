/**
 * @jest-environment node
 *
 * Archiving a team must revoke every resource grant that flows through the
 * team's `#member` / `#admin` / `#owner` userset, since `team.status` is not
 * consulted anywhere in the OpenFGA authorization path.
 */

const mockReadOpenFgaTuples = jest.fn();
const mockDeleteExactOpenFgaTuples = jest.fn();
const mockIsOpenFgaReconciliationEnabled = jest.fn();

jest.mock("../openfga", () => ({
  readOpenFgaTuples: (...args: unknown[]) => mockReadOpenFgaTuples(...args),
  deleteExactOpenFgaTuples: (...args: unknown[]) => mockDeleteExactOpenFgaTuples(...args),
  isOpenFgaReconciliationEnabled: () => mockIsOpenFgaReconciliationEnabled(),
}));

import { __test__, stripArchivedTeamResourceGrants } from "../archived-team-grants";

const { archivedTeamSlugFromGrantSubject } = __test__;

function tuplePage(
  keys: Array<{ user: string; relation: string; object: string }>,
  continuationToken?: string,
) {
  return {
    tuples: keys.map((key) => ({ key })),
    continuationToken,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsOpenFgaReconciliationEnabled.mockReturnValue(true);
  mockReadOpenFgaTuples.mockResolvedValue(tuplePage([]));
  mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 0 });
});

describe("archivedTeamSlugFromGrantSubject", () => {
  it("matches team#member/admin/owner subjects against the archived-slug set", () => {
    const archived = new Set(["platform"]);
    expect(archivedTeamSlugFromGrantSubject("team:platform#member", archived)).toBe("platform");
    expect(archivedTeamSlugFromGrantSubject("team:platform#admin", archived)).toBe("platform");
    expect(archivedTeamSlugFromGrantSubject("team:platform#owner", archived)).toBe("platform");
  });

  it("returns null when the team slug is not in the archived set", () => {
    const archived = new Set(["platform"]);
    expect(archivedTeamSlugFromGrantSubject("team:other#member", archived)).toBeNull();
  });

  it("returns null for a non-team-grant userset relation", () => {
    const archived = new Set(["platform"]);
    expect(archivedTeamSlugFromGrantSubject("team:platform#caller", archived)).toBeNull();
  });

  it("never treats a plain user subject as a team grant", () => {
    const archived = new Set(["platform"]);
    expect(archivedTeamSlugFromGrantSubject("user:alice-sub", archived)).toBeNull();
  });
});

describe("stripArchivedTeamResourceGrants", () => {
  it("short-circuits on empty input without calling readOpenFgaTuples", async () => {
    const result = await stripArchivedTeamResourceGrants([]);

    expect(result).toEqual({
      teamsConsidered: 0,
      tuplesFound: 0,
      tuplesDeleted: 0,
      openFgaEnabled: true,
    });
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("short-circuits when OpenFGA reconciliation is disabled", async () => {
    mockIsOpenFgaReconciliationEnabled.mockReturnValue(false);

    const result = await stripArchivedTeamResourceGrants(["platform"]);

    expect(result).toEqual({
      teamsConsidered: 1,
      tuplesFound: 0,
      tuplesDeleted: 0,
      openFgaEnabled: false,
    });
    expect(mockReadOpenFgaTuples).not.toHaveBeenCalled();
    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
  });

  it("strips grant tuples for archived teams found across paginated reads", async () => {
    mockReadOpenFgaTuples
      .mockResolvedValueOnce(
        tuplePage(
          [
            { user: "team:platform#member", relation: "caller", object: "tool:custom-search" },
            { user: "user:alice-sub", relation: "member", object: "team:platform" },
          ],
          "page-2",
        ),
      )
      .mockResolvedValueOnce(
        tuplePage([
          { user: "team:platform#admin", relation: "manager", object: "mcp_server:mcp-confluence-mcp" },
        ]),
      );
    mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 2 });

    const result = await stripArchivedTeamResourceGrants(["platform"]);

    expect(mockReadOpenFgaTuples).toHaveBeenCalledTimes(2);
    expect(mockReadOpenFgaTuples).toHaveBeenNthCalledWith(1, {
      continuationToken: undefined,
      pageSize: 100,
    });
    expect(mockReadOpenFgaTuples).toHaveBeenNthCalledWith(2, {
      continuationToken: "page-2",
      pageSize: 100,
    });
    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      { user: "team:platform#member", relation: "caller", object: "tool:custom-search" },
      { user: "team:platform#admin", relation: "manager", object: "mcp_server:mcp-confluence-mcp" },
    ]);
    expect(result).toEqual({
      teamsConsidered: 1,
      tuplesFound: 2,
      tuplesDeleted: 2,
      openFgaEnabled: true,
    });
  });

  it("excludes grant tuples for teams not in the archived set", async () => {
    mockReadOpenFgaTuples.mockResolvedValue(
      tuplePage([
        { user: "team:platform#member", relation: "caller", object: "tool:custom-search" },
        { user: "team:other-team#member", relation: "caller", object: "tool:other-tool" },
      ]),
    );
    mockDeleteExactOpenFgaTuples.mockResolvedValue({ enabled: true, writes: 0, deletes: 1 });

    const result = await stripArchivedTeamResourceGrants(["platform"]);

    expect(mockDeleteExactOpenFgaTuples).toHaveBeenCalledWith([
      { user: "team:platform#member", relation: "caller", object: "tool:custom-search" },
    ]);
    expect(result).toEqual({
      teamsConsidered: 1,
      tuplesFound: 1,
      tuplesDeleted: 1,
      openFgaEnabled: true,
    });
  });

  it("never strips plain user membership tuples where a team is the object", async () => {
    mockReadOpenFgaTuples.mockResolvedValue(
      tuplePage([
        { user: "user:alice-sub", relation: "member", object: "team:platform" },
        { user: "user:bob-sub", relation: "admin", object: "team:platform" },
      ]),
    );

    const result = await stripArchivedTeamResourceGrants(["platform"]);

    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
    expect(result).toEqual({
      teamsConsidered: 1,
      tuplesFound: 0,
      tuplesDeleted: 0,
      openFgaEnabled: true,
    });
  });

  it("returns a zero result without deleting when no grants are found", async () => {
    mockReadOpenFgaTuples.mockResolvedValue(tuplePage([]));

    const result = await stripArchivedTeamResourceGrants(["platform"]);

    expect(mockDeleteExactOpenFgaTuples).not.toHaveBeenCalled();
    expect(result).toEqual({
      teamsConsidered: 1,
      tuplesFound: 0,
      tuplesDeleted: 0,
      openFgaEnabled: true,
    });
  });
});

const mockGraphql = jest.fn();

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({ graphql: mockGraphql })),
}));

import { listDiscussionsAcrossRepos } from "@/lib/github-discussion-link";

describe("github-discussion-link", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("normalizes labeled GitHub Discussions into the shared cached item shape", async () => {
    mockGraphql.mockResolvedValue({
      repository: {
        discussions: {
          nodes: [{
            number: 52,
            title: "Architecture direction",
            bodyText: "Proposal body",
            url: "https://github.com/example/service/discussions/52",
            closed: false,
            stateReason: null,
            createdAt: "2026-08-20T00:00:00Z",
            updatedAt: "2026-08-27T00:00:00Z",
            closedAt: null,
            author: { login: "discussion-author" },
            category: { name: "Ideas" },
            labels: { nodes: [{ name: "decision" }, { name: "critical" }] },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });

    await expect(
      listDiscussionsAcrossRepos("token", ["example/service"]),
    ).resolves.toEqual([
      expect.objectContaining({
        contentType: "discussion",
        repo: "example/service",
        number: 52,
        state: "open",
        displayStatus: "open",
        priority: "critical",
        labels: ["decision", "critical"],
        category: "Ideas",
        assignees: [],
      }),
    ]);
  });
});

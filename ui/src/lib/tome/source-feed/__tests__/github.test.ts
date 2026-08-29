import { fetchGithubActivity } from "@/lib/tome/source-feed/github";

function response(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("GitHub source activity", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("carries labels on issue and discussion events", async () => {
    const fetchMock = jest.spyOn(global, "fetch")
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response([{
        number: 42,
        title: "Choose a storage engine",
        html_url: "https://github.com/example/service/issues/42",
        created_at: "2026-08-27T12:00:00Z",
        closed_at: null,
        user: { login: "test-user" },
        labels: [{ name: "decision" }],
      }]))
      .mockResolvedValueOnce(response({
        data: {
          repository: {
            discussions: {
              nodes: [{
                number: 7,
                title: "Architecture direction",
                url: "https://github.com/example/service/discussions/7",
                createdAt: "2026-08-27T13:00:00Z",
                updatedAt: "2026-08-27T13:00:00Z",
                closedAt: null,
                author: { login: "test-user" },
                labels: { nodes: [{ name: "decision" }, { name: "critical" }] },
              }],
            },
          },
        },
      }))
      .mockResolvedValueOnce(response([]));

    const events = await fetchGithubActivity({
      repo: "example/service",
      token: "test-token",
      sinceIso: "2026-08-27T00:00:00Z",
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(events).toEqual([
      expect.objectContaining({
        artifact: "discussion",
        event: "discussion_opened",
        labels: ["decision", "critical"],
      }),
      expect.objectContaining({
        artifact: "issue",
        event: "issue_opened",
        labels: ["decision"],
      }),
    ]);
  });
});

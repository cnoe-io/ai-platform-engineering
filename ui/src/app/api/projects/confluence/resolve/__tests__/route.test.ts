/**
 * @jest-environment node
 */

import { NextRequest } from "next/server";

const mockListConnections = jest.fn();
const mockRefreshConnection = jest.fn();

jest.mock("@/lib/api-middleware", () => {
  const actual = jest.requireActual("@/lib/api-middleware");
  return {
    ...actual,
    getAuthFromBearerOrSession: jest.fn(async () => ({
      user: { email: "test-user@example.test" },
      session: {
        sub: "test-user-subject",
        user: { email: "test-user@example.test" },
      },
    })),
  };
});

jest.mock("@/lib/credentials/oauth-service-factory", () => ({
  getProviderConnectionService: jest.fn(async () => ({
    listConnections: mockListConnections,
    refreshConnection: mockRefreshConnection,
  })),
}));

import { POST } from "../route";

function request(url: string): NextRequest {
  return new NextRequest(
    "http://example.test/api/projects/confluence/resolve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    },
  );
}

describe("POST /api/projects/confluence/resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListConnections.mockResolvedValue([
      {
        id: "atlassian-connection",
        provider: "atlassian",
        status: "connected",
      },
    ]);
    mockRefreshConnection.mockResolvedValue({ accessToken: "test-token" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("accepts a moved page and returns its canonical current-space URL", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "cloud-id",
              url: "https://example.atlassian.net",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Overview",
                content: {
                  id: "12345",
                  title: "Overview",
                  space: { key: "CURRENT" },
                  ancestors: [],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

    const response = await POST(
      request(
        "https://example.atlassian.net/wiki/spaces/STALE/pages/12345/Overview",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      kind: "page",
      source_url:
        "https://example.atlassian.net/wiki/spaces/CURRENT/pages/12345",
      scope: {
        page_id: "12345",
        page_title: "Overview",
        space_key: "CURRENT",
        include_descendants: true,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a browsable hierarchy for a space URL", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "cloud-id",
              url: "https://example.atlassian.net",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Architecture",
                content: {
                  id: "200",
                  title: "Architecture",
                  space: { key: "PLATFORM" },
                  ancestors: [{ id: "100", title: "Overview" }],
                },
              },
              {
                title: "Overview",
                content: {
                  id: "100",
                  title: "Overview",
                  space: { key: "PLATFORM" },
                  ancestors: [],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const response = await POST(
      request("https://example.atlassian.net/wiki/spaces/platform"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      kind: "space",
      source_url: "https://example.atlassian.net/wiki/spaces/PLATFORM",
      space_key: "PLATFORM",
      truncated: false,
      pages: [
        expect.objectContaining({
          id: "100",
          title: "Overview",
          parent_id: null,
          depth: 0,
        }),
        expect.objectContaining({
          id: "200",
          title: "Architecture",
          parent_id: "100",
          depth: 1,
        }),
      ],
    });
  });

  it("follows Confluence cursor links and deduplicates repeated pages", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "cloud-id",
              url: "https://example.atlassian.net",
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                content: {
                  id: "100",
                  title: "Overview",
                  space: { key: "PLATFORM" },
                  ancestors: [],
                },
              },
            ],
            _links: {
              next:
                "/rest/api/search?limit=100&cursor=opaque-token" +
                "&cql=space%3D%22platform%22%20and%20type%3Dpage" +
                "&expand=content.space%2Ccontent.ancestors",
            },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                content: {
                  id: "100",
                  title: "Overview",
                  space: { key: "PLATFORM" },
                  ancestors: [],
                },
              },
              {
                content: {
                  id: "200",
                  title: "Architecture",
                  space: { key: "PLATFORM" },
                  ancestors: [{ id: "100", title: "Overview" }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const response = await POST(
      request("https://example.atlassian.net/wiki/spaces/platform"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.pages).toHaveLength(2);
    expect(body.data.pages).toEqual([
      expect.objectContaining({ id: "100", parent_id: null }),
      expect.objectContaining({ id: "200", parent_id: "100" }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const cursorUrl = String(fetchMock.mock.calls[2]?.[0]);
    expect(cursorUrl).toContain("cursor=opaque-token");
    expect(cursorUrl).not.toContain("start=");
  });
});

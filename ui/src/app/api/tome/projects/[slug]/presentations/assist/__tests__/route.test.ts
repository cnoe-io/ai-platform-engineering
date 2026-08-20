/** @jest-environment node */

import { NextRequest } from "next/server";

const mockLoadTomeProject = jest.fn();
const mockListPages = jest.fn();
const mockFetch = jest.fn();

jest.mock("@/lib/tome/tome-api", () => ({
  loadTomeProject: (...args: unknown[]) => mockLoadTomeProject(...args),
}));
jest.mock("@/lib/tome/page-store", () => ({
  getPageStore: jest.fn().mockImplementation(async () => ({
    listPages: (...args: unknown[]) => mockListPages(...args),
  })),
}));

import { POST } from "../route";

const context = { params: Promise.resolve({ slug: "example-project" }) };
const suggestedRequirements = {
  goal: "Align sponsors on readiness",
  key_message: "The evidence supports a decision",
  audience: "Project sponsors",
  slide_count: 7,
  duration_minutes: 12,
  tone: "executive",
  technical_detail: "balanced",
  required_sections: "Context, readiness, risks, next steps",
  excluded_topics: "Unsupported forecasts",
  visual_mode: "diagrams",
  visual_preferences: "Simple milestone visuals",
  include_speaker_notes: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.TOME_AGENT_URL = "http://tome-agent:8000";
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { _id: "project-1", slug: "example-project", name: "Example Project", type: "project" },
  });
  mockListPages.mockResolvedValue({
    "overview.md": "---\ntitle: Overview\nkind: stable\n---\nVisible <!-- agent-only -->",
    "memory.md": "---\ntitle: Memory\nkind: hidden\n---\nHidden notes",
  });
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue(new Response([
    "event: status\ndata: {\"message\":\"Reviewing sources\"}\n\n",
    "event: token\ndata: {\"text\":\"{\\\"goal\\\":\"}\n\n",
    `event: complete\ndata: ${JSON.stringify({
      requirements: suggestedRequirements,
      model: "claude-sonnet-4-6",
      model_source: "global",
    })}\n\n`,
  ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
});

afterAll(() => {
  delete process.env.TOME_AGENT_URL;
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://example.test/api/tome/projects/example-project/presentations/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST presentation AI Assist", () => {
  it("resolves source bodies server-side and relays the agent stream", async () => {
    const response = await POST(request({
      source_scope: "selected",
      paths: ["overview.md"],
      current_requirements: { goal: "Current goal" },
      instruction: "Focus on the launch decision",
    }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const stream = await response.text();
    expect(stream).toContain("event: token");
    expect(stream).toContain("event: complete");
    expect(stream).toContain("Align sponsors on readiness");
    const upstream = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "http://tome-agent:8000/presentation/requirements/stream",
    );
    expect(upstream.sources).toEqual([{ path: "overview.md", title: "Overview", content: "Visible" }]);
    expect(upstream.instruction).toBe("Focus on the launch decision");
  });

  it("excludes hidden pages from full-wiki AI Assist", async () => {
    await POST(request({ source_scope: "wiki", paths: [] }), context);
    const upstream = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(upstream.sources.map((source: { path: string }) => source.path)).toEqual(["overview.md"]);
  });

  it("rejects source paths outside the authorized page store", async () => {
    const response = await POST(request({
      source_scope: "selected",
      paths: ["private.md"],
    }), context);
    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

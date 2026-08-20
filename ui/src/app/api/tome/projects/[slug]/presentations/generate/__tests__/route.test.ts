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
const deck = {
  title: "Briefing",
  subtitle: "",
  slides: [{
    id: "overview",
    title: "Overview",
    subtitle: "",
    bullets: [{ text: "Grounded fact", source_refs: ["overview.md"], generated: false }],
    visual: null,
    speaker_notes: "",
  }],
};

function agentStream(
  generatedDeck: unknown,
  model = "claude-sonnet-4-6",
): Response {
  return new Response([
    "event: status\ndata: {\"message\":\"Generating deck\"}\n\n",
    "event: token\ndata: {\"text\":\"{\\\"title\\\":\"}\n\n",
    `event: complete\ndata: ${JSON.stringify({
      deck: generatedDeck,
      model,
      model_source: "global",
    })}\n\n`,
  ].join(""), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function completeEvent(stream: string): Record<string, unknown> {
  const frame = stream.split("\n\n").find((candidate) => candidate.startsWith("event: complete"));
  if (!frame) throw new Error("Missing complete event");
  const data = frame.split("\n").find((line) => line.startsWith("data:"));
  if (!data) throw new Error("Missing complete event data");
  return JSON.parse(data.slice(5).trim()) as Record<string, unknown>;
}

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
  mockFetch.mockResolvedValue(agentStream(deck));
});

afterAll(() => {
  delete process.env.TOME_AGENT_URL;
});

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://example.test/api/tome/projects/example-project/presentations/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST presentation generation", () => {
  it("resolves selected source bodies server-side and strips agent guidance", async () => {
    const response = await POST(request({
      source_scope: "selected",
      paths: ["overview.md"],
      prompt: "Confirmed prompt",
    }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    const upstream = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(mockFetch.mock.calls[0][0]).toBe("http://tome-agent:8000/presentation/stream");
    expect(upstream.sources).toEqual([{ path: "overview.md", title: "Overview", content: "Visible" }]);
    expect(upstream.prompt).toBe("Confirmed prompt");
  });

  it("excludes hidden pages from full-wiki generation", async () => {
    await POST(request({ source_scope: "wiki", paths: [], prompt: "Confirmed prompt" }), context);
    const upstream = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(upstream.sources.map((source: { path: string }) => source.path)).toEqual(["overview.md"]);
  });

  it.each(["current", "selected"])("rejects hidden pages from %s scope", async (sourceScope) => {
    const response = await POST(request({
      source_scope: sourceScope,
      paths: ["memory.md"],
      prompt: "Confirmed prompt",
    }), context);
    expect(response.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a page path that is not in the authorized project page store", async () => {
    const response = await POST(request({
      source_scope: "selected",
      paths: ["private-project.md"],
      prompt: "Confirmed prompt",
    }), context);
    expect(response.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects model output that cites an unselected page", async () => {
    mockFetch.mockResolvedValueOnce(agentStream({
      ...deck,
      slides: [{ ...deck.slides[0], bullets: [{ text: "Bad", source_refs: ["memory.md"] }] }],
    }));
    const response = await POST(request({
      source_scope: "selected",
      paths: ["overview.md"],
      prompt: "Confirmed prompt",
    }), context);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("event: error");
  });

  it("forwards revision fields and restores non-target slides after a slide revision", async () => {
    const existingDeck = {
      ...deck,
      slides: [
        deck.slides[0],
        {
          ...deck.slides[0],
          id: "next-steps",
          title: "Next steps",
          bullets: [{ text: "Original next step", source_refs: [], generated: true }],
        },
      ],
    };
    mockFetch.mockResolvedValueOnce(agentStream({
        ...existingDeck,
        slides: [
          {
            ...existingDeck.slides[0],
            title: "Revised overview",
          },
          {
            ...existingDeck.slides[1],
            title: "Unexpected model edit",
          },
          {
            ...existingDeck.slides[1],
            id: "unexpected-slide",
            title: "Unexpected model slide",
          },
        ],
      }));

    const response = await POST(request({
      source_scope: "selected",
      paths: ["overview.md"],
      prompt: "Confirmed prompt",
      existing_deck: existingDeck,
      revision_instruction: "Revise the overview",
      slide_id: "overview",
    }), context);

    expect(response.status).toBe(200);
    const upstream = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(upstream).toMatchObject({
      existing_deck: existingDeck,
      revision_instruction: "Revise the overview",
      slide_id: "overview",
    });
    const body = completeEvent(await response.text());
    const revisedDeck = body.deck as typeof existingDeck;
    expect(revisedDeck.slides.map((slide) => slide.id)).toEqual(["overview", "next-steps"]);
    expect(revisedDeck.slides[0].title).toBe("Revised overview");
    expect(revisedDeck.slides[1]).toEqual(existingDeck.slides[1]);
  });
});

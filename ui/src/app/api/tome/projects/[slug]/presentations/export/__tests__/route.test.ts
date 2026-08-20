/** @jest-environment node */

import { NextRequest } from "next/server";

const releaseNameDescriptor = Object.getOwnPropertyDescriptor(process.release, "name")!;
beforeAll(() => Object.defineProperty(process.release, "name", { value: "jest", configurable: true }));
afterAll(() => Object.defineProperty(process.release, "name", releaseNameDescriptor));

const mockLoadTomeProject = jest.fn();
const mockListPages = jest.fn();

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
const originalTomePublicOrigin = process.env.TOME_PUBLIC_ORIGIN;
const originalNextAuthUrl = process.env.NEXTAUTH_URL;

beforeEach(() => {
  delete process.env.TOME_PUBLIC_ORIGIN;
  delete process.env.NEXTAUTH_URL;
});

afterEach(() => {
  if (originalTomePublicOrigin === undefined) delete process.env.TOME_PUBLIC_ORIGIN;
  else process.env.TOME_PUBLIC_ORIGIN = originalTomePublicOrigin;
  if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = originalNextAuthUrl;
});

it("exports a valid editable PowerPoint after resolving project access", async () => {
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { title: "Example Project" },
  });
  mockListPages.mockResolvedValue({ "overview.md": "# Overview" });
  const response = await POST(new NextRequest(
    "http://example.test/api/tome/projects/example-project/presentations/export",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deck: {
          title: "Example briefing",
          subtitle: "",
          slides: [{
            id: "overview",
            title: "Overview",
            subtitle: "",
            bullets: [{ text: "Fact", source_refs: ["overview.md"], generated: false }],
            visual: null,
            speaker_notes: "",
          }],
        },
      }),
    },
  ), context);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("presentationml.presentation");
  expect(response.headers.get("Content-Disposition")).toContain("example-project-example-briefing.pptx");
  expect(bytes.subarray(0, 2).toString("ascii")).toBe("PK");
});

it("exports a self-contained HTML presentation", async () => {
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { title: "Example Project" },
  });
  mockListPages.mockResolvedValue({ "overview.md": "# Overview" });
  const response = await POST(new NextRequest(
    "http://example.test/api/tome/projects/example-project/presentations/export",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format: "html",
        deck: {
          title: "Example briefing",
          subtitle: "",
          slides: [{
            id: "overview",
            title: "Overview",
            subtitle: "",
            bullets: [{ text: "Fact", source_refs: ["overview.md"], generated: false }],
            visual: null,
            speaker_notes: "Introduce the source.",
          }],
        },
      }),
    },
  ), context);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Content-Disposition")).toContain("example-project-example-briefing.html");
  expect(html).toContain("Overview");
  expect(html).toContain("[1] http://example.test/projects/example-project/tome/wiki/overview.md");
  expect(html).toContain("href=\"http://example.test/projects/example-project/tome/wiki/overview.md\"");
  expect(html).toContain("Introduce the source.");
});

it("uses the external forwarded origin for downloadable source links", async () => {
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { title: "Example Project" },
  });
  mockListPages.mockResolvedValue({ "overview.md": "# Overview" });
  const response = await POST(new NextRequest(
    "http://0.0.0.0:3000/api/tome/projects/example-project/presentations/export",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Host": "tome.example.test",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({
        format: "html",
        deck: {
          title: "Example briefing",
          subtitle: "",
          slides: [{
            id: "overview",
            title: "Overview",
            subtitle: "",
            bullets: [{ text: "Fact", source_refs: ["overview.md"], generated: false }],
            visual: null,
            speaker_notes: "",
          }],
        },
      }),
    },
  ), context);
  const html = await response.text();
  expect(html).toContain(
    "href=\"https://tome.example.test/projects/example-project/tome/wiki/overview.md\"",
  );
  expect(html).not.toContain("http://0.0.0.0:3000");
});

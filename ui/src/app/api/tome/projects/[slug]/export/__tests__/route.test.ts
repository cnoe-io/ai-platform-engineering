/** @jest-environment node */

import { NextRequest } from "next/server";

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

import { GET } from "@/app/api/tome/projects/[slug]/export/route";

const context = { params: Promise.resolve({ slug: "example-project" }) };

beforeEach(() => {
  mockLoadTomeProject.mockResolvedValue({
    projectId: "project-1",
    project: { title: "Example Project" },
  });
  mockListPages.mockResolvedValue({
    "overview.md": `---
title: Overview
kind: stable
---
# Summary

Visible. <!-- hidden guidance -->`,
  });
});

describe("GET Tome wiki export", () => {
  it("downloads sanitized Markdown", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/markdown");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-wiki.md"',
    );
    const body = await response.text();
    expect(body).toContain("# Example Project");
    expect(body).toContain("Visible.");
    expect(body).not.toContain("hidden guidance");
  });

  it("exports only the requested page", async () => {
    mockListPages.mockResolvedValue({
      "overview.md": `---\ntitle: Overview\nkind: stable\n---\nOverview content.`,
      "roadmap.md": `---\ntitle: Roadmap\nkind: dynamic\n---\nRoadmap content.`,
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=markdown&path=roadmap.md",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-roadmap.md"',
    );
    const body = await response.text();
    expect(body).toBe("# Roadmap\n\nRoadmap content.\n");
    expect(body).not.toContain("Contents");
    expect(body).not.toContain("roadmap.md");
    expect(body).not.toContain("dynamic");
    expect(body).not.toContain("Overview content.");
  });

  it("returns a real PDF with a PDF filename", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pdf&path=overview.md",
      ),
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="example-project-overview.pdf"',
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(Number(response.headers.get("Content-Length"))).toBe(bytes.byteLength);
  });

  it("returns not found for an unknown page", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=pdf&path=missing.md",
      ),
      context,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: false,
        error: "Page not found",
      }),
    );
  });

  it("rejects unsupported formats", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/tome/projects/example-project/export?format=docx",
      ),
      context,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        success: false,
        error: "Supported export formats: pdf, html, markdown",
      }),
    );
  });
});

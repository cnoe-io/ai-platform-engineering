import { projectMatchesQuery } from "@/lib/tome/project-search";
import type { ProjectDocument } from "@/types/projects";

const project = {
  title: "Example Protocols",
  name: "example-protocols",
  slug: "example-protocols",
  description: "Coordination tools for distributed systems",
  domain: "engineering",
  team_name: "Primary Team",
  data_steward: { type: "user", id: "user-1", name: "Test User", email: "test-user@example.com" },
  tags: ["agents"],
  labels: { initiatives: ["Example Initiative"], areas: ["Runtime"] },
  sources: {
    github_repos: [
      {
        full_name: "example-org/example-repo",
        html_url: "https://github.com/example-org/example-repo",
      },
    ],
  },
} as ProjectDocument;

describe("projectMatchesQuery", () => {
  it.each([
    "example protocols",
    "distributed systems",
    "test-user@example.com",
    "example initiative",
    "runtime",
    "example-org/example-repo",
  ])("matches project metadata for %s", (query) => {
    expect(projectMatchesQuery(project, query)).toBe(true);
  });

  it("requires every search term to match", () => {
    expect(projectMatchesQuery(project, "example runtime")).toBe(true);
    expect(projectMatchesQuery(project, "example finance")).toBe(false);
  });

  it("matches every project for an empty query", () => {
    expect(projectMatchesQuery(project, "   ")).toBe(true);
  });
});

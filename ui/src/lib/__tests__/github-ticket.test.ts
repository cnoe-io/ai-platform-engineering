jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn(),
}));

import {
  buildGitHubIssueBody,
  parseGitHubRepo,
  titleFor,
  type GitHubTicketInput,
} from "@/lib/github-ticket";

describe("github-ticket", () => {
  const baseInput: GitHubTicketInput = {
    description: "The ingest button does nothing when clicked.",
    userEmail: "test@example.com",
    contextUrl: "https://example.test/projects/acme/tome",
    source: "tome-product",
    label: "caipe-reported",
    category: "Bug",
    tomeContext: { projectSlug: "acme", pagePath: "wiki/README.md" },
  };

  it("parseGitHubRepo splits owner/repo", () => {
    expect(parseGitHubRepo("cisco-eti/ai-platform-engineering-mirror")).toEqual({
      owner: "cisco-eti",
      repo: "ai-platform-engineering-mirror",
    });
  });

  it("buildGitHubIssueBody includes TOME product disclaimer and context", () => {
    const body = buildGitHubIssueBody(baseInput);
    expect(body).toContain("TOME product feedback");
    expect(body).toContain("wiki page content accuracy");
    expect(body).toContain("## Category");
    expect(body).toContain("Bug");
    expect(body).toContain("test@example.com");
    expect(body).toContain("acme");
    expect(body).toContain("wiki/README.md");
  });

  it("titleFor prefixes TOME feedback with category", () => {
    expect(titleFor(baseInput)).toMatch(/^\[TOME Feedback\] Bug:/);
  });

  it("includes chat feedback block when provided", () => {
    const body = buildGitHubIssueBody({
      ...baseInput,
      source: "chat-feedback",
      category: undefined,
      feedbackContext: {
        feedbackType: "dislike",
        reason: "Trust",
        additionalFeedback: "Sources look outdated",
      },
    });
    expect(body).toContain("## Chat feedback");
    expect(body).toContain("Trust");
    expect(body).toContain("Sources look outdated");
  });
});

const mockReposGet = jest.fn();
const mockCreateOrUpdateFileContents = jest.fn();

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: {
      get: (...args: unknown[]) => mockReposGet(...args),
      createOrUpdateFileContents: (...args: unknown[]) => mockCreateOrUpdateFileContents(...args),
    },
  })),
}));

import {
  buildGitHubIssueBody,
  parseGitHubRepo,
  titleFor,
  uploadScreenshotToGitHub,
  type GitHubTicketInput,
} from "@/lib/github-ticket";

describe("github-ticket", () => {
  const baseInput: GitHubTicketInput = {
    description: "The ingest button does nothing when clicked.",
    userEmail: "test@example.com",
    contextUrl: "https://example.test/projects/acme/tome",
    source: "tome-product",
    label: "caipe-reported",
    area: "TOME",
    issueType: "Bug",
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
    expect(body).toContain("## Issue Type");
    expect(body).toContain("Bug");
    expect(body).toContain("test@example.com");
    expect(body).toContain("acme");
    expect(body).toContain("wiki/README.md");
  });

  it("titleFor prefixes TOME feedback with issue type, suppressing the redundant TOME area tag", () => {
    expect(titleFor(baseInput)).toMatch(/^\[TOME Feedback\] \[Bug\]:/);
  });

  it("titleFor includes the area tag for non-TOME areas", () => {
    expect(titleFor({ ...baseInput, source: "header", area: "Chat" })).toMatch(
      /^\[CAIPE Report\] \[Chat\] \[Bug\]:/
    );
  });

  it("includes chat feedback block when provided", () => {
    const body = buildGitHubIssueBody({
      ...baseInput,
      source: "chat-feedback",
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

  it("embeds a real image when screenshotUrl is set", () => {
    const body = buildGitHubIssueBody({
      ...baseInput,
      screenshotUrl: "https://raw.githubusercontent.com/org/screenshots/main/screenshots/2026-07-25/abc.png",
    });
    expect(body).toContain("![Screenshot](https://raw.githubusercontent.com/org/screenshots/main/screenshots/2026-07-25/abc.png)");
  });

  it("falls back to a text note when only screenshotDataUrl is set (upload failed or not configured)", () => {
    const body = buildGitHubIssueBody({
      ...baseInput,
      screenshotDataUrl: `data:image/png;base64,${Buffer.from("x").toString("base64")}`,
    });
    expect(body).toContain("could not be uploaded");
    expect(body).not.toContain("![Screenshot]");
  });

  describe("uploadScreenshotToGitHub", () => {
    const pngDataUrl = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`;

    beforeEach(() => {
      mockReposGet.mockReset();
      mockCreateOrUpdateFileContents.mockReset();
    });

    it("commits the decoded screenshot and returns its raw URL", async () => {
      mockReposGet.mockResolvedValue({ data: { default_branch: "main" } });
      mockCreateOrUpdateFileContents.mockResolvedValue({});

      const url = await uploadScreenshotToGitHub("org/screenshots", "token", pngDataUrl);

      expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "org",
          repo: "screenshots",
          branch: "main",
          content: Buffer.from("fake-png-bytes").toString("base64"),
        }),
      );
      expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/org\/screenshots\/main\/screenshots\//);
    });

    it("throws on a non-data URL", async () => {
      await expect(
        uploadScreenshotToGitHub("org/screenshots", "token", "not-a-data-url"),
      ).rejects.toThrow("not a valid base64 data URL");
    });
  });
});

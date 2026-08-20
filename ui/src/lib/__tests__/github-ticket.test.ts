const mockReposGet = jest.fn();
const mockGetBranch = jest.fn();
const mockCheckCollaborator = jest.fn();
const mockSearchUsers = jest.fn();
const mockUsersGetByUsername = jest.fn();
const mockCreateOrUpdateFileContents = jest.fn();
const mockGetRef = jest.fn();
const mockCreateRef = jest.fn();
const mockIssuesCreate = jest.fn();

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    repos: {
      get: (...args: unknown[]) => mockReposGet(...args),
      getBranch: (...args: unknown[]) => mockGetBranch(...args),
      checkCollaborator: (...args: unknown[]) => mockCheckCollaborator(...args),
      createOrUpdateFileContents: (...args: unknown[]) => mockCreateOrUpdateFileContents(...args),
    },
    git: {
      getRef: (...args: unknown[]) => mockGetRef(...args),
      createRef: (...args: unknown[]) => mockCreateRef(...args),
    },
    issues: {
      create: (...args: unknown[]) => mockIssuesCreate(...args),
    },
    search: {
      users: (...args: unknown[]) => mockSearchUsers(...args),
    },
    users: {
      getByUsername: (...args: unknown[]) => mockUsersGetByUsername(...args),
    },
  })),
}));

import {
  buildGitHubIssueBody,
  createGitHubTicket,
  githubLoginCandidateFromEmail,
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

  describe("githubLoginCandidateFromEmail", () => {
    it("uses a GitHub-compatible email local part", () => {
      expect(githubLoginCandidateFromEmail("test-user@example.com")).toBe("test-user");
    });

    it.each([
      "first.last@example.com",
      "first_last@example.com",
      "-test-user@example.com",
      "test--user@example.com",
      "missing-domain@",
      "not-an-email",
    ])("rejects an email that cannot map safely: %s", (email) => {
      expect(githubLoginCandidateFromEmail(email)).toBeUndefined();
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

  it("includes a verified reporter mention in the Reporter block", () => {
    const body = buildGitHubIssueBody(baseInput, "test-user");

    expect(body).toContain("- GitHub: @test-user");
  });

  it("does not render an unsafe reporter mention", () => {
    const body = buildGitHubIssueBody(baseInput, "test-user<script>");

    expect(body).not.toContain("- GitHub:");
  });

  it("titleFor uses the user feedback, area, and type taxonomy for TOME feedback", () => {
    expect(titleFor(baseInput)).toMatch(/^\[User Feedback\]\[TOME\]\[Bug\]:/);
  });

  it("titleFor uses the same taxonomy for header feedback", () => {
    expect(titleFor({ ...baseInput, source: "header", area: "Chat" })).toMatch(
      /^\[User Feedback\]\[Chat\]\[Bug\]:/
    );
  });

  it("titleFor infers Chat and the feedback reason for the chat feedback shortcut", () => {
    expect(titleFor({
      ...baseInput,
      source: "chat-feedback",
      area: undefined,
      issueType: undefined,
      feedbackContext: {
        feedbackType: "dislike",
        reason: "Inaccurate",
      },
    })).toMatch(/^\[User Feedback\]\[Chat\]\[Inaccurate\]:/);
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

  describe("createGitHubTicket reporter subscription", () => {
    beforeEach(() => {
      mockCheckCollaborator.mockReset();
      mockSearchUsers.mockReset();
      mockUsersGetByUsername.mockReset();
      mockIssuesCreate.mockReset();
      mockSearchUsers.mockResolvedValue({
        data: { total_count: 0, items: [] },
      });
      mockUsersGetByUsername.mockRejectedValue({ status: 404 });
      mockIssuesCreate.mockResolvedValue({
        data: {
          number: 42,
          html_url: "https://github.com/example/repo/issues/42",
        },
      });
    });

    it("mentions a reporter whose derived login is a repository collaborator", async () => {
      mockUsersGetByUsername.mockResolvedValue({
        data: { login: "test-user", email: "test-user@example.com" },
      });
      mockCheckCollaborator.mockResolvedValue({ status: 204 });

      await createGitHubTicket("example/repo", "token", {
        ...baseInput,
        userEmail: "test-user@example.com",
      });

      expect(mockCheckCollaborator).toHaveBeenCalledWith({
        owner: "example",
        repo: "repo",
        username: "test-user",
      });
      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("- GitHub: @test-user"),
        }),
      );
    });

    it("finds a uniquely matching public email when the login differs from the email local part", async () => {
      mockUsersGetByUsername
        .mockRejectedValueOnce({ status: 404 })
        .mockResolvedValueOnce({
          data: { login: "different-login", email: "reporter@example.com" },
        });
      mockSearchUsers.mockResolvedValue({
        data: {
          total_count: 1,
          items: [{ login: "different-login" }],
        },
      });
      mockCheckCollaborator.mockResolvedValue({ status: 204 });

      await createGitHubTicket("example/repo", "token", {
        ...baseInput,
        userEmail: "reporter@example.com",
      });

      expect(mockSearchUsers).toHaveBeenCalledWith({
        q: "reporter@example.com in:email",
        per_page: 10,
      });
      expect(mockCheckCollaborator).toHaveBeenCalledWith({
        owner: "example",
        repo: "repo",
        username: "different-login",
      });
      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining("- GitHub: @different-login"),
        }),
      );
    });

    it("does not mention a login when public-email search is ambiguous", async () => {
      mockSearchUsers.mockResolvedValue({
        data: {
          total_count: 2,
          items: [{ login: "first-user" }, { login: "second-user" }],
        },
      });
      mockUsersGetByUsername
        .mockRejectedValueOnce({ status: 404 })
        .mockResolvedValueOnce({
          data: { login: "first-user", email: "reporter@example.com" },
        })
        .mockResolvedValueOnce({
          data: { login: "second-user", email: "reporter@example.com" },
        });

      await createGitHubTicket("example/repo", "token", {
        ...baseInput,
        userEmail: "reporter@example.com",
      });

      expect(mockCheckCollaborator).not.toHaveBeenCalled();
      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("- GitHub: @"),
        }),
      );
    });

    it("does not mention a reporter who is not a repository collaborator", async () => {
      mockUsersGetByUsername.mockResolvedValue({
        data: { login: "test-user", email: "test-user@example.com" },
      });
      mockCheckCollaborator.mockRejectedValue({ status: 404 });

      await createGitHubTicket("example/repo", "token", {
        ...baseInput,
        userEmail: "test-user@example.com",
      });

      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("@test-user"),
        }),
      );
    });

    it("still creates the issue when collaborator verification fails", async () => {
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      mockUsersGetByUsername.mockResolvedValue({
        data: { login: "test-user", email: "test-user@example.com" },
      });
      mockCheckCollaborator.mockRejectedValue({ status: 403 });

      await expect(
        createGitHubTicket("example/repo", "token", {
          ...baseInput,
          userEmail: "test-user@example.com",
        }),
      ).resolves.toEqual({
        id: "#42",
        number: 42,
        url: "https://github.com/example/repo/issues/42",
        provider: "github",
      });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("Could not verify reporter @test-user"),
        expect.anything(),
      );
      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("@test-user"),
        }),
      );

      warning.mockRestore();
    });

    it("skips collaborator verification when no exact public-email match exists", async () => {
      await createGitHubTicket("example/repo", "token", {
        ...baseInput,
        userEmail: "first.last@example.com",
      });

      expect(mockCheckCollaborator).not.toHaveBeenCalled();
      expect(mockIssuesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.not.stringContaining("@first.last"),
        }),
      );
    });
  });

  describe("uploadScreenshotToGitHub", () => {
    const pngDataUrl = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`;

    beforeEach(() => {
      mockReposGet.mockReset();
      mockGetBranch.mockReset();
      mockCreateOrUpdateFileContents.mockReset();
      mockGetRef.mockReset();
      mockCreateRef.mockReset();
    });

    it("commits to the dedicated 'screenshots' branch (not the default branch) and returns its raw URL", async () => {
      mockGetBranch.mockResolvedValue({ data: { name: "screenshots" } });
      mockCreateOrUpdateFileContents.mockResolvedValue({});

      const url = await uploadScreenshotToGitHub("org/screenshots", "token", pngDataUrl);

      expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "org",
          repo: "screenshots",
          branch: "screenshots",
          content: Buffer.from("fake-png-bytes").toString("base64"),
        }),
      );
      expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/org\/screenshots\/screenshots\//);
    });

    it("bootstraps the 'screenshots' branch from the default branch when it doesn't exist yet", async () => {
      mockGetBranch.mockRejectedValue({ status: 404 });
      mockReposGet.mockResolvedValue({ data: { default_branch: "main" } });
      mockGetRef.mockResolvedValue({ data: { object: { sha: "abc123" } } });
      mockCreateRef.mockResolvedValue({});
      mockCreateOrUpdateFileContents.mockResolvedValue({});

      await uploadScreenshotToGitHub("org/screenshots", "token", pngDataUrl);

      expect(mockGetRef).toHaveBeenCalledWith(expect.objectContaining({ ref: "heads/main" }));
      expect(mockCreateRef).toHaveBeenCalledWith(
        expect.objectContaining({ ref: "refs/heads/screenshots", sha: "abc123" }),
      );
    });

    it("propagates a non-404 error from checking the branch", async () => {
      mockGetBranch.mockRejectedValue({ status: 500 });

      await expect(
        uploadScreenshotToGitHub("org/screenshots", "token", pngDataUrl),
      ).rejects.toEqual({ status: 500 });
      expect(mockCreateRef).not.toHaveBeenCalled();
    });

    it("throws on a non-data URL", async () => {
      await expect(
        uploadScreenshotToGitHub("org/screenshots", "token", "not-a-data-url"),
      ).rejects.toThrow("not a valid base64 data URL");
    });
  });
});

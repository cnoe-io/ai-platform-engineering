/**
 * Defense-in-depth tests for `crawlGitLabRepo` input validation.
 *
 * Background: the GitLab API addresses projects by URL-encoded
 * namespaced path (`group/sub/project`). If a caller forgets to
 * normalize a full URL like `https://gitlab.com/group/sub/project`
 * down to `group/sub/project`, `encodeURIComponent` produces something
 * like `https%3A%2F%2Fgitlab.com%2F...` and GitLab returns 404 for the
 * project lookup. The 404 is then surfaced to the user as a generic
 * "GitLab API error: 404 Not Found" toast which is impossible to
 * debug without reading the wire — exactly the failure mode the
 * `/api/skill-hubs/crawl` preview route hit before this guard was
 * added.
 *
 * These tests pin the contract on the library function so any future
 * caller that bypasses `normalizeHubLocation` fails loud (with an
 * actionable message) instead of silently producing a misleading 404.
 *
 * No fetch mock is needed because the guard fires before we ever
 * touch the network.
 */

jest.mock("@/lib/mongodb", () => ({
  getCollection: jest.fn(),
  isMongoDBConfigured: false,
}));

jest.mock("@/lib/api-middleware", () => ({
  validateCredentialsRef: jest.fn(),
}));

import { crawlGitLabRepo } from "../hub-crawl";

describe("crawlGitLabRepo URL rejection", () => {
  it("rejects a full https URL with an actionable message", async () => {
    await expect(
      crawlGitLabRepo("https://gitlab.com/gitlab-org/ai/skills"),
    ).rejects.toThrow(
      /must be a namespaced path .* not a URL.*normalizeHubLocation/s,
    );
  });

  it("rejects an http URL too", async () => {
    await expect(
      crawlGitLabRepo("http://gitlab.example.com/group/project"),
    ).rejects.toThrow(/must be a namespaced path .* not a URL/s);
  });

  it("rejects a leading-slash absolute path", async () => {
    // Mirrors the URL case — a path that starts with `/` would also
    // double-encode into a project lookup that 404s.
    await expect(crawlGitLabRepo("/group/project")).rejects.toThrow(
      /must be a namespaced path/,
    );
  });

  it("rejects a single-segment path (no slash)", async () => {
    // GitLab projects are always at least `namespace/project`. A
    // bare `repo` token would 404 silently.
    await expect(crawlGitLabRepo("just-a-name")).rejects.toThrow(
      /must include at least one "\/" separator/,
    );
  });

  it("rejects an empty string", async () => {
    await expect(crawlGitLabRepo("")).rejects.toThrow(
      /project path is empty/,
    );
  });

  it("rejects whitespace-only input", async () => {
    await expect(crawlGitLabRepo("   ")).rejects.toThrow(
      /project path is empty/,
    );
  });

  it("accepts a flat namespaced path (network call attempted)", async () => {
    // We can't easily assert on the network call here without a fetch
    // mock, so we just confirm the URL guard does NOT fire — the
    // promise rejects on a *different* error (the unmocked network
    // attempt), not the URL validation. If the guard regressed and
    // started rejecting valid paths, this would fail with the
    // "must be a namespaced path" message instead.
    await expect(crawlGitLabRepo("group/project")).rejects.not.toThrow(
      /must be a namespaced path|must include at least one|project path is empty/,
    );
  });

  it("accepts a deeply-nested subgroup path (network call attempted)", async () => {
    // Same defensive style: the guard should pass an arbitrary depth
    // of subgroup nesting since GitLab supports it.
    await expect(
      crawlGitLabRepo("group/sub/sub-sub/project"),
    ).rejects.not.toThrow(
      /must be a namespaced path|must include at least one|project path is empty/,
    );
  });
});

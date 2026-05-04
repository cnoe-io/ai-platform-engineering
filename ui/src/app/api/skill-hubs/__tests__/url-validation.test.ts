/**
 * @jest-environment node
 *
 * Tests for URL hostname + include_paths validation in skill-hubs routes.
 * Verifies that hostname checks use exact match instead of substring match
 * to prevent SSRF / URL bypass attacks, that GitLab subgroup nesting is
 * preserved end-to-end (FR-022), and that `include_paths` is correctly
 * normalized + validated (FR-020).
 * assisted-by claude code claude-sonnet-4-6
 */

import {
  detectHubProviderFromUrl,
  normalizeHubLocation,
  validateIncludePaths,
} from "../_lib/normalize";

describe("skill-hubs URL hostname validation", () => {

  it("normalizes a real github.com URL to owner/repo", () => {
    const result = normalizeHubLocation("https://github.com/owner/repo");
    expect(result).toBe("owner/repo");
  });

  it("normalizes a github subdomain URL", () => {
    const result = normalizeHubLocation("https://api.github.com/repos/owner/repo");
    expect(result).toBe("repos/owner");
  });

  it("does NOT normalize evil-github.com (substring attack)", () => {
    const raw = "https://evil-github.com/owner/repo";
    const result = normalizeHubLocation(raw);
    // Should not strip the hostname — remains as the raw input
    expect(result).toBe(raw);
  });

  it("does NOT normalize github.com.evil.com (suffix attack)", () => {
    const raw = "https://github.com.evil.com/owner/repo";
    const result = normalizeHubLocation(raw);
    expect(result).toBe(raw);
  });

  it("normalizes a real gitlab.com URL to owner/repo", () => {
    const result = normalizeHubLocation("https://gitlab.com/owner/repo", "gitlab");
    expect(result).toBe("owner/repo");
  });

  it("does NOT normalize evil-gitlab.com", () => {
    const raw = "https://evil-gitlab.com/owner/repo";
    const result = normalizeHubLocation(raw, "gitlab");
    expect(result).toBe(raw);
  });

  it("leaves plain owner/repo string unchanged", () => {
    const result = normalizeHubLocation("owner/repo");
    expect(result).toBe("owner/repo");
  });

  // FR-022 / SC-010: GitLab subgroup nesting must survive normalization.
  it("preserves every path segment for gitlab.com subgroup URLs", () => {
    const result = normalizeHubLocation(
      "https://gitlab.com/mycorp/devops/platform",
      "gitlab",
    );
    expect(result).toBe("mycorp/devops/platform");
  });

  it("preserves arbitrarily-deep GitLab subgroup nesting", () => {
    const result = normalizeHubLocation(
      "https://gitlab.com/group/subgroup/sub-subgroup/project",
      "gitlab",
    );
    expect(result).toBe("group/subgroup/sub-subgroup/project");
  });

  it("strips GitLab UI suffixes (e.g. /-/tree/main) while keeping subgroups", () => {
    const result = normalizeHubLocation(
      "https://gitlab.com/mycorp/devops/platform/-/tree/main",
      "gitlab",
    );
    expect(result).toBe("mycorp/devops/platform");
  });

  // Regression: a user pasted `https://gitlab.com/gitlab-org/ai/skills`
  // into the admin "Preview skills (crawl)" form and got
  // "GitLab API error: 404 Not Found" because the preview route did
  // not run `normalizeHubLocation` before calling `crawlGitLabRepo`,
  // so the full URL got `encodeURIComponent`'d into the GitLab API
  // project lookup. Pin the normalization here so the route can rely
  // on the canonical `gitlab-org/ai/skills` form regardless of how
  // the URL was typed.
  it("normalizes the gitlab-org/ai/skills repro URL to the canonical path", () => {
    const result = normalizeHubLocation(
      "https://gitlab.com/gitlab-org/ai/skills",
      "gitlab",
    );
    expect(result).toBe("gitlab-org/ai/skills");
  });

  it("normalizes a gitlab.com URL with a trailing slash", () => {
    const result = normalizeHubLocation(
      "https://gitlab.com/gitlab-org/ai/skills/",
      "gitlab",
    );
    expect(result).toBe("gitlab-org/ai/skills");
  });

  it("still flattens GitHub URLs to two segments (no subgroup support)", () => {
    const result = normalizeHubLocation(
      "https://github.com/owner/repo/tree/main",
      "github",
    );
    expect(result).toBe("owner/repo");
  });
});

describe("skill-hubs include_paths validation (FR-020)", () => {
  it("returns undefined for absent input", () => {
    expect(validateIncludePaths(undefined)).toBeUndefined();
    expect(validateIncludePaths(null)).toBeUndefined();
  });

  it("returns undefined for an empty array (so existing docs are untouched)", () => {
    expect(validateIncludePaths([])).toBeUndefined();
  });

  it("appends a trailing slash to each entry", () => {
    expect(validateIncludePaths(["skills", "agents/ops/skills/"])).toEqual([
      "skills/",
      "agents/ops/skills/",
    ]);
  });

  it("trims whitespace and drops empties", () => {
    expect(validateIncludePaths(["  skills  ", "", "  ", "agents/"])).toEqual([
      "skills/",
      "agents/",
    ]);
  });

  it("dedupes preserving order", () => {
    expect(
      validateIncludePaths(["skills/", "skills", "agents/", "skills"]),
    ).toEqual(["skills/", "agents/"]);
  });

  it("rejects entries containing '..'", () => {
    expect(() => validateIncludePaths(["../escape"])).toThrow(/\.\./);
  });

  it("rejects entries with leading slash", () => {
    expect(() => validateIncludePaths(["/abs/path"])).toThrow(/must not start with "\/"/);
  });

  it("rejects entries with disallowed characters", () => {
    expect(() => validateIncludePaths(["skills with space/"])).toThrow(
      /disallowed characters/,
    );
    expect(() => validateIncludePaths(["weird*char/"])).toThrow(
      /disallowed characters/,
    );
  });

  it("caps at 20 entries", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `dir${i}/`);
    expect(() => validateIncludePaths(tooMany)).toThrow(/maximum of 20/);
  });

  it("rejects non-array input", () => {
    expect(() => validateIncludePaths("skills/")).toThrow(/must be an array/);
  });

  it("rejects non-string entries", () => {
    expect(() => validateIncludePaths([42 as unknown as string])).toThrow(
      /entries must be strings/,
    );
  });

  it("accepts a typical 2-prefix configuration round-trip", () => {
    expect(
      validateIncludePaths(["skills/", "agents/observability/skills/"]),
    ).toEqual(["skills/", "agents/observability/skills/"]);
  });
});

describe("hub-crawl.ts GitHub URL normalization", () => {
  function normalizeCrawlLoc(rawLoc: string): string {
    let loc = rawLoc;
    try {
      const url = new URL(loc);
      if (url.hostname === "github.com" || url.hostname.endsWith(".github.com")) {
        loc = url.pathname.replace(/^\/+|\/+$/g, "");
      }
    } catch {
      // Not a URL — assume owner/repo
    }
    return loc;
  }

  it("strips github.com prefix from full URL", () => {
    expect(normalizeCrawlLoc("https://github.com/cnoe-io/ai-platform-engineering")).toBe(
      "cnoe-io/ai-platform-engineering"
    );
  });

  it("strips github subdomain prefix", () => {
    expect(normalizeCrawlLoc("https://raw.github.com/cnoe-io/ai-platform-engineering")).toBe(
      "cnoe-io/ai-platform-engineering"
    );
  });

  it("does NOT strip evil-github.com", () => {
    const raw = "https://evil-github.com/cnoe-io/ai-platform-engineering";
    expect(normalizeCrawlLoc(raw)).toBe(raw);
  });

  it("does NOT strip github.com.attacker.com", () => {
    const raw = "https://github.com.attacker.com/cnoe-io/ai-platform-engineering";
    expect(normalizeCrawlLoc(raw)).toBe(raw);
  });

  it("passes through plain owner/repo string", () => {
    expect(normalizeCrawlLoc("cnoe-io/ai-platform-engineering")).toBe(
      "cnoe-io/ai-platform-engineering"
    );
  });
});

// ---------------------------------------------------------------------------
// `detectHubProviderFromUrl` — provider classifier used by the admin form
// auto-switch and by the route handler backstop. The screenshot
// regression that motivated this helper: pasting
// `https://gitlab.com/gitlab-org/ai/skills` into the form while the
// GitHub source pill was selected silently produced a GitHub API call
// against `gitlab-org/ai`, which 404s. These tests pin the host
// allow-list rules — including the security property that we never
// substring-match `github` / `gitlab` inside arbitrary hostnames.
// ---------------------------------------------------------------------------

describe("detectHubProviderFromUrl", () => {
  it("classifies github.com URLs as github", () => {
    expect(detectHubProviderFromUrl("https://github.com/owner/repo")).toBe("github");
    expect(detectHubProviderFromUrl("http://github.com/owner/repo")).toBe("github");
    expect(detectHubProviderFromUrl("https://www.github.com/owner/repo")).toBe("github");
    expect(detectHubProviderFromUrl("https://api.github.com/repos/x")).toBe("github");
  });

  it("classifies gitlab.com URLs as gitlab", () => {
    expect(detectHubProviderFromUrl("https://gitlab.com/group/project")).toBe("gitlab");
    expect(detectHubProviderFromUrl("https://gitlab.com/group/sub/project")).toBe("gitlab");
  });

  it("classifies the screenshot URL as gitlab", () => {
    // Regression pin for the exact URL the admin pasted into the form
    // while GitHub was selected.
    expect(
      detectHubProviderFromUrl("https://gitlab.com/gitlab-org/ai/skills"),
    ).toBe("gitlab");
  });

  it("returns null for plain owner/repo (no URL)", () => {
    expect(detectHubProviderFromUrl("owner/repo")).toBeNull();
    expect(detectHubProviderFromUrl("group/sub/project")).toBeNull();
  });

  it("returns null for empty / whitespace input", () => {
    expect(detectHubProviderFromUrl("")).toBeNull();
    expect(detectHubProviderFromUrl("   ")).toBeNull();
  });

  it("rejects evil-github.com (substring attack)", () => {
    expect(detectHubProviderFromUrl("https://evil-github.com/owner/repo")).toBeNull();
  });

  it("rejects github.com.attacker.com (suffix attack)", () => {
    expect(
      detectHubProviderFromUrl("https://github.com.attacker.com/owner/repo"),
    ).toBeNull();
  });

  it("rejects evil-gitlab.com (substring attack)", () => {
    expect(detectHubProviderFromUrl("https://evil-gitlab.com/group/project")).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    // Defense-in-depth: SSH-style URLs and file://, etc., never match.
    expect(detectHubProviderFromUrl("ssh://github.com/owner/repo")).toBeNull();
    expect(detectHubProviderFromUrl("file:///etc/passwd")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    // URLs that look like URLs but URL constructor rejects.
    expect(detectHubProviderFromUrl("https://[not-a-valid-host")).toBeNull();
  });

  it("recognizes self-hosted GitLab via GITLAB_API_URL", () => {
    const prev = process.env.GITLAB_API_URL;
    try {
      process.env.GITLAB_API_URL = "https://gitlab.mycorp.com/api/v4";
      expect(
        detectHubProviderFromUrl("https://gitlab.mycorp.com/group/project"),
      ).toBe("gitlab");
      // Subdomains of the configured host also match.
      expect(
        detectHubProviderFromUrl("https://review.gitlab.mycorp.com/group/project"),
      ).toBe("gitlab");
    } finally {
      if (prev === undefined) delete process.env.GITLAB_API_URL;
      else process.env.GITLAB_API_URL = prev;
    }
  });
});

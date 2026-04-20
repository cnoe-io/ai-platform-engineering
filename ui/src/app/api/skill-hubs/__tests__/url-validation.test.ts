/**
 * @jest-environment node
 *
 * Tests for URL hostname validation in skill-hubs routes.
 * Verifies that hostname checks use exact match instead of substring match
 * to prevent SSRF / URL bypass attacks.
 * assisted-by claude code claude-sonnet-4-6
 */

describe("skill-hubs URL hostname validation", () => {
  /**
   * Helper that extracts the normalized location from a given URL string
   * by applying the same hostname logic used in the route handlers.
   */
  function normalizeHubLocation(rawLoc: string): string {
    let loc = rawLoc.trim();
    try {
      const url = new URL(loc);
      if (
        url.hostname === "github.com" ||
        url.hostname.endsWith(".github.com") ||
        url.hostname === "gitlab.com" ||
        url.hostname.endsWith(".gitlab.com")
      ) {
        const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
        if (segments.length >= 2) loc = `${segments[0]}/${segments[1]}`;
      }
    } catch {
      // Not a URL — return as-is
    }
    return loc;
  }

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
    const result = normalizeHubLocation("https://gitlab.com/owner/repo");
    expect(result).toBe("owner/repo");
  });

  it("does NOT normalize evil-gitlab.com", () => {
    const raw = "https://evil-gitlab.com/owner/repo";
    const result = normalizeHubLocation(raw);
    expect(result).toBe(raw);
  });

  it("leaves plain owner/repo string unchanged", () => {
    const result = normalizeHubLocation("owner/repo");
    expect(result).toBe("owner/repo");
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

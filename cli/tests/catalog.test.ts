/**
 * Unit tests for skills catalog (T028).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-cat-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = testDir;
});

afterEach(() => {
  process.env.XDG_CONFIG_HOME = "";
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

const MOCK_CATALOG = {
  version: "1",
  generated: "2026-04-12T00:00:00Z",
  skills: [
    {
      name: "dco-ai-attribution",
      version: "1.0.0",
      description: "DCO commit helper",
      author: "cnoe-io",
      tags: ["git", "dco"],
      url: "https://github.com/cnoe-io/skills/releases/latest/download/dco-ai-attribution.md",
      checksum: "sha256:abc123",
    },
  ],
};

// ── fetchCatalog ─────────────────────────────────────────────────────────────

describe("fetchCatalog", () => {
  it("fetches from network and caches result", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(MOCK_CATALOG), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    try {
      const { fetchCatalog } = await import("../src/skills/catalog");
      const catalog = await fetchCatalog();
      expect(catalog.skills).toHaveLength(1);
      expect(catalog.skills[0]?.name).toBe("dco-ai-attribution");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("returns stale cache when network fails", async () => {
    // Prime the cache
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    const cacheObj = {
      catalog: MOCK_CATALOG,
      cachedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    }; // 2h old
    writeFileSync(join(configDir, "catalog-cache.json"), JSON.stringify(cacheObj));

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.reject(new Error("Network error")),
    ) as unknown as unknown as typeof fetch;

    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    try {
      const { fetchCatalog } = await import("../src/skills/catalog");
      const catalog = await fetchCatalog();
      expect(catalog.skills[0]?.name).toBe("dco-ai-attribution");
      expect(stderrChunks.join("")).toContain("cached");
    } finally {
      global.fetch = originalFetch;
      process.stderr.write = origWrite;
    }
  });

  it("uses 1-hour TTL cache without network call", async () => {
    // Prime fresh cache
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    const cacheObj = { catalog: MOCK_CATALOG, cachedAt: new Date().toISOString() };
    writeFileSync(join(configDir, "catalog-cache.json"), JSON.stringify(cacheObj));

    let fetchCalled = false;
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => {
      fetchCalled = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;

    try {
      const { fetchCatalog } = await import("../src/skills/catalog");
      await fetchCatalog();
      expect(fetchCalled).toBe(false); // should use cache
    } finally {
      global.fetch = originalFetch;
    }
  });
});

// ── verifyChecksum ────────────────────────────────────────────────────────────

describe("verifyChecksum", () => {
  it("passes for matching checksum", async () => {
    const content = "# Test skill content";
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const { verifyChecksum } = await import("../src/skills/catalog");
    expect(() => verifyChecksum(content, `sha256:${hash}`)).not.toThrow();
  });

  it("throws for mismatched checksum", async () => {
    const { verifyChecksum } = await import("../src/skills/catalog");
    expect(() => verifyChecksum("wrong content", "sha256:abc123")).toThrow(/Checksum mismatch/);
  });

  it("throws for unknown checksum format", async () => {
    const { verifyChecksum } = await import("../src/skills/catalog");
    expect(() => verifyChecksum("content", "md5:abc")).toThrow(/Unknown checksum format/);
  });
});

/**
 * Unit tests for memory loading and context assembly.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-ctx-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = testDir;
});

afterEach(() => {
  process.env.XDG_CONFIG_HOME = "";
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ── Memory file loading ───────────────────────────────────────────────────────

describe("loadMemoryFiles", () => {
  it("returns empty array when no memory files exist", async () => {
    const { loadMemoryFiles } = await import("../src/memory/loader");
    const files = loadMemoryFiles(testDir);
    expect(files).toHaveLength(0);
  });

  it("loads global CLAUDE.md when it exists", async () => {
    // Create caipe config dir with global CLAUDE.md
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "CLAUDE.md"), "# Global memory\nHello world.");

    const { loadMemoryFiles } = await import("../src/memory/loader");
    const files = loadMemoryFiles(testDir);
    const global_ = files.find((f) => f.scope === "global");
    expect(global_).toBeDefined();
    expect(global_?.content).toContain("Hello world.");
  });

  it("loads project CLAUDE.md when .claude/ exists with .git", async () => {
    // Create a fake git repo structure
    const projectDir = join(testDir, "project");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude", "memory"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "CLAUDE.md"), "# Project memory\nBye world.");

    const { loadMemoryFiles } = await import("../src/memory/loader");
    const files = loadMemoryFiles(projectDir);
    const project = files.find((f) => f.scope === "project");
    expect(project).toBeDefined();
    expect(project?.content).toContain("Bye world.");
  });

  it("loads managed memory files in alphabetical order", async () => {
    const projectDir = join(testDir, "project2");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude", "memory"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "memory", "b_file.md"), "BBB");
    writeFileSync(join(projectDir, ".claude", "memory", "a_file.md"), "AAA");

    const { loadMemoryFiles } = await import("../src/memory/loader");
    const files = loadMemoryFiles(projectDir);
    const managed = files.filter((f) => f.scope === "managed");
    expect(managed).toHaveLength(2);
    expect(managed[0]?.content).toBe("AAA");
    expect(managed[1]?.content).toBe("BBB");
  });

  it("emits warning to stderr and truncates at 50k token budget", async () => {
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    // 50k tokens × 4 chars/token = 200k chars; write 201k chars
    const bigContent = "x".repeat(201_000);
    writeFileSync(join(configDir, "CLAUDE.md"), bigContent);

    const stderrChunks: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => {
      stderrChunks.push(String(chunk));
      return true;
    };

    const { loadMemoryFiles } = await import("../src/memory/loader");
    const files = loadMemoryFiles(testDir);

    process.stderr.write = originalWrite;

    const global_ = files.find((f) => f.scope === "global");
    expect(global_).toBeDefined();
    expect(global_?.content.length).toBeLessThanOrEqual(200_020); // budget + small overhead
    expect(stderrChunks.join("")).toContain("truncated");
  });
});

// ── buildMemoryContext ────────────────────────────────────────────────────────

describe("buildMemoryContext", () => {
  it("returns empty string for empty array", async () => {
    const { buildMemoryContext } = await import("../src/memory/loader");
    expect(buildMemoryContext([])).toBe("");
  });

  it("joins files with scope comment headers", async () => {
    const { buildMemoryContext } = await import("../src/memory/loader");
    const ctx = buildMemoryContext([
      { path: "/a/CLAUDE.md", scope: "global", content: "AAA", tokenEstimate: 1 },
      { path: "/b/CLAUDE.md", scope: "project", content: "BBB", tokenEstimate: 1 },
    ]);
    expect(ctx).toContain("<!-- memory:global:");
    expect(ctx).toContain("AAA");
    expect(ctx).toContain("<!-- memory:project:");
    expect(ctx).toContain("BBB");
  });
});

// ── buildSystemContext ────────────────────────────────────────────────────────

describe("buildSystemContext", () => {
  it("returns only memory context when noContext=true", async () => {
    const configDir = join(testDir, "caipe");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "CLAUDE.md"), "Memory content.");

    const { buildSystemContext } = await import("../src/chat/context");
    const ctx = await buildSystemContext(testDir, true);
    expect(ctx).toContain("Memory content.");
    expect(ctx).not.toContain("<repository>");
  });

  it("includes repository section for a git repo", async () => {
    // Clear module cache so that the freshly mocked git module is picked up
    // by context.ts when it is re-imported below.
    vi.resetModules();
    vi.doMock("../src/platform/git", () => ({
      findRepoRoot: async () => "/fake/root",
      sampleFileTree: async () => "src/index.ts\npackage.json",
      recentLog: async () => "abc1234 Initial commit",
    }));

    const { buildSystemContext } = await import("../src/chat/context");
    const ctx = await buildSystemContext(testDir, false);
    vi.doUnmock("../src/platform/git");
    expect(ctx).toContain("<repository>");
    expect(ctx).toContain("src/index.ts");
    expect(ctx).toContain("Initial commit");
  });
});

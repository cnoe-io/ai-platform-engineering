/**
 * Unit tests for skill install, scan, and update (T029, T032).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-skills-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  process.env.XDG_CONFIG_HOME = testDir;
});

afterEach(() => {
  process.env.XDG_CONFIG_HOME = "";
  // Reset cwd to a stable directory before deleting testDir to avoid
  // process.cwd() throwing ENOENT in subsequent tests.
  try {
    process.chdir(tmpdir());
  } catch {
    /* ignore */
  }
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

// ── parseFrontmatter (via scan.ts) ────────────────────────────────────────────

describe("scanInstalledSkills", () => {
  it("returns empty array when no skills directory exists", async () => {
    const { scanInstalledSkills } = await import("../src/skills/scan");
    const skills = scanInstalledSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it("parses skills from .claude/ directory", async () => {
    // Create fake git repo with .claude/
    const projectDir = join(testDir, "project");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "my-skill.md"),
      "---\nname: my-skill\nversion: 1.0.0\ndescription: A test skill\n---\n# Skill Body\n",
    );

    const { scanInstalledSkills } = await import("../src/skills/scan");
    const skills = scanInstalledSkills(projectDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("my-skill");
    expect(skills[0]?.version).toBe("1.0.0");
    expect(skills[0]?.scope).toBe("project");
  });

  it("ignores .md files without valid frontmatter", async () => {
    const projectDir = join(testDir, "project2");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(join(projectDir, ".claude", "no-fm.md"), "# No frontmatter");

    const { scanInstalledSkills } = await import("../src/skills/scan");
    const skills = scanInstalledSkills(projectDir);
    expect(skills).toHaveLength(0);
  });

  it("global skills are returned when no project .claude/ exists", async () => {
    // Global skills dir
    const configDir = join(testDir, "caipe");
    mkdirSync(join(configDir, "skills"), { recursive: true });
    writeFileSync(
      join(configDir, "skills", "global-skill.md"),
      "---\nname: global-skill\nversion: 2.0.0\ndescription: Global\n---\n",
    );

    const { scanInstalledSkills } = await import("../src/skills/scan");
    const skills = scanInstalledSkills(testDir); // testDir has no .git
    expect(skills.some((s) => s.name === "global-skill")).toBe(true);
  });
});

// ── installSkill ─────────────────────────────────────────────────────────────

describe("installSkill", () => {
  it("installs a skill from catalog to .claude/ directory", async () => {
    const projectDir = join(testDir, "myproject");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });

    const content = "---\nname: test-skill\nversion: 1.0.0\ndescription: Test\n---\n# Test\n";
    const hash = createHash("sha256").update(content, "utf8").digest("hex");

    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = ((url: string) => {
      fetchCalled = true;
      if (String(url).includes("catalog.json")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1",
              generated: new Date().toISOString(),
              skills: [
                {
                  name: "test-skill",
                  version: "1.0.0",
                  description: "Test",
                  author: "cnoe",
                  tags: [],
                  url: "https://example.com/test-skill.md",
                  checksum: `sha256:${hash}`,
                },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      if (String(url).includes("test-skill.md")) {
        return Promise.resolve(new Response(content, { status: 200 }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }) as unknown as typeof fetch;

    process.chdir(projectDir);
    try {
      const { installSkill } = await import("../src/skills/install");
      await installSkill("test-skill", {});

      const destPath = join(projectDir, ".claude", "test-skill.md");
      expect(existsSync(destPath)).toBe(true);
      expect(readFileSync(destPath, "utf8")).toBe(content);
      expect(fetchCalled).toBe(true);
    } finally {
      global.fetch = originalFetch;
      process.chdir(testDir);
    }
  });

  it("exits 3 when skill already installed without --force", async () => {
    const projectDir = join(testDir, "myproject2");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "existing-skill.md"),
      "---\nname: existing-skill\nversion: 1.0.0\ndescription: existing\n---\n",
    );

    const content = "---\nname: existing-skill\nversion: 1.1.0\ndescription: existing\n---\n";
    const hash = createHash("sha256").update(content, "utf8").digest("hex");

    const originalFetch = global.fetch;
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: "1",
            generated: new Date().toISOString(),
            skills: [
              {
                name: "existing-skill",
                version: "1.1.0",
                description: "existing",
                author: "cnoe",
                tags: [],
                url: "https://example.com/existing-skill.md",
                checksum: `sha256:${hash}`,
              },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof process.exit;

    process.chdir(projectDir);
    try {
      const { installSkill } = await import("../src/skills/install");
      await installSkill("existing-skill", {});
    } catch {
      /* expected */
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
      process.chdir(testDir);
    }

    expect(exitCode).toBe(3);
  });

  it("exits 1 when skill not found in catalog", async () => {
    const originalFetch = global.fetch;
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ version: "1", generated: new Date().toISOString(), skills: [] }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    const originalExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      throw new Error("EXIT");
    }) as typeof process.exit;

    try {
      const { installSkill } = await import("../src/skills/install");
      await installSkill("nonexistent-skill", {});
    } catch {
      /* expected */
    } finally {
      global.fetch = originalFetch;
      process.exit = originalExit;
    }

    expect(exitCode).toBe(1);
  });
});

// ── skills update (T032) ──────────────────────────────────────────────────────

describe("runSkillsUpdateCore", () => {
  it("reports up-to-date skills correctly", async () => {
    const projectDir = join(testDir, "updatetest");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "my-skill.md"),
      "---\nname: my-skill\nversion: 1.1.0\ndescription: test\n---\n",
    );

    const originalFetch = global.fetch;
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: "1",
            generated: new Date().toISOString(),
            skills: [
              {
                name: "my-skill",
                version: "1.1.0",
                description: "test",
                author: "cnoe",
                tags: [],
                url: "https://x.com",
                checksum: "sha256:x",
              },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    process.chdir(projectDir);
    try {
      const { runSkillsUpdateCore } = await import("../src/skills/update");
      const report = await runSkillsUpdateCore(undefined, { all: true, dryRun: true });
      expect(report.upToDate).toContain("my-skill");
    } finally {
      global.fetch = originalFetch;
      process.chdir(testDir);
    }
  });

  it("dry-run reports available update without modifying files", async () => {
    const projectDir = join(testDir, "updatetest2");
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".claude"), { recursive: true });
    writeFileSync(
      join(projectDir, ".claude", "my-skill.md"),
      "---\nname: my-skill\nversion: 1.0.0\ndescription: test\n---\n",
    );

    const originalFetch = global.fetch;
    global.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: "1",
            generated: new Date().toISOString(),
            skills: [
              {
                name: "my-skill",
                version: "1.1.0",
                description: "test",
                author: "cnoe",
                tags: [],
                url: "https://x.com",
                checksum: "sha256:x",
              },
            ],
          }),
          { status: 200 },
        ),
      )) as unknown as typeof fetch;

    process.chdir(projectDir);
    try {
      const { runSkillsUpdateCore } = await import("../src/skills/update");
      const report = await runSkillsUpdateCore(undefined, { all: true, dryRun: true });
      expect(report.updated).toContain("my-skill");
      // File should not be modified
      const content = readFileSync(join(projectDir, ".claude", "my-skill.md"), "utf8");
      expect(content).toContain("1.0.0");
    } finally {
      global.fetch = originalFetch;
      process.chdir(testDir);
    }
  });
});

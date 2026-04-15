/**
 * Unit tests for DCO commit assistance (T040).
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `caipe-commit-${process.pid}-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

import { buildCommitMessage, installHook } from "../src/commit/dco";

// ── buildCommitMessage ────────────────────────────────────────────────────────

describe("buildCommitMessage", () => {
  it("appends Assisted-by trailer to a simple message", () => {
    const result = buildCommitMessage("fix: correct typo in README");
    expect(result).toContain("fix: correct typo in README");
    expect(result).toMatch(/Assisted-by: Claude:[\w.-]+/);
  });

  it("uses the exact format Assisted-by: Claude:<model>", () => {
    const result = buildCommitMessage("feat: add new feature", "claude-sonnet-4-6");
    expect(result).toContain("Assisted-by: Claude:claude-sonnet-4-6");
  });

  it("does not duplicate the trailer if already present", () => {
    const msg = "feat: something\n\nAssisted-by: Claude:claude-sonnet-4-6\n";
    const result = buildCommitMessage(msg, "claude-sonnet-4-6");
    const count = (result.match(/Assisted-by:/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("adds blank line before trailer when body has no trailing blank line", () => {
    const result = buildCommitMessage("feat: something", "claude-sonnet-4-6");
    expect(result).toContain("\n\nAssisted-by:");
  });

  it("trailer ends with newline", () => {
    const result = buildCommitMessage("fix: bug", "claude-sonnet-4-6");
    expect(result.endsWith("\n")).toBe(true);
  });
});

// ── installHook ───────────────────────────────────────────────────────────────

describe("installHook", () => {
  it("creates prepare-commit-msg hook file", () => {
    // Create fake .git/hooks dir
    const hooksDir = join(testDir, ".git", "hooks");
    mkdirSync(hooksDir, { recursive: true });

    installHook(testDir);

    const hookPath = join(hooksDir, "prepare-commit-msg");
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, "utf8");
    expect(content).toContain("Assisted-by: Claude:");
    expect(content).toContain("#!/bin/sh");
  });

  it("hook file has correct shebang", () => {
    mkdirSync(join(testDir, ".git", "hooks"), { recursive: true });
    installHook(testDir);
    const content = readFileSync(join(testDir, ".git", "hooks", "prepare-commit-msg"), "utf8");
    expect(content.startsWith("#!/bin/sh")).toBe(true);
  });
});

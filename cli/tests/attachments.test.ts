import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandPromptAttachments } from "../src/chat/attachments.js";
import { compactHistoryViaAgent } from "../src/chat/compact.js";

describe("expandPromptAttachments", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(tmpdir(), `caipe-attach-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("inlines @file content", () => {
    writeFileSync(join(dir, "note.txt"), "hello file", "utf8");
    const out = expandPromptAttachments(dir, "see @note.txt please");
    expect(out).toContain("<file path=\"note.txt\">");
    expect(out).toContain("hello file");
  });

  it("expands @glob patterns", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export {}", "utf8");
    const out = expandPromptAttachments(dir, "files @glob:src/*.ts");
    expect(out).toContain("a.ts");
  });
});

describe("compactHistoryViaAgent", () => {
  it("returns short history unchanged", async () => {
    const h = [{ role: "user" as const, content: "hi" }];
    const out = await compactHistoryViaAgent(h, async () => "summary");
    expect(out).toEqual(h);
  });

  it("replaces long history with summary", async () => {
    const h = [
      { role: "user" as const, content: "one" },
      { role: "assistant" as const, content: "two" },
      { role: "user" as const, content: "three" },
    ];
    const out = await compactHistoryViaAgent(h, async () => "- did things");
    expect(out).toHaveLength(1);
    expect(out[0]?.content).toContain("did things");
  });
});

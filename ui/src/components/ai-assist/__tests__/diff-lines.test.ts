import { diffLines } from "../diff-lines";

describe("diffLines", () => {
  it("returns equal lines when inputs match", () => {
    const out = diffLines("a\nb\nc", "a\nb\nc");
    expect(out.every((d) => d.op === "equal")).toBe(true);
    expect(out.map((d) => d.text)).toEqual(["a", "b", "c"]);
  });

  it("marks added lines", () => {
    const out = diffLines("a\nb", "a\nb\nc");
    expect(out).toEqual([
      { op: "equal", oldIndex: 0, newIndex: 0, text: "a" },
      { op: "equal", oldIndex: 1, newIndex: 1, text: "b" },
      { op: "add", oldIndex: -1, newIndex: 2, text: "c" },
    ]);
  });

  it("marks removed lines", () => {
    const out = diffLines("a\nb\nc", "a\nc");
    expect(out.map((d) => `${d.op}:${d.text}`)).toEqual([
      "equal:a",
      "remove:b",
      "equal:c",
    ]);
  });

  it("handles empty old text", () => {
    const out = diffLines("", "hello\nworld");
    expect(out.map((d) => d.op)).toEqual(["add", "add"]);
  });

  it("handles empty new text", () => {
    const out = diffLines("hello\nworld", "");
    expect(out.map((d) => d.op)).toEqual(["remove", "remove"]);
  });

  it("ignores trailing newline differences", () => {
    const out = diffLines("a\nb\n", "a\nb");
    expect(out.every((d) => d.op === "equal")).toBe(true);
  });
});

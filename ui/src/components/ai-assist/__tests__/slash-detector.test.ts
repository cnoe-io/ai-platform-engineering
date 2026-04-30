import { detectSlashCommand } from "../slash-detector";

describe("detectSlashCommand", () => {
  it("returns null for normal text", () => {
    expect(detectSlashCommand("hello world")).toBeNull();
  });

  it("matches `/ai <instruction>`", () => {
    expect(detectSlashCommand("/ai improve this description")).toEqual({
      instruction: "improve this description",
      taskHint: undefined,
    });
  });

  it("ignores leading whitespace", () => {
    expect(detectSlashCommand("   /ai shorten")?.instruction).toBe("shorten");
  });

  it("captures an explicit task hint", () => {
    expect(detectSlashCommand("/ai:code add a JSDoc")).toEqual({
      instruction: "add a JSDoc",
      taskHint: "code",
    });
  });

  it("requires whitespace after `/ai` to avoid matching e.g. /aircraft", () => {
    expect(detectSlashCommand("/aircraft jokes")).toBeNull();
  });

  it("trims trailing whitespace from the instruction", () => {
    expect(detectSlashCommand("/ai  rewrite   ")?.instruction).toBe("rewrite");
  });
});

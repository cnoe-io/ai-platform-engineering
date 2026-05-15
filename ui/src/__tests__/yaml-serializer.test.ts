/**
 * Tests for yaml-serializer.ts — YAML string escaping safety.
 * assisted-by claude code claude-sonnet-4-6
 */

import { toYaml } from "@/lib/yaml-serializer";

describe("toYaml — string escaping", () => {
  it("produces plain value for simple strings", () => {
    const result = toYaml({ name: "hello" });
    expect(result).toBe("name: hello\n");
  });

  it("quotes strings containing colons", () => {
    const result = toYaml({ key: "value: with colon" });
    expect(result).toContain('"value: with colon"');
  });

  it("quotes strings containing double quotes", () => {
    const result = toYaml({ key: 'say "hello"' });
    // JSON.stringify escapes the inner quotes
    expect(result).toContain('\\"hello\\"');
  });

  it("leaves unquoted strings with backslash as-is (valid YAML)", () => {
    const result = toYaml({ key: "path\\to\\file" });
    // Backslash doesn't need quoting in YAML unquoted scalars
    expect(result).toBe("key: path\\to\\file\n");
  });

  it("quotes empty strings", () => {
    const result = toYaml({ key: "" });
    expect(result).toContain('""');
  });

  it("uses literal block scalar for multi-line strings", () => {
    const result = toYaml({ prompt: "line1\nline2" });
    expect(result).toContain("prompt: |");
    expect(result).toContain("  line1");
    expect(result).toContain("  line2");
  });

  it("handles booleans without quotes", () => {
    expect(toYaml({ enabled: true })).toBe("enabled: true\n");
    expect(toYaml({ enabled: false })).toBe("enabled: false\n");
  });

  it("handles numbers without quotes", () => {
    expect(toYaml({ count: 42 })).toBe("count: 42\n");
  });

  it("skips null and undefined values", () => {
    const result = toYaml({ name: "test", desc: null, extra: undefined });
    expect(result).not.toContain("null");
    expect(result).not.toContain("undefined");
    expect(result).toContain("name: test");
  });

  it("handles nested objects with indentation", () => {
    const result = toYaml({ ui: { theme: "dark" } });
    expect(result).toContain("ui:");
    expect(result).toContain("  theme: dark");
  });

  it("handles string injection attempt via YAML special chars", () => {
    // An injection attempt embedding YAML control chars
    const malicious = ": injected\nkey: value";
    const result = toYaml({ field: malicious });
    // Should be in a literal block scalar (contains \n), not raw injection
    expect(result).toContain("field: |");
    expect(result).not.toMatch(/^key:\s/m);
  });

  it("handles hashtag in string value safely", () => {
    const result = toYaml({ tag: "#important" });
    expect(result).toContain('"#important"');
  });
});

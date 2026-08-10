/**
 * @jest-environment node
 */
// assisted-by cursor (composer-2-fast)
//
// Pins the rename suggestion + slug helpers used by both the import
// modal and the (forthcoming) zip import API route. Both surfaces
// must agree on the suggestion strategy or the UI would propose
// "(imported)" while the server saved "(imported 2)" and vice versa.

import {
  slugifySkillName,
  generateSkillIdFromName,
  suggestRenamedSkillName,
} from "@/lib/skill-import-helpers";

describe("slugifySkillName", () => {
  it("lowercases, hyphenates non-alnum, collapses runs, trims", () => {
    expect(slugifySkillName("Foo Bar")).toBe("foo-bar");
    expect(slugifySkillName("Foo  Bar  Baz")).toBe("foo-bar-baz");
    expect(slugifySkillName("--Foo--")).toBe("foo");
    expect(slugifySkillName("FOO_BAR.123")).toBe("foo-bar-123");
  });

  it("returns empty string for pathological inputs (caller adds fallback)", () => {
    expect(slugifySkillName("")).toBe("");
    expect(slugifySkillName("   ")).toBe("");
    expect(slugifySkillName("---")).toBe("");
    expect(slugifySkillName("😀")).toBe("");
  });
});

describe("generateSkillIdFromName", () => {
  it("produces an id of shape skill-<slug>-<random>", () => {
    const id = generateSkillIdFromName("My Cool Skill");
    expect(id).toMatch(/^skill-my-cool-skill-[a-z0-9]{1,9}$/);
  });

  it("falls back to literal `skill` when the name slugifies to empty", () => {
    const id = generateSkillIdFromName("😀");
    expect(id).toMatch(/^skill-skill-[a-z0-9]{1,9}$/);
  });

  it("two calls in a row return different random suffixes", () => {
    const a = generateSkillIdFromName("Foo");
    const b = generateSkillIdFromName("Foo");
    // With 9 base36 chars (~46 bits) the collision rate is
    // negligible. If this test ever flakes we have bigger problems.
    expect(a).not.toEqual(b);
  });
});

describe("suggestRenamedSkillName", () => {
  it("returns the original when nothing collides", () => {
    expect(suggestRenamedSkillName("Foo", new Set())).toBe("Foo");
    expect(suggestRenamedSkillName("Foo", new Set(["Bar"]))).toBe("Foo");
  });

  it('appends "(imported)" on the first collision', () => {
    expect(suggestRenamedSkillName("Foo", new Set(["Foo"]))).toBe(
      "Foo (imported)",
    );
  });

  it('appends "(imported N)" when "(imported)" itself is taken', () => {
    expect(
      suggestRenamedSkillName(
        "Foo",
        new Set(["Foo", "Foo (imported)"]),
      ),
    ).toBe("Foo (imported 2)");
    expect(
      suggestRenamedSkillName(
        "Foo",
        new Set(["Foo", "Foo (imported)", "Foo (imported 2)"]),
      ),
    ).toBe("Foo (imported 3)");
  });

  it("compares case-insensitively and ignores trailing whitespace", () => {
    expect(
      suggestRenamedSkillName("Foo", new Set(["foo "])),
    ).toBe("Foo (imported)");
    expect(
      suggestRenamedSkillName("FOO", new Set(["foo", "Foo (Imported)"])),
    ).toBe("FOO (imported 2)");
  });

  it("falls back to a random suffix after the linear probe limit", () => {
    // Pre-populate the first 99 imported variants so the probe
    // exhausts. We build the exact set the function generates.
    const taken = new Set<string>();
    taken.add("Foo");
    taken.add("Foo (imported)");
    for (let i = 2; i < 100; i++) taken.add(`Foo (imported ${i})`);
    const out = suggestRenamedSkillName("Foo", taken);
    // Should land on "Foo (imported <random>)" with a base36
    // suffix instead of looping forever.
    expect(out).toMatch(/^Foo \(imported [a-z0-9]+\)$/);
  });

  it("treats empty/whitespace inputs as the literal `Imported skill`", () => {
    expect(suggestRenamedSkillName("", new Set())).toBe("Imported skill");
    expect(suggestRenamedSkillName("   ", new Set())).toBe("Imported skill");
    expect(
      suggestRenamedSkillName("", new Set(["Imported skill"])),
    ).toBe("Imported skill (imported)");
  });

  it("accepts an iterable, not just a Set", () => {
    // Real-world callers pass a generator/array so the signature
    // accepts `Iterable<string>` — pin it.
    const arr = ["Foo", "Bar"];
    expect(suggestRenamedSkillName("Foo", arr)).toBe("Foo (imported)");
  });
});

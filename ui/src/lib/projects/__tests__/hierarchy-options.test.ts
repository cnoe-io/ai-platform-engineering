import { toHierarchyOptions } from "../hierarchy-options";

describe("toHierarchyOptions", () => {
  it("uses titles for current BHAG and Area records while preserving slug identity", () => {
    expect(
      toHierarchyOptions([
        { slug: "example-goal", title: "Example Goal" },
        { slug: "example-area", title: "Example Area" },
      ]),
    ).toEqual([
      { name: "Example Goal", slug: "example-goal" },
      { name: "Example Area", slug: "example-area" },
    ]);
  });

  it("falls back to a legacy name and then the slug", () => {
    expect(
      toHierarchyOptions([
        { slug: "legacy-goal", name: "Legacy Goal" },
        { slug: "slug-only-area" },
      ]),
    ).toEqual([
      { name: "Legacy Goal", slug: "legacy-goal" },
      { name: "slug-only-area", slug: "slug-only-area" },
    ]);
  });
});

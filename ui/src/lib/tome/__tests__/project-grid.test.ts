import { projectGridClassName } from "@/lib/tome/project-grid";

describe("projectGridClassName", () => {
  it("adds a fourth column only at the wide-screen breakpoint", () => {
    expect(projectGridClassName()).toBe(
      "grid gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4",
    );
  });
});

import { fireEvent, render, screen } from "@testing-library/react";

import {
  WikiExportMenu,
  wikiExportHref,
} from "@/components/tome/WikiExportMenu";

describe("WikiExportMenu", () => {
  it("builds a page-scoped export URL safely", () => {
    expect(
      wikiExportHref("example project", "markdown", "repos/example/overview.md"),
    ).toBe(
      "/api/tome/projects/example%20project/export?format=markdown&path=repos%2Fexample%2Foverview.md",
    );
  });

  it("shows all formats for the selected page", () => {
    render(<WikiExportMenu slug="example-project" path="roadmap.md" />);

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));

    expect(screen.getByText("Export this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /PDF/ })).toHaveAttribute(
      "href",
      "/api/tome/projects/example-project/export?format=pdf&path=roadmap.md",
    );
    expect(screen.getByRole("link", { name: /HTML/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Markdown/ })).toBeInTheDocument();
  });
});

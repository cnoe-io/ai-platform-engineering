import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    for (const label of ["PDF", "HTML", "Markdown"]) {
      expect(screen.getByRole("link", { name: new RegExp(label) }).querySelector("svg"))
        .toBeInTheDocument();
    }
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
  });

  it("opens the guided presentation workflow", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          pages: {
            "roadmap.md": "---\ntitle: Roadmap\nkind: stable\n---\nContent",
          },
        },
      }),
    } as Response);
    render(<WikiExportMenu slug="example-project" path="roadmap.md" />);

    fireEvent.click(screen.getByRole("button", { name: "Export this page" }));
    fireEvent.click(screen.getByRole("button", { name: /Export as presentation/ }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Export as presentation/ })).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Current page")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tome/projects/example-project/pages",
    ));
    fetchMock.mockRestore();
  });
});

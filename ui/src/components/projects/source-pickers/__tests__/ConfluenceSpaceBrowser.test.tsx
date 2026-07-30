import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { ConfluenceSpaceBrowser } from "../ConfluenceSpaceBrowser";
import type { ConfluencePageScope } from "@/types/projects";

const spaceUrl = "https://example.atlassian.net/wiki/spaces/PLATFORM";

describe("ConfluenceSpaceBrowser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("searches and selects multiple page roots without overlapping trees", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            kind: "space",
            source_url: spaceUrl,
            space_key: "PLATFORM",
            pages: [
              {
                id: "100",
                title: "Overview",
                parent_id: null,
                depth: 0,
                url: `${spaceUrl}/pages/100`,
              },
            ],
            truncated: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            kind: "page",
            source_url: `${spaceUrl}/pages/100`,
            scope: {
              page_id: "100",
              page_title: "Overview",
              space_key: "PLATFORM",
              include_descendants: true,
            },
            pages: [
              {
                id: "100",
                title: "Overview",
                parent_id: null,
                depth: 0,
                url: `${spaceUrl}/pages/100`,
              },
              {
                id: "200",
                title: "Architecture",
                parent_id: "100",
                depth: 1,
                url: `${spaceUrl}/pages/200`,
              },
              {
                id: "300",
                title: "Runbooks",
                parent_id: "100",
                depth: 1,
                url: `${spaceUrl}/pages/300`,
              },
            ],
            truncated: false,
          },
        }),
      });

    function Harness() {
      const [scopes, setScopes] = useState<ConfluencePageScope[]>([]);
      return (
        <ConfluenceSpaceBrowser
          sourceUrl={spaceUrl}
          scopes={scopes}
          onSelect={(url, next) => {
            setScopes(next);
            onSelect(url, next);
          }}
        />
      );
    }
    render(<Harness />);

    await user.click(screen.getByText("Choose a page tree"));

    expect(await screen.findByText("Pages in PLATFORM")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(
      screen.getByText("1 loaded · expand a page for its complete subtree"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Architecture")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Expand Overview"));

    expect(await screen.findByText("Architecture")).toBeInTheDocument();
    expect(screen.getByText("Runbooks")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenLastCalledWith(
      "/api/projects/confluence/resolve",
      expect.objectContaining({
        body: JSON.stringify({ url: `${spaceUrl}/pages/100` }),
      }),
    );

    await user.type(
      screen.getByLabelText("Search pages in this Confluence space"),
      "arch",
    );

    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Architecture")).toBeInTheDocument();
    expect(screen.queryByText("Runbooks")).not.toBeInTheDocument();

    await user.click(screen.getByText("Architecture"));

    expect(onSelect).toHaveBeenCalledWith(spaceUrl, [
      {
        page_id: "200",
        page_title: "Architecture",
        space_key: "PLATFORM",
        include_descendants: true,
      },
    ]);

    await user.click(screen.getByLabelText("Clear page search"));
    await user.click(screen.getByText("Runbooks"));

    expect(screen.getByText("Selected page roots (2)")).toBeInTheDocument();
    expect(onSelect).toHaveBeenLastCalledWith(
      spaceUrl,
      expect.arrayContaining([
        expect.objectContaining({ page_id: "200" }),
        expect.objectContaining({ page_id: "300" }),
      ]),
    );

    await user.click(screen.getAllByText("Overview")[0]);
    expect(screen.getByText("Selected page roots (1)")).toBeInTheDocument();
    expect(onSelect).toHaveBeenLastCalledWith(spaceUrl, [
      expect.objectContaining({ page_id: "100" }),
    ]);
  });
});
